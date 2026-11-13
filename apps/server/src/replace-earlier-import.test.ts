/**
 * Importing a run kept by hand again over its earlier import: through the command, as a function
 * against a store, and through the import_run operation over real HTTP. A made-up demo world: a
 * baker at a ford.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EarlierImportStandsInTheWay, OPERATIONS, Refusal, isRunAlreadyExistsSentence, type ImportedRunReport,
} from '@timeweft/contract';
import { importRequestFromArguments, importRun } from './import-run-command.ts';
import { importedRunInWords } from './in-words.ts';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
let folder: string;

const LOG_OF_TWO_SCENES = [
  '# The Bakery - Log', '',
  '## Scene 1: The oven',
  '**When:** the first morning · the bakery',
  'Wynn the baker lights the oven.', '',
  '## Scene 2: The ford',
  '**When:** the first noon · the ford',
  'Wynn carries bread to the ford.', '',
].join('\n');
const LOG_OF_THREE_SCENES = `${LOG_OF_TWO_SCENES}\n## Scene 3: The market\n**When:** the first evening · the market\nWynn sells the last loaf.\n`;
const CAST = ['# The Bakery - Cast', '', '## Wynn the baker (she)', '- **Who:** bakes for the ford.', ''].join('\n');

function filesWith(log: string) {
  return { log, state: '', cast: CAST, items: '', places: '' };
}

before(async () => {
  running = await startServerForTests();
  folder = await mkdtemp(join(tmpdir(), 'timeweft-replace-'));
  await writeFile(join(folder, 'log.md'), LOG_OF_TWO_SCENES);
  await writeFile(join(folder, 'cast.md'), CAST);
});
after(async () => {
  await running.stop();
  await rm(folder, { recursive: true, force: true });
});

test('the command reads --replace-earlier-import, and leaves it out unless given', () => {
  assert.deepEqual(importRequestFromArguments(['--folder', 'x', '--slug', 'y', '--replace-earlier-import']),
    { folder: 'x', slug: 'y', replaceEarlierImport: true });
  assert.deepEqual(importRequestFromArguments(['--folder', 'x', '--slug', 'y']), { folder: 'x', slug: 'y' });
});

test('the command refuses a slug that exists, naming the flag, then replaces with it and says what was removed', async () => {
  await importRun(running.store, { folder, slug: 'the-bakery' });
  await writeFile(join(folder, 'log.md'), LOG_OF_THREE_SCENES);
  await assert.rejects(importRun(running.store, { folder, slug: 'the-bakery' }), (error: unknown) =>
    error instanceof Refusal && /--replace-earlier-import/.test(error.message) && !error.message.includes('Wynn'));
  const lines = await importRun(running.store, { folder, slug: 'the-bakery', replaceEarlierImport: true });
  assert.ok(lines.includes('Scenes: 3'), lines.join('\n'));
  const removedAt = lines.indexOf('It replaced the earlier import, which was removed. It held:');
  assert.ok(removedAt >= 0, lines.join('\n'));
  assert.ok(lines.slice(removedAt).includes('  Scenes: 2'), lines.join('\n'));
  assert.ok(!lines.join('\n').includes('Wynn'), 'a name from the files reached the output');
  await writeFile(join(folder, 'log.md'), LOG_OF_TWO_SCENES);
});

test('the command says why a run a story played on is not replaced, quoting nothing from the files', async () => {
  await importRun(running.store, { folder, slug: 'played-bakery' });
  await running.store.saveScene(OPERATIONS.save_scene.input.parse({ run: 'played-bakery', title: 'Another day', when: 'the second morning', summary: 'Bread again.', situationAfter: 'Bread.' }));
  await assert.rejects(importRun(running.store, { folder, slug: 'played-bakery', replaceEarlierImport: true }), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay && /1 scene/.test(error.message) && !error.message.includes('Wynn'));
});

test('the command offers no flag to replace a run begun in a chat, which is never replaced', async () => {
  await running.store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'bakery-in-a-chat', title: 'The Bakery' }));
  await assert.rejects(importRun(running.store, { folder, slug: 'bakery-in-a-chat' }), (error: unknown) =>
    error instanceof Refusal && !/--replace-earlier-import|can be replaced/.test(error.message) && /under another slug/.test(error.message));
});

test('import_run over HTTP refuses a slug that exists with the sentence the page knows, then replaces it', async () => {
  const first = await running.call('import_run', { slug: 'bakery-over-http', files: filesWith(LOG_OF_TWO_SCENES) });
  assert.equal(first.status, 200, first.body.refusal);
  assert.equal((first.body.answer as ImportedRunReport).removedEarlierImport, null);
  const again = await running.call('import_run', { slug: 'bakery-over-http', files: filesWith(LOG_OF_THREE_SCENES) });
  assert.equal(again.status, 400);
  assert.ok(isRunAlreadyExistsSentence(again.body.refusal ?? ''), again.body.refusal);
  const replaced = await running.call('import_run', { slug: 'bakery-over-http', files: filesWith(LOG_OF_THREE_SCENES), replaceEarlierImport: true });
  assert.equal(replaced.status, 200, replaced.body.refusal);
  const report = replaced.body.answer as ImportedRunReport;
  assert.equal(report.counts.scenes, 3);
  assert.equal(report.removedEarlierImport?.scenes, 2);
  assert.match(importedRunInWords(report), /It replaced the earlier import, which held 2 scenes, 1 entry, .* and was removed\./);
});

test('replaceEarlierImport is described and defaults to false', () => {
  const shape = OPERATIONS.import_run.input.shape;
  assert.ok((shape.replaceEarlierImport.description ?? '').length > 0);
  assert.equal(OPERATIONS.import_run.input.parse({ slug: 'x', files: {} }).replaceEarlierImport, false);
  assert.equal(OPERATIONS.import_run.audience, 'author');
});
