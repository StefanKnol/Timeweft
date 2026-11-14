/**
 * The outside of a backup, as the contract reads it before the store reads its rows: the format
 * version said in its own words whatever kind it is written as, the slug held to the shape every
 * run's slug has, the one way a backup is written out, and a file name that never leaves its folder.
 * A made-up demo world: a ford.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATIONS, RUN_EXPORT_FORMAT_NAME, RUN_EXPORT_TABLE_NAMES, Refusal, backupFileName, readRunExportDocument,
  runExportDocumentAsText, whyTheFormatVersionIsNotRead, type RunExportDocument,
} from './index.ts';

function documentOf(changes: Record<string, unknown>, runRow: Record<string, unknown> = { slug: 'the-ford' }): Record<string, unknown> {
  const tables = Object.fromEntries(RUN_EXPORT_TABLE_NAMES.map((table) => [table, table === 'runs' ? [runRow] : []]));
  return { formatName: RUN_EXPORT_FORMAT_NAME, formatVersion: 1, exportedAt: '2026-11-13T09:30:00.000000Z', runSlug: 'the-ford', continuesRun: null, tables, ...changes };
}

function refusalOf(value: unknown): string {
  try {
    readRunExportDocument(value);
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
  return 'read';
}

test('a format version is said in its own words, never as a version the store reads', () => {
  assert.equal(whyTheFormatVersionIsNotRead(1), null);
  for (const version of ['1', 1.5, true]) {
    const sentence = refusalOf(documentOf({ formatVersion: version }));
    assert.match(sentence, /not a whole number, and this server reads version 1 only/, String(version));
    assert.doesNotMatch(sentence, /written in format version/);
  }
  const missing = documentOf({});
  delete missing['formatVersion'];
  assert.match(refusalOf(missing), /^This backup does not say which format version it is written in/);
  assert.match(refusalOf(documentOf({ formatVersion: 99 })), /written in format version 99, and this server reads version 1 only/);
});

test('restore_run takes any format version and leaves the saying to the backup\'s own reader', () => {
  const parsed = OPERATIONS.restore_run.input.safeParse({ document: documentOf({ formatVersion: '1' }) });
  assert.equal(parsed.success, true);
  const withNoName = OPERATIONS.restore_run.input.safeParse({ document: { formatVersion: 1 } });
  assert.equal(withNoName.success, true);
});

test('a slug that is not a run\'s, or that differs between the outside and the run it holds, is refused', () => {
  assert.equal(refusalOf(documentOf({})), 'read');
  for (const slug of ['../../srv/x', 'a/b', 'the ford', 'the--ford']) {
    assert.match(refusalOf(documentOf({ runSlug: slug }, { slug })), /a slug no run may have/, slug);
  }
  assert.match(refusalOf(documentOf({}, { slug: 'the-mill' })), /one slug on the outside and holds a run with another/);
});

test('a backup file is named only by a slug a run may have, so it cannot leave its folder', () => {
  const moment = new Date('2026-11-13T09:30:00.000Z');
  assert.equal(backupFileName('the-ford', moment), 'the-ford--20261113T093000Z.timeweft-run.json');
  for (const slug of ['../../srv/x', 'a/b', 'x--y', '']) {
    assert.throws(() => backupFileName(slug, moment), Refusal, slug);
  }
});

test('a backup is written out one way, with a closing line break', () => {
  const document = documentOf({}) as unknown as RunExportDocument;
  const text = runExportDocumentAsText(document);
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(text), document);
  assert.equal(text, `${JSON.stringify(document, null, 2)}\n`);
});
