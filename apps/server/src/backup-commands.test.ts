/**
 * The three backup commands, as functions against a store of their own and as the real command
 * in its own process: a run written out and put back, every run written into a folder, a run
 * already there refused unless --replace is given, and nothing a run holds ever said on the
 * console.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { OPERATIONS, Refusal, backupFileName, type RunExportDocument, type Store } from '@timeweft/contract';
import { exportEveryRun, exportOneRun, readBackupFile, refusalForTheConsole, restoreOneRun } from './backup-commands.ts';
import { DEFAULT_SERVER_TEST_DATABASE_URL } from './server-for-tests.ts';

const runCommand = promisify(execFile);
const COMMAND = fileURLToPath(new URL('./backup-commands.ts', import.meta.url));

/** A word from inside the run, which must never reach the console. */
const INSIDE_WORDS = 'the drowned lantern';

let store: Store;
let schema: string;
let dispose: () => Promise<void>;
let folder: string;

before(async () => {
  const { openStoreForTests } = await import('@timeweft/store');
  ({ store, schema, dispose } = await openStoreForTests());
  folder = await mkdtemp(join(tmpdir(), 'timeweft-backup-commands-'));
  await store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'the-lantern', title: 'The Lantern', setting: `A ford where ${INSIDE_WORDS} lies.` }));
  await store.saveScene(OPERATIONS.save_scene.input.parse({
    run: 'the-lantern', title: 'The lantern', when: 'night', summary: `Somebody finds ${INSIDE_WORDS}.`, situationAfter: 'The lantern is lit.',
  }));
  await store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'the-ferry', title: 'The Ferry' }));
});
after(async () => {
  await dispose();
  await rm(folder, { recursive: true, force: true });
});

function withoutWhenTaken(document: RunExportDocument): Omit<RunExportDocument, 'exportedAt'> {
  const { exportedAt: _leftOutBecauseEveryExportIsTakenAtItsOwnMoment, ...rest } = document;
  return rest;
}

test('export-run writes the whole run to the file named, relative to where it was run, and says counts', async () => {
  const lines = await exportOneRun(store, ['--', 'the-lantern', 'lantern.json'], folder);
  assert.match(lines[0] ?? '', new RegExp(`^Wrote a backup of the run the-lantern to ${join(folder, 'lantern.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. It holds:$`));
  assert.ok(lines.includes('- Scenes, struck takes included: 1'), lines.join('\n'));
  assert.ok(!lines.join('\n').includes(INSIDE_WORDS));
  const document = await readBackupFile(join(folder, 'lantern.json'));
  assert.deepEqual(withoutWhenTaken(document), withoutWhenTaken(await store.exportRun('the-lantern')));
  await assert.rejects(exportOneRun(store, ['the-lantern'], folder), (error: unknown) => error instanceof Refusal && /export-run <slug> <file>/.test(error.message));
});

test('export-all writes every run into the folder under its own name', async () => {
  const into = join(folder, 'every');
  const moment = new Date('2026-11-13T09:30:00Z');
  const lines = await exportEveryRun(store, ['every'], folder, moment);
  assert.match(lines[0] ?? '', /^Wrote a backup of each of 2 runs into /);
  assert.deepEqual((await readdir(into)).sort(), [backupFileName('the-ferry', moment), backupFileName('the-lantern', moment)].sort());
  await assert.rejects(exportEveryRun(store, [], folder, moment), Refusal);
});

test('restore-run refuses a run already there, and puts the backup in its place with --replace', async () => {
  const file = join(folder, 'lantern-before.json');
  await exportOneRun(store, ['the-lantern', file], folder);
  await store.saveScene(OPERATIONS.save_scene.input.parse({
    run: 'the-lantern', title: 'Later', when: 'dawn', summary: 'The lantern goes out.', situationAfter: 'It is dark.',
  }));
  await assert.rejects(restoreOneRun(store, [file], folder), (error: unknown) => error instanceof Refusal && /nothing was changed/.test(error.message));
  const lines = await restoreOneRun(store, [file, '--replace'], folder);
  assert.equal(lines[0], 'Restored the run the-lantern. It holds:');
  assert.ok(lines.some((line) => line.startsWith('It replaced the run the-lantern')), lines.join('\n'));
  assert.ok(!lines.join('\n').includes(INSIDE_WORDS));
  assert.deepEqual(withoutWhenTaken(await store.exportRun('the-lantern')), withoutWhenTaken(await readBackupFile(file)));
});

