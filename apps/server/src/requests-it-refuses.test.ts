/**
 * Requests the server refuses, each answered properly, and the process still serving afterwards.
 * Also the token gate and the author's pages.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessSettingsFromEnvironment, carriesTheToken } from './access.ts';
import { LARGEST_BODY_BYTES } from './http-server.ts';
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
  assert.deepEqual(accessSettingsFromEnvironment({ TIMEWEFT_ALLOW_NO_TOKEN: 'yes' }), { accessToken: null });
  assert.deepEqual(accessSettingsFromEnvironment({ TIMEWEFT_ACCESS_TOKEN: ' the-token ' }), { accessToken: 'the-token' });
});

test('the token is matched whole', () => {
  const settings = { accessToken: 'the-token' };
  assert.equal(carriesTheToken('Bearer the-token', settings), true);
  assert.equal(carriesTheToken('bearer the-token', settings), true);
  assert.equal(carriesTheToken('Bearer the-toke', settings), false);
  assert.equal(carriesTheToken('the-token', settings), false);
  assert.equal(carriesTheToken(undefined, settings), false);
  assert.equal(carriesTheToken('Bearer ', { accessToken: '' }), false);
  assert.equal(carriesTheToken(undefined, { accessToken: null }), true);
});
