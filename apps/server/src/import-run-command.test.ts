/**
 * The import command, run on a made-up folder the test writes, both as a function against a store
 * and as the real command in its own process.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Store } from '@timeweft/contract';
import { DEFAULT_SERVER_TEST_DATABASE_URL } from './server-for-tests.ts';
import { Refusal } from '@timeweft/contract';
import { importRequestFromArguments, importRun, readFolder } from './import-run-command.ts';

const runCommand = promisify(execFile);

let store: Store;
let schema: string;
let dispose: () => Promise<void>;
let folder: string;

/** A line the reader places nowhere, so the unplaced list is not empty. */
const UNPLACED_WORDS = 'a stray line about the weir';

before(async () => {
  const { openStoreForTests } = await import('@timeweft/store');
  ({ store, schema, dispose } = await openStoreForTests());
  folder = await mkdtemp(join(tmpdir(), 'timeweft-run-files-'));
  await writeFile(join(folder, 'log.md'), [
    '# The Weir - Log', '',
    '## Scene 1: The weir',
    '**When:** the first morning · the weir',
    'Bram the lockkeeper opens the weir.', '',
    '## Scene 2: The barge',
    '**When:** the first noon · the weir',
    'A barge passes the weir.', '',
  ].join('\n'));
  await writeFile(join(folder, 'state.md'), [
    '# The Weir - State', '',
    '## Current situation',
    'The barge is through.', '',
    '## Weather notes',
    `${UNPLACED_WORDS}`, '',
  ].join('\n'));
  await writeFile(join(folder, 'cast.md'), [
    '# The Weir - Cast', '',
    '## Bram the lockkeeper (he)',
    '- **Who:** keeps the weir.',
    '- Scene 1: opens the weir.', '',
  ].join('\n'));
  // items.md and places.md are left out on purpose: a missing file reads as empty.
});
after(async () => {
  await dispose();
  await rm(folder, { recursive: true, force: true });
});

test('the arguments are read, and a missing folder or a wrong status is refused', () => {
  assert.deepEqual(importRequestFromArguments(['--', '--folder', 'x', '--slug', 'y', '--status', 'telling']), { folder: 'x', slug: 'y', status: 'telling' });
  assert.throws(() => importRequestFromArguments(['--slug', 'y']), /--folder/);
  assert.throws(() => importRequestFromArguments(['--folder', 'x', '--slug', 'y', '--status', 'maybe']), /binding or telling/);
});

test('a folder is imported and only counts are said', async () => {
  const report = join(folder, 'unplaced.txt');
  const lines = await importRun(store, { folder, slug: 'the-weir', title: 'The Weir', unplacedReport: report });
  assert.ok(lines.includes('Scenes: 2'), lines.join('\n'));
  assert.ok(lines.includes('Entries: 1'), lines.join('\n'));
  const unplacedLine = lines.find((line) => line.startsWith('Unplaced lines: '));
  assert.ok(unplacedLine !== undefined);
  assert.ok(!lines.join('\n').includes('Bram'), 'a name from the files reached the output');
  const reportText = await readFile(report, 'utf8');
  assert.equal(reportText.trim().split('\n').filter((line) => line !== '').length, Number(unplacedLine.slice('Unplaced lines: '.length)));
  const snapshot = await store.snapshotOf('the-weir', 'author');
  assert.equal(snapshot.run.title, 'The Weir');
});

test('the real command imports a folder and prints counts only', async () => {
  const command = fileURLToPath(new URL('./import-run-command.ts', import.meta.url));
  const { stdout, stderr } = await runCommand(process.execPath, [
    '--experimental-strip-types', '--no-warnings', command, '--', '--folder', folder, '--slug', 'the-weir-again',
  ], {
    env: {
      ...process.env,
      TIMEWEFT_DATABASE_URL: process.env['TIMEWEFT_TEST_DATABASE_URL'] ?? DEFAULT_SERVER_TEST_DATABASE_URL,
      TIMEWEFT_DATABASE_SCHEMA: schema,
    },
  });
  assert.match(stdout, /Imported run the-weir-again\./);
  assert.match(stdout, /Scenes: 2/);
  assert.match(stdout, /Unplaced lines: \d+/);
  assert.ok(!stdout.includes('Bram') && !stderr.includes('Bram'), 'a name from the files reached the console');
  assert.ok(!stdout.includes(UNPLACED_WORDS), 'an unplaced line reached the console');
  const countLine = /^(Imported run [a-z0-9-]+\.|[A-Z][a-z]+( [a-z]+)*: \d+)$/;
  for (const line of stdout.trim().split('\n')) assert.match(line, countLine, 'the console said something other than counts');
});