test('a file that is not a backup is refused with a plain sentence', async () => {
  await assert.rejects(readBackupFile(join(folder, 'not-there.json')), (error: unknown) => error instanceof Refusal && /There is no file/.test(error.message));
  await writeFile(join(folder, 'broken.json'), '{ not json');
  await assert.rejects(readBackupFile(join(folder, 'broken.json')), (error: unknown) => error instanceof Refusal && /not readable JSON/.test(error.message));
  await writeFile(join(folder, 'other.json'), JSON.stringify({ formatName: 'timeweft-run-export', formatVersion: 99, runSlug: 'x', tables: {} }));
  await assert.rejects(readBackupFile(join(folder, 'other.json')), (error: unknown) => error instanceof Refusal && /version 1/.test(error.message));
});

test('a refusal that quotes a value is said on the console without it', () => {
  assert.equal(
    refusalForTheConsole(`This backup was not restored, and nothing was changed: row 3 of facts holds "${INSIDE_WORDS}" in "created_at", which must be a moment.`),
    'This backup was not restored, and nothing was changed: row 3 of facts holds a value in "created_at", which must be a moment.',
  );
  const plain = 'This backup was not restored, and nothing was changed: a run called "the-lantern" is already here.';
  assert.equal(refusalForTheConsole(plain), plain);
});

test('the store\'s own refusal of a value of the wrong kind reaches the console without the value', async () => {
  const document = JSON.parse(JSON.stringify(await store.exportRun('the-lantern'))) as RunExportDocument;
  (document.tables.scenes[0] as unknown as Record<string, unknown>)['number'] = INSIDE_WORDS;
  const path = join(folder, 'with-a-wrong-value.json');
  await writeFile(path, JSON.stringify(document));
  let said: string | null = null;
  try {
    await restoreOneRun(store, [path, '--replace'], folder);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    said = refusalForTheConsole(error.message);
  }
  assert.ok(said !== null, 'the store refused the value');
  assert.ok(!said.includes(INSIDE_WORDS), said);
  assert.match(said, /row 1 of scenes holds a value in "number", which must be a whole number/);
});

test('the real commands write a run out and put it back, saying counts only', async () => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TIMEWEFT_DATABASE_URL: process.env['TIMEWEFT_TEST_DATABASE_URL'] ?? DEFAULT_SERVER_TEST_DATABASE_URL,
    TIMEWEFT_DATABASE_SCHEMA: schema,
  };
  delete environment['INIT_CWD'];
  const file = join(folder, 'ferry.json');
  const exported = await runCommand(process.execPath, ['--experimental-strip-types', '--no-warnings', COMMAND, 'export-run', 'the-ferry', file], { env: environment });
  assert.match(exported.stdout, /^Wrote a backup of the run the-ferry to /);
  const document = JSON.parse(await readFile(file, 'utf8')) as RunExportDocument;
  assert.equal(document.runSlug, 'the-ferry');

  const refused = await runCommand(process.execPath, ['--experimental-strip-types', '--no-warnings', COMMAND, 'restore-run', file], { env: environment })
    .then(() => null, (error: { code: number; stderr: string }) => error);
  assert.ok(refused !== null, 'restoring a run already there without --replace should fail');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /nothing was changed/);

  const restored = await runCommand(process.execPath, ['--experimental-strip-types', '--no-warnings', COMMAND, 'restore-run', file, '--replace'], { env: environment });
  assert.match(restored.stdout, /^Restored the run the-ferry\./);
  const countLine = /^((Restored|It replaced) the run [a-z0-9-]+.*|- [A-Z][a-z, ]*: \d+)$/;
  for (const line of restored.stdout.trim().split('\n')) assert.match(line, countLine, 'the console said something other than counts');

  const lanternFile = join(folder, 'lantern-real.json');
  const lantern = await runCommand(process.execPath, ['--experimental-strip-types', '--no-warnings', COMMAND, 'export-run', 'the-lantern', lanternFile], { env: environment });
  assert.ok(!lantern.stdout.includes(INSIDE_WORDS) && !lantern.stderr.includes(INSIDE_WORDS));
});
