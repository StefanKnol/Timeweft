/**
 * The import_run operation over real HTTP, the one import it shares with the command, and the
 * body limit as a property of the route: 5 MB by default and 24 MB for the import.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Refusal, type ImportedRunReport } from '@timeweft/contract';
import { LARGEST_BODY_BYTES, LARGEST_BODY_BYTES_BY_OPERATION, bodyTooLargeSentence, largestBodyBytesFor } from './http-server.ts';
import { importWeaverFiles, NothingToImport } from './import-a-run.ts';
import { importRun } from './import-run-command.ts';
import { TEST_TOKEN, sendRawRequest, startServerForTests, statusOfRawAnswer, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
before(async () => {
  running = await startServerForTests();
});
after(async () => {
  await running.stop();
});

/** A made-up run: a miller at a ford, one line the reader cannot place. */
const STRAY_LINE = 'a stray line about the millpond weather';
const MADE_UP_FILES = {
  log: [
    '# The Ford Mill - Log', '',
    '## Scene 1: The wheel',
    '**When:** the first morning · the ford',
    'Ada the miller opens the sluice.', '',
    '## Scene 2: The sacks',
    '**When:** the first noon · the ford',
    'Ada fills the sacks.', '',
  ].join('\n'),
  state: ['# The Ford Mill - State', '', '## Current situation', 'The sacks are full.', '', '## Weather notes', STRAY_LINE, ''].join('\n'),
  cast: ['# The Ford Mill - Cast', '', '## Ada the miller (she)', '- **Who:** keeps the mill at the ford.', '- Scene 1: opens the sluice.', ''].join('\n'),
  items: '',
  places: '',
};

function postRaw(path: string, body: string | Buffer): Promise<Response> {
  return fetch(`${running.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
    body,
  });
}

test('a run is imported from its files over HTTP, answering with counts and the unplaced lines', async () => {
  const { status, body } = await running.call('import_run', { slug: 'the-ford-mill', title: 'The Ford Mill', files: MADE_UP_FILES });
  assert.equal(status, 200, body.refusal);
  const report = body.answer as ImportedRunReport;
  assert.equal(report.run.slug, 'the-ford-mill');
  assert.equal(report.counts.scenes, 2);
  assert.equal(report.counts.entries, 1);
  assert.ok(report.unplaced.some((sentence) => sentence.includes(STRAY_LINE) || sentence.includes('state.md')), report.unplaced.join('\n'));
  const listed = await running.call('list_runs', {});
  assert.ok((listed.body.answer as Array<{ run: { slug: string } }>).some((listing) => listing.run.slug === 'the-ford-mill'));
});

test('five empty files are refused, and nothing is written', async () => {
  const { status, body } = await running.call('import_run', { slug: 'an-empty-run', files: { log: '  \n', state: '' } });
  assert.equal(status, 400);
  assert.match(body.refusal ?? '', /All five files are empty/);
  const listed = await running.call('list_runs', {});
  assert.ok(!(listed.body.answer as Array<{ run: { slug: string } }>).some((listing) => listing.run.slug === 'an-empty-run'));
});

test('a refusal from the store goes back to the author as the refusal', async () => {
  const { status, body } = await running.call('import_run', { slug: 'the-ford-mill', files: MADE_UP_FILES });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.match(body.refusal ?? '', /the-ford-mill/);
});

test('the command and the operation are one import: the command refuses five empty files the same way', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'timeweft-empty-files-'));
  try {
    await writeFile(join(folder, 'log.md'), '\n\n');
    await writeFile(join(folder, 'cast.md'), '');
    await assert.rejects(importRun(running.store, { folder, slug: 'never-there' }), (error: unknown) => error instanceof NothingToImport && /All five files are empty/.test(error.message));
    await assert.rejects(importWeaverFiles(running.store, { log: '', state: '', cast: '', items: '', places: '' }, { slug: 'never-there' }), Refusal);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('the body limit is the route\'s: 5 MB by default, 24 MB for import_run and 200 MB for restore_run', () => {
  assert.equal(largestBodyBytesFor('list_runs'), 5 * 1024 * 1024);
  assert.equal(LARGEST_BODY_BYTES, 5 * 1024 * 1024);
  assert.equal(largestBodyBytesFor('import_run'), 24 * 1024 * 1024);
  assert.equal(largestBodyBytesFor('restore_run'), 200 * 1024 * 1024);
  assert.deepEqual(Object.keys(LARGEST_BODY_BYTES_BY_OPERATION), ['import_run', 'restore_run']);
  assert.equal(bodyTooLargeSentence(200 * 1024 * 1024), 'The request body is larger than 200 MB, which is the most this route takes.');
  assert.equal(bodyTooLargeSentence(24 * 1024 * 1024), 'The request body is larger than 24 MB, which is the most this route takes.');
});

test('import_run takes a body above the default limit, which another route refuses', async () => {
  // Six megabytes of files: over the default, under the import's own limit.
  const padding = `${'the wheel turns. '.repeat(6 * 1024 * 64)}`;
  const files = { ...MADE_UP_FILES, items: `# Items\n\n<!-- ${padding} -->\n` };
  const importBody = JSON.stringify({ slug: 'the-long-mill', files });
  assert.ok(Buffer.byteLength(importBody) > LARGEST_BODY_BYTES);
  const imported = await postRaw('/api/operations/import_run', importBody);
  assert.notEqual(imported.status, 413, 'import_run refused a body under its own limit');
  const refused = await postRaw('/api/operations/list_runs', Buffer.alloc(LARGEST_BODY_BYTES + 1, 0x20)).catch(() => null);
  if (refused !== null) {
    assert.equal(refused.status, 413);
    assert.match((await refused.json() as { refusal: string }).refusal, /larger than 5 MB/);
  }
});

test('a body over a route\'s limit is a 413 naming that limit, by content-length and while reading', async () => {
  for (const [name, megabytes] of [['list_runs', 5], ['import_run', 24]] as const) {
    const limit = megabytes * 1024 * 1024;
    const declared = await sendRawRequest(running.port,
      `POST /api/operations/${name} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${limit + 1}\r\n\r\n{}`);
    assert.equal(statusOfRawAnswer(declared), 413, `${name} took a declared length over its limit`);
    assert.match(declared, new RegExp(`larger than ${megabytes} MB`), `${name} named the wrong limit`);
    const chunk = 'x'.repeat(1024 * 1024);
    const chunked = await sendRawRequest(running.port,
      `POST /api/operations/${name} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TEST_TOKEN}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`
      + `${chunk.length.toString(16)}\r\n${chunk}\r\n`.repeat(megabytes + 1) + '0\r\n\r\n').catch(() => '');
    assert.equal(statusOfRawAnswer(chunked), 413, `${name} took a chunked body over its limit`);
    assert.match(chunked, new RegExp(`larger than ${megabytes} MB`), `${name} named the wrong limit while reading`);
  }
  const { status } = await running.call('list_runs', {});
  assert.equal(status, 200, 'the server stopped serving');
});
