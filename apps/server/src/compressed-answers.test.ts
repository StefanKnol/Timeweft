/**
 * Answers and the pages' files compressed where the browser accepts it, over real HTTP on a real
 * port. Each request is written with node:http rather than fetch, because fetch asks for compressed
 * answers by itself and undoes the compression before a test could see it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { SMALLEST_BODY_WORTH_COMPRESSING, encodingAcceptedBy, isCompressibleContentType } from './http-server.ts';
import { TEST_TOKEN, startServerForTests, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
let webRoot: string;

/** A page script long enough to be worth compressing. */
const PAGE_SCRIPT = 'console.log("the miller crosses the ford at dusk");\n'.repeat(200);
/** Bytes that stand for a picture: never compressed, whatever the browser accepts. */
const PICTURE_BYTES = Buffer.alloc(4096, 7);

before(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'timeweft-compressed-pages-'));
  await writeFile(join(webRoot, 'index.html'), `<p>${'the pages of the ford '.repeat(100)}</p>`);
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'assets', 'page.js'), PAGE_SCRIPT);
  await writeFile(join(webRoot, 'assets', 'mill.png'), PICTURE_BYTES);
  await writeFile(join(webRoot, 'assets', 'tiny.js'), 'console.log(1);');
  running = await startServerForTests({ webRoot });
  const begun = await running.call('begin_run', {
    slug: 'the-long-ford',
    title: 'The Long Ford',
    setting: 'A river valley with one ford, a mill above it and a ferry below it. '.repeat(40),
  });
  assert.equal(begun.status, 200, begun.body.refusal);
});
after(async () => {
  await running.stop();
  await rm(webRoot, { recursive: true, force: true });
});

interface RawAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** One request with exactly the headers given, answered with the bytes as they came over the wire. */
function sendRequest(method: string, path: string, headers: Record<string, string>, body?: string): Promise<RawAnswer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port: running.port, method, path, headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: Buffer.concat(chunks) }));
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

function readRun(acceptEncoding: string | null): Promise<RawAnswer> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` };
  if (acceptEncoding !== null) headers['accept-encoding'] = acceptEncoding;
  return sendRequest('POST', '/api/operations/read_run', headers, JSON.stringify({ run: 'the-long-ford' }));
}

test('the encoding is read from Accept-Encoding, brotli first, then gzip, else none', () => {
  assert.equal(encodingAcceptedBy(undefined), 'identity');
  assert.equal(encodingAcceptedBy(''), 'identity');
  assert.equal(encodingAcceptedBy('gzip'), 'gzip');
  assert.equal(encodingAcceptedBy('x-gzip'), 'gzip');
  assert.equal(encodingAcceptedBy('gzip, deflate, br'), 'br');
  assert.equal(encodingAcceptedBy('br;q=0, gzip'), 'gzip');
  assert.equal(encodingAcceptedBy('br;q=0.2, gzip;q=0.8'), 'gzip');
  assert.equal(encodingAcceptedBy('gzip;q=0, br;q=0'), 'identity');
  assert.equal(encodingAcceptedBy('deflate'), 'identity');
  assert.equal(encodingAcceptedBy('identity'), 'identity');
  assert.equal(encodingAcceptedBy('*'), 'br');
  assert.equal(encodingAcceptedBy('*;q=0'), 'identity');
  assert.equal(encodingAcceptedBy('br;q=0, *'), 'gzip');
  assert.equal(encodingAcceptedBy(['deflate', 'GZIP']), 'gzip');
});

test('pictures and fonts are not compressed, text and JSON are', () => {
  assert.equal(isCompressibleContentType('application/json; charset=utf-8'), true);
  assert.equal(isCompressibleContentType('text/javascript; charset=utf-8'), true);
  assert.equal(isCompressibleContentType('text/html; charset=utf-8'), true);
  assert.equal(isCompressibleContentType('image/svg+xml'), true);
  assert.equal(isCompressibleContentType('image/png'), false);
  assert.equal(isCompressibleContentType('image/webp'), false);
  assert.equal(isCompressibleContentType('font/woff2'), false);
  assert.equal(isCompressibleContentType('application/octet-stream'), false);
});

test('an answer asked for with gzip comes compressed and round trips to the plain answer', async () => {
  const plain = await readRun(null);
  const zipped = await readRun('gzip');
  assert.equal(plain.status, 200);
  assert.equal(zipped.status, 200);
  assert.ok(plain.body.length >= SMALLEST_BODY_WORTH_COMPRESSING, 'the answer is long enough to be compressed');
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers['vary'], 'Accept-Encoding');
  assert.equal(Number(zipped.headers['content-length']), zipped.body.length);
  assert.ok(zipped.body.length < plain.body.length / 2, `gzip sent ${zipped.body.length} of ${plain.body.length} bytes`);
  assert.deepEqual(JSON.parse(gunzipSync(zipped.body).toString('utf8')), JSON.parse(plain.body.toString('utf8')));
});

test('an answer asked for with brotli comes as brotli and round trips', async () => {
  const plain = await readRun(null);
  const brotli = await readRun('gzip, deflate, br');
  assert.equal(brotli.headers['content-encoding'], 'br');
  assert.equal(brotli.headers['vary'], 'Accept-Encoding');
  assert.deepEqual(JSON.parse(brotliDecompressSync(brotli.body).toString('utf8')), JSON.parse(plain.body.toString('utf8')));
});

test('a request that sends no Accept-Encoding, or one that names neither, gets the answer as it is', async () => {
  for (const acceptEncoding of [null, 'identity', 'deflate', 'gzip;q=0']) {
    const answer = await readRun(acceptEncoding);
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['content-encoding'], undefined, `for ${acceptEncoding ?? 'no header'}`);
    assert.equal(answer.headers['vary'], 'Accept-Encoding');
    assert.equal(Number(answer.headers['content-length']), answer.body.length);
    const parsed = JSON.parse(answer.body.toString('utf8')) as { ok: boolean };
    assert.equal(parsed.ok, true);
  }
});

test('a short refusal is sent as it is even where gzip is accepted', async () => {
  const answer = await sendRequest('POST', '/api/operations/no_such_thing', {
    'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}`, 'accept-encoding': 'gzip, br',
  }, '{}');
  assert.equal(answer.status, 404);
  assert.equal(answer.headers['content-encoding'], undefined);
  assert.match(answer.body.toString('utf8'), /no operation called/);
});

