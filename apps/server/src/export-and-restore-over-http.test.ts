/**
 * export_run and restore_run over real HTTP: the author's backup goes out whole, author-only
 * material included, and comes back exactly; a run already there is refused unless replace is
 * asked for; a version the server does not read is refused; a large backup goes through its own
 * route's limit; and neither operation is ever reachable by a story, over MCP or otherwise.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, Refusal, type RestoredRunReport, type RunExportDocument } from '@timeweft/contract';
import { STORY_TOOL_NAMES } from './mcp.ts';
import { parseOperationInput } from './operations.ts';
import { LARGEST_BODY_BYTES_BY_OPERATION, largestBodyBytesFor } from './http-server.ts';
import { TEST_TOKEN, sendRawRequest, startServerForTests, statusOfRawAnswer, type RunningServer } from './server-for-tests.ts';

const SLUG = 'the-ferry-crossing';
const SEALED = 'SEALED-FERRY-MARKER-7e2';

let running: RunningServer;

before(async () => {
  running = await startServerForTests();
  const begun = await running.call('begin_run', {
    slug: SLUG, title: 'The Ferry Crossing', setting: 'A river with one ferry.',
    clocks: [{ name: 'days on the river', countsFrom: 'the first crossing' }], waypoints: ['The ferry crosses at night.'],
  });
  assert.equal(begun.status, 200, begun.body.refusal);
  for (const [index, [title, summary]] of [['The bell', 'The ferrywoman rings the bell.'], ['The crossing', 'The ferry crosses.']].entries()) {
    const saved = await running.call('save_scene', {
      run: SLUG, title, when: 'the first evening', summary, situationAfter: 'The ferry waits.',
      entries: index === 0 ? [{ name: 'Ada the ferrywoman', kind: 'person', pronoun: 'she' }] : [],
      facts: [{ entry: 'Ada the ferrywoman', property: 'state', value: summary ?? '' }],
    });
    assert.equal(saved.status, 200, saved.body.refusal);
  }
  const redone = await running.call('redo_scene', {
    run: SLUG, number: 2, title: 'The crossing again', when: 'the first evening', summary: 'The ferry waits for dawn.', situationAfter: 'The ferry waits.',
  });
  assert.equal(redone.status, 200, redone.body.refusal);
  const sealed = await running.call('state_fact', {
    run: SLUG, entry: 'Ada the ferrywoman', property: 'secret', value: `hides ${SEALED}`, visibility: 'author-only',
  });
  assert.equal(sealed.status, 200, sealed.body.refusal);
});
after(async () => {
  await running.stop();
});

async function exportOverHttp(slug = SLUG): Promise<RunExportDocument> {
  const { status, body } = await running.call('export_run', { run: slug });
  assert.equal(status, 200, body.refusal);
  return body.answer as RunExportDocument;
}

function withoutWhenTaken(document: RunExportDocument): Omit<RunExportDocument, 'exportedAt'> {
  const { exportedAt: _leftOutBecauseEveryExportIsTakenAtItsOwnMoment, ...rest } = document;
  return rest;
}

test('export_run answers with the whole run, author-only material and struck takes included', async () => {
  const document = await exportOverHttp();
  assert.equal(document.formatName, 'timeweft-run-export');
  assert.equal(document.runSlug, SLUG);
  assert.equal(document.tables.runs.length, 1);
  assert.ok(document.tables.scenes.some((scene) => scene.status !== 'standing'), 'the struck take of the redone scene is missing');
  assert.ok(JSON.stringify(document).includes(SEALED), 'the author-only fact is missing from the backup');
});

test('a run already there is refused without replace, and put back exactly with it', async () => {
  const before = await exportOverHttp();
  const refused = await running.call('restore_run', { document: before });
  assert.equal(refused.status, 400);
  assert.match(refused.body.refusal ?? '', /not restored, and nothing was changed/);

  const later = await running.call('save_scene', {
    run: SLUG, title: 'A later scene', when: 'the second morning', summary: 'The river rises.', situationAfter: 'The ferry is tied up.',
  });
  assert.equal(later.status, 200, later.body.refusal);

  const replaced = await running.call('restore_run', { document: before, replace: true });
  assert.equal(replaced.status, 200, replaced.body.refusal);
  const report = replaced.body.answer as RestoredRunReport;
  assert.equal(report.run.slug, SLUG);
  assert.ok(report.replaced !== null, 'the report should say a run was replaced');
  assert.equal(report.replaced.rowsRemoved.scenes, report.rowsRestored.scenes + 1, 'the later scene should be the one row of scenes taken away');
  assert.deepEqual(withoutWhenTaken(await exportOverHttp()), withoutWhenTaken(before));
});

test('a backup restores into a store that never held the run, and a story is briefed the same there', async () => {
  const document = await exportOverHttp();
  const other = await startServerForTests();
  try {
    const restored = await other.call('restore_run', { document });
    assert.equal(restored.status, 200, restored.body.refusal);
    const again = await other.call('export_run', { run: SLUG });
    assert.deepEqual(withoutWhenTaken(again.body.answer as RunExportDocument), withoutWhenTaken(document));
    const briefingHere = await running.call('resume_run', { run: SLUG });
    const briefingThere = await other.call('resume_run', { run: SLUG });
    assert.deepEqual(briefingThere.body.answer, briefingHere.body.answer, 'a story should be briefed the same from the restored run');
  } finally {
    await other.stop();
  }
});

test('a version this server does not read is refused with the versions it does read', async () => {
  const document = await exportOverHttp();
  const { status, body } = await running.call('restore_run', { document: { ...document, formatVersion: 99 } });
  assert.equal(status, 400);
  assert.match(body.refusal ?? '', /versions 1 and 2/);
  const notABackup = await running.call('restore_run', { document: { formatName: 'something-else', formatVersion: 1 } });
  assert.equal(notABackup.status, 400);
});

test('an export of a run nobody has is refused', async () => {
  const { status, body } = await running.call('export_run', { run: 'no-such-river' });
  assert.equal(status, 400);
  assert.match(body.refusal ?? '', /no-such-river/);
});

test('neither operation is the author\'s to share: a story is refused both, and MCP offers neither', async () => {
  assert.equal(OPERATIONS.export_run.audience, 'author');
  assert.equal(OPERATIONS.restore_run.audience, 'author');
  assert.ok(!STORY_TOOL_NAMES.includes('export_run') && !STORY_TOOL_NAMES.includes('restore_run'));
  assert.throws(() => parseOperationInput('export_run', { run: SLUG }, 'story'), Refusal);
  assert.throws(() => parseOperationInput('restore_run', { document: { formatName: 'x', formatVersion: 1 } }, 'story'), Refusal);

  const client = await running.mcpClient();
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(!tools.includes('export_run') && !tools.includes('restore_run'), `MCP offered ${tools.join(', ')}`);
  for (const name of ['export_run', 'restore_run']) {
    const result = await client.callTool({ name, arguments: { run: SLUG } }).catch((error: unknown) => ({ isError: true, content: String(error) }));
    assert.equal(result.isError, true, `${name} was run over MCP`);
    assert.ok(!JSON.stringify(result).includes(SEALED), `${name} over MCP answered with author-only material`);
  }
});

test('restore_run takes a body far above the import\'s limit, and names its own 200 MB limit past it', async () => {
  assert.equal(largestBodyBytesFor('restore_run'), 200 * 1024 * 1024);
  assert.ok(largestBodyBytesFor('restore_run') > (LARGEST_BODY_BYTES_BY_OPERATION.import_run ?? 0));
  // Thirty megabytes: over the import's 24 MB, under the restore's 200 MB. The padding is a field
  // the reader passes over, and the run is already here, so the store refuses it with a 400 and
  // not the body reader with a 413.
  const document = await exportOverHttp();
  const body = JSON.stringify({ document: { ...document, padding: 'the river runs. '.repeat(2 * 1024 * 1024) } });
  assert.ok(Buffer.byteLength(body) > 30 * 1024 * 1024);
  const response = await fetch(`${running.baseUrl}/api/operations/restore_run`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` }, body,
  });
  assert.equal(response.status, 400, 'a backup under 200 MB should reach the store');
  assert.match((await response.json() as { refusal: string }).refusal, /not restored/);

  const limit = 200 * 1024 * 1024;
  const declared = await sendRawRequest(running.port,
    `POST /api/operations/restore_run HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${limit + 1}\r\n\r\n{}`);
  assert.equal(statusOfRawAnswer(declared), 413);
  assert.match(declared, /larger than 200 MB/);
});