test('a refused import says nothing from the files on the console', async () => {
  const command = fileURLToPath(new URL('./import-run-command.ts', import.meta.url));
  const failed = await runCommand(process.execPath, [
    '--experimental-strip-types', '--no-warnings', command, '--folder', folder, '--slug', 'the-weir',
  ], {
    env: {
      ...process.env,
      TIMEWEFT_DATABASE_URL: process.env['TIMEWEFT_TEST_DATABASE_URL'] ?? DEFAULT_SERVER_TEST_DATABASE_URL,
      TIMEWEFT_DATABASE_SCHEMA: schema,
    },
  }).then(() => null, (error: { code: number; stdout: string; stderr: string }) => error);
  assert.ok(failed !== null, 'importing a slug already there should fail');
  assert.equal(failed.code, 1);
  // A slug already taken is said as it is, with the flag that replaces it, since it quotes nothing.
  assert.match(failed.stderr, /already exists, so nothing was written\..*--replace-earlier-import/);
  assert.ok(!failed.stderr.includes('Bram'));
});

test('a folder holding none of the five files is refused, so a wrong path never imports an empty run', async () => {
  const emptyFolder = await mkdtemp(join(tmpdir(), 'timeweft-empty-folder-'));
  try {
    await assert.rejects(readFolder(emptyFolder), (error: unknown) => error instanceof Refusal && /holds none of log\.md/.test(error.message));
    await assert.rejects(readFolder(join(emptyFolder, 'not-there')), (error: unknown) => error instanceof Refusal);
    await assert.rejects(importRun(store, { folder: emptyFolder, slug: 'never-written' }), Refusal);
    assert.equal((await store.listRuns()).some((listing) => listing.run.slug === 'never-written'), false);
  } finally {
    await rm(emptyFolder, { recursive: true, force: true });
  }
});

test('a folder holding only some of the files is read, the rest as empty', async () => {
  const partFolder = await mkdtemp(join(tmpdir(), 'timeweft-part-folder-'));
  try {
    await writeFile(join(partFolder, 'cast.md'), '# Cast\n');
    const files = await readFolder(partFolder);
    assert.equal(files.cast, '# Cast\n');
    assert.equal(files.log, '');
  } finally {
    await rm(partFolder, { recursive: true, force: true });
  }
});

test('a file that is there and cannot be read is refused by its name', { skip: process.getuid?.() === 0 ? 'root can read any file, so there is nothing to refuse' : false }, async () => {
  const lockedFolder = await mkdtemp(join(tmpdir(), 'timeweft-locked-folder-'));
  try {
    await writeFile(join(lockedFolder, 'log.md'), '# Log\n');
    await chmod(join(lockedFolder, 'log.md'), 0o000);
    await assert.rejects(readFolder(lockedFolder), (error: unknown) => error instanceof Refusal && /log\.md is in the folder and cannot be read/.test(error.message));
  } finally {
    await rm(lockedFolder, { recursive: true, force: true });
  }
});

test('a file name that is a folder is refused by its name', async () => {
  const oddFolder = await mkdtemp(join(tmpdir(), 'timeweft-odd-folder-'));
  try {
    await mkdir(join(oddFolder, 'log.md'));
    await assert.rejects(readFolder(oddFolder), (error: unknown) => error instanceof Refusal && /log\.md is a folder/.test(error.message));
  } finally {
    await rm(oddFolder, { recursive: true, force: true });
  }
});