test('a page script comes compressed, and a HEAD sends the same headers and no body', async () => {
  const got = await sendRequest('GET', '/assets/page.js', { 'accept-encoding': 'gzip' });
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-encoding'], 'gzip');
  assert.equal(got.headers['vary'], 'Accept-Encoding');
  assert.equal(gunzipSync(got.body).toString('utf8'), PAGE_SCRIPT);

  const head = await sendRequest('HEAD', '/assets/page.js', { 'accept-encoding': 'gzip' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-encoding'], 'gzip');
  assert.equal(head.headers['content-length'], got.headers['content-length']);

  const brotli = await sendRequest('GET', '/assets/page.js', { 'accept-encoding': 'br' });
  assert.equal(brotli.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(brotli.body).toString('utf8'), PAGE_SCRIPT);

  const plain = await sendRequest('GET', '/assets/page.js', {});
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString('utf8'), PAGE_SCRIPT);

  const plainHead = await sendRequest('HEAD', '/assets/page.js', {});
  assert.equal(plainHead.body.length, 0);
  assert.equal(Number(plainHead.headers['content-length']), Buffer.byteLength(PAGE_SCRIPT));
});

test('a page reached by its own address comes compressed, as index.html', async () => {
  const got = await sendRequest('GET', '/runs/the-long-ford', { 'accept-encoding': 'gzip' });
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(got.body).toString('utf8'), /the pages of the ford/);
});

test('a picture is never compressed, and a tiny file is sent as it is', async () => {
  const picture = await sendRequest('GET', '/assets/mill.png', { 'accept-encoding': 'gzip, br' });
  assert.equal(picture.status, 200);
  assert.equal(picture.headers['content-encoding'], undefined);
  assert.equal(picture.headers['vary'], undefined);
  assert.deepEqual(picture.body, PICTURE_BYTES);

  const tiny = await sendRequest('GET', '/assets/tiny.js', { 'accept-encoding': 'gzip' });
  assert.equal(tiny.headers['content-encoding'], undefined);
  assert.equal(tiny.body.toString('utf8'), 'console.log(1);');
});

test('a file changed on disk is never served from the bytes kept for the old one', async () => {
  const path = join(webRoot, 'assets', 'changing.js');
  const firstText = 'console.log("the first ferry");\n'.repeat(100);
  const secondText = 'console.log("the second ferry, rebuilt");\n'.repeat(100);
  await writeFile(path, firstText);
  await utimes(path, new Date(2026, 0, 1), new Date(2026, 0, 1));
  const first = await sendRequest('GET', '/assets/changing.js', { 'accept-encoding': 'br' });
  assert.equal(brotliDecompressSync(first.body).toString('utf8'), firstText);
  await writeFile(path, secondText);
  await utimes(path, new Date(2026, 0, 2), new Date(2026, 0, 2));
  const second = await sendRequest('GET', '/assets/changing.js', { 'accept-encoding': 'br' });
  assert.equal(brotliDecompressSync(second.body).toString('utf8'), secondText);
});

test('the MCP route is left as its transport writes it, even where gzip is accepted', async () => {
  const answer = await sendRequest('POST', '/mcp', {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${TEST_TOKEN}`,
    'accept-encoding': 'gzip, br',
  }, JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'a-miller', version: '0.0.0' } },
  }));
  assert.equal(answer.status, 200);
  assert.equal(answer.headers['content-encoding'], undefined);
  assert.match(answer.body.toString('utf8'), /"serverInfo"/);
});

test('fetch, which asks for compression by itself, still reads every answer', async () => {
  const client = await running.mcpClient();
  assert.ok((await client.listTools()).tools.length > 0);
  const { status, body } = await running.call('read_run', { run: 'the-long-ford' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});
