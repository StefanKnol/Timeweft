/**
 * Requests the server refuses, each answered properly, and the process still serving afterwards.
 * Also the token gate and the author's pages.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessSettingsFromEnvironment, carriesATokenForStories, carriesTheToken } from './access.ts';
import { LARGEST_BODY_BYTES, LARGEST_OBJECTS_AND_LISTS_PER_BODY, objectsAndListsAtMost } from './http-server.ts';
import { TEST_TOKEN, sendRawRequest, startServerForTests, statusOfRawAnswer, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
let webRoot: string;

before(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'timeweft-pages-'));
  await writeFile(join(webRoot, 'index.html'), '<p>the pages</p>');
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'assets', 'page.js'), 'console.log("page");');
  running = await startServerForTests({ webRoot });
});
after(async () => {
  await running.stop();
  await rm(webRoot, { recursive: true, force: true });
});

async function stillServing(): Promise<void> {
  const { status, body } = await running.call('list_runs', {});
  assert.equal(status, 200);
  assert.equal(body.ok, true);
}

function post(path: string, body: string | Buffer, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${running.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}`, ...headers },
    body,
  });
}

test('a request without the token, or with the wrong one, is a 401 on the routes and on MCP', async () => {
  for (const path of ['/api/operations/list_runs', '/mcp']) {
    const withNone = await fetch(`${running.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(withNone.status, 401, `${path} let a caller with no token in`);
    const withWrong = await post(path, '{}', { authorization: `Bearer ${TEST_TOKEN}x` });
    assert.equal(withWrong.status, 401, `${path} let a caller with the wrong token in`);
  }
  await stillServing();
});

test('a malformed JSON body is a 400 and the server serves on', async () => {
  const response = await post('/api/operations/list_runs', '{ "not": json');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, refusal: 'The request body is not readable JSON.' });
  await stillServing();
});

test('a body that is not JSON by its content type is refused', async () => {
  const response = await post('/api/operations/list_runs', 'plain words', { 'content-type': 'text/plain' });
  assert.equal(response.status, 415);
  await stillServing();
});

test('an unknown operation is a 404 naming it', async () => {
  const response = await post('/api/operations/burn_the_mill', '{}');
  assert.equal(response.status, 404);
  const body = await response.json() as { ok: boolean; refusal: string };
  assert.equal(body.ok, false);
  assert.match(body.refusal, /burn_the_mill/);
  const inherited = await post('/api/operations/toString', '{}');
  assert.equal(inherited.status, 404, 'a name an object inherits is not an operation');
  await stillServing();
});

test('a body over the limit is a 413 and the server serves on', async () => {
  const tooLarge = Buffer.alloc(LARGEST_BODY_BYTES + 1, 0x20);
  const response = await post('/api/operations/list_runs', tooLarge).catch(() => null);
  if (response !== null) assert.equal(response.status, 413);
  const raw = await sendRawRequest(running.port,
    `POST /api/operations/list_runs HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${LARGEST_BODY_BYTES + 1}\r\n\r\n{}`);
  assert.equal(statusOfRawAnswer(raw), 413);
  const chunk = 'x'.repeat(1024 * 1024);
  const chunked = await sendRawRequest(running.port,
    `POST /api/operations/list_runs HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TEST_TOKEN}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`
    + `${(chunk.length).toString(16)}\r\n${chunk}\r\n`.repeat(6) + '0\r\n\r\n');
  assert.equal(statusOfRawAnswer(chunked), 413, 'a body with no declared length is counted as it arrives');
  await stillServing();
});

test('an address that cannot be read is a 400 and never ends the process', async () => {
  for (const target of ['http://[/', '//', 'http://a b/']) {
    const raw = await sendRawRequest(running.port, `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    const status = statusOfRawAnswer(raw);
    assert.ok(status === 400 || status === 404, `the target ${target} was answered ${String(status)}`);
    await stillServing();
  }
  const unreadable = await sendRawRequest(running.port, 'GET http://[/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.equal(statusOfRawAnswer(unreadable), 400);
});

test('the health check answers without the token', async () => {
  const response = await fetch(`${running.baseUrl}/health`);
  assert.equal(response.status, 200);
  // Outside a built image nothing stamps the build, so every part of the stamp is null.
  assert.deepEqual(await response.json(), { ok: true, build: { number: null, commit: null, builtAt: null } });
});

test('the author\'s pages are served, unknown paths get index.html, and nothing climbs out', async () => {
  const page = await fetch(`${running.baseUrl}/assets/page.js`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /javascript/);
  const unknown = await fetch(`${running.baseUrl}/runs/the-ford`);
  assert.equal(await unknown.text(), '<p>the pages</p>');
  const climbing = await sendRawRequest(running.port, 'GET /../../etc/passwd HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.doesNotMatch(climbing, /root:/);
  const encodedClimb = await fetch(`${running.baseUrl}/%2e%2e/%2e%2e/etc/passwd`);
  assert.doesNotMatch(await encodedClimb.text(), /root:/);
  const slashEncodedClimb = await sendRawRequest(running.port, `GET /${'..%2f'.repeat(30)}etc%2fpasswd HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  assert.doesNotMatch(slashEncodedClimb, /root:/, 'an encoded slash let a path climb out of the pages');
  const unknownApi = await fetch(`${running.baseUrl}/api/nothing`, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
  assert.equal(unknownApi.status, 404, 'an unknown api path is not answered with a page');
});

test('the server refuses to start without a token unless told it is local', () => {
  assert.throws(() => accessSettingsFromEnvironment({}), /TIMEWEFT_ACCESS_TOKEN is not set/);
  assert.throws(() => accessSettingsFromEnvironment({ TIMEWEFT_ALLOW_NO_TOKEN: 'true' }), /TIMEWEFT_ACCESS_TOKEN is not set/);
  assert.deepEqual(accessSettingsFromEnvironment({ TIMEWEFT_ALLOW_NO_TOKEN: 'yes' }), { accessToken: null, storyToken: null });
  assert.deepEqual(accessSettingsFromEnvironment({ TIMEWEFT_ACCESS_TOKEN: ' the-token ' }), { accessToken: 'the-token', storyToken: null });
});

test('a story token is read from the environment, and refused where it would not narrow anything', () => {
  assert.deepEqual(
    accessSettingsFromEnvironment({ TIMEWEFT_ACCESS_TOKEN: 'the-token', TIMEWEFT_STORY_TOKEN: ' the-story-token ' }),
    { accessToken: 'the-token', storyToken: 'the-story-token' },
  );
  assert.throws(() => accessSettingsFromEnvironment({ TIMEWEFT_ACCESS_TOKEN: 'the-token', TIMEWEFT_STORY_TOKEN: 'the-token' }), /is the same as TIMEWEFT_ACCESS_TOKEN/);
  assert.throws(() => accessSettingsFromEnvironment({ TIMEWEFT_ALLOW_NO_TOKEN: 'yes', TIMEWEFT_STORY_TOKEN: 'the-story-token' }), /TIMEWEFT_ACCESS_TOKEN is not/);
});

test('the story token opens MCP and never the author\'s routes', async () => {
  const settings = { accessToken: 'the-token', storyToken: 'the-story-token' };
  assert.equal(carriesTheToken({ authorization: 'Bearer the-story-token' }, settings), false);
  assert.equal(carriesATokenForStories({ authorization: 'Bearer the-story-token' }, settings), true);
  assert.equal(carriesATokenForStories({ authorization: 'Bearer the-token' }, settings), true);
  assert.equal(carriesATokenForStories({ authorization: 'Bearer the-story-token' }, { accessToken: 'the-token' }), false);
  const withStoryToken = await startServerForTests({ storyToken: 'a-story-token-for-the-demo-world' });
  try {
    const asAStory = { 'content-type': 'application/json', authorization: 'Bearer a-story-token-for-the-demo-world' };
    for (const name of ['export_run', 'restore_run', 'list_runs']) {
      const answer = await fetch(`${withStoryToken.baseUrl}/api/operations/${name}`, { method: 'POST', headers: asAStory, body: '{}' });
      assert.equal(answer.status, 401, `the story token reached ${name} over the web route`);
    }
    const mcp = await fetch(`${withStoryToken.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...asAStory, accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'a-story-chat', version: '0.0.0' } } }),
    });
    assert.notEqual(mcp.status, 401, 'the story token did not open MCP');
    await mcp.body?.cancel();
    const asTheAuthor = await withStoryToken.call('list_runs', {});
    assert.equal(asTheAuthor.status, 200);
  } finally {
    await withStoryToken.stop();
  }
});

test('a body holding more objects and lists than any request needs is refused before it is parsed', async () => {
  assert.equal(objectsAndListsAtMost(Buffer.from('{"a":[1,{"b":"[x{"}]}')), 5);
  const count = LARGEST_OBJECTS_AND_LISTS_PER_BODY + 10;
  const body = Buffer.alloc(count * 3 + 1, '{},');
  body[0] = 0x5b;
  body.write('{}]', body.length - 3);
  const response = await post('/api/operations/restore_run', body);
  assert.equal(response.status, 413);
  assert.match(((await response.json()) as { refusal: string }).refusal, /objects and lists, far more than any backup/);
  await stillServing();
});

test('the token is matched whole', () => {
  const settings = { accessToken: 'the-token' };
  assert.equal(carriesTheToken({ authorization: 'Bearer the-token' }, settings), true);
  assert.equal(carriesTheToken({ authorization: 'bearer the-token' }, settings), true);
  assert.equal(carriesTheToken({ authorization: 'Bearer the-toke' }, settings), false);
  assert.equal(carriesTheToken({ authorization: 'the-token' }, settings), false);
  assert.equal(carriesTheToken({}, settings), false);
  assert.equal(carriesTheToken({ authorization: 'Bearer ' }, { accessToken: '' }), false);
  assert.equal(carriesTheToken({}, { accessToken: null }), true);
});

test('the token is taken from the app\'s own header or cookie where something in front keeps Authorization', () => {
  const settings = { accessToken: 'the token; with=odd characters' };
  assert.equal(carriesTheToken({ 'x-timeweft-token': 'the token; with=odd characters' }, settings), true);
  assert.equal(carriesTheToken({ 'x-timeweft-token': 'another token' }, settings), false);
  assert.equal(carriesTheToken({ cookie: `other=1; timeweft_access_token=${encodeURIComponent('the token; with=odd characters')}; last=2` }, settings), true);
  assert.equal(carriesTheToken({ cookie: 'timeweft_access_token=another' }, settings), false);
  assert.equal(carriesTheToken({ cookie: 'not_timeweft_access_token=the%20token' }, { accessToken: 'the token' }), false);
  assert.equal(carriesTheToken({ cookie: 'timeweft_access_token=%E0%A4%A' }, settings), false, 'a cookie that is not properly encoded is not a token');
});

test('a header a proxy filled in with something else does not lock the caller out', () => {
  const settings = { accessToken: 'the-token' };
  assert.equal(carriesTheToken({ authorization: 'Bearer the-hubs-own-session', 'x-timeweft-token': 'the-token' }, settings), true);
  assert.equal(carriesTheToken({ authorization: 'Basic something', cookie: 'timeweft_access_token=the-token' }, settings), true);
  assert.equal(carriesTheToken({ authorization: 'Bearer wrong', 'x-timeweft-token': 'wrong', cookie: 'timeweft_access_token=wrong' }, settings), false);
});

test('a request is let in over real HTTP by the header alone and by the cookie alone', async () => {
  const route = `${running.baseUrl}/api/operations/list_runs`;
  const byHeader = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timeweft-token': TEST_TOKEN }, body: '{}' });
  assert.equal(byHeader.status, 200);
  const byCookie = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `timeweft_access_token=${encodeURIComponent(TEST_TOKEN)}` }, body: '{}' });
  assert.equal(byCookie.status, 200);
  const byNeither = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timeweft-token': 'wrong' }, body: '{}' });
  assert.equal(byNeither.status, 401);
});
