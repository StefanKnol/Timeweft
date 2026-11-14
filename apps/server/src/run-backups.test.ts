/**
 * The backups in a folder: which files are a run's, which the folder lets go, whether a run
 * changed since its newest backup, a round over every run against a real store, the timer that
 * runs rounds, and the settings it reads. Every run here is a made-up one of the demo world.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPERATIONS, backupFileName, type RunExportDocument, type Store } from '@timeweft/contract';
import {
  backUpEveryRun, backupRoundInWords, backupsOfRun, backupsToLetGo, failureInWords, fingerprintOfRun, newestBackupOfRun,
  readBackupFileName, runNeedsABackup, writeBackupFile,
} from './run-backups.ts';
import {
  DEFAULT_BACKUPS_TO_KEEP, DEFAULT_BACKUP_EVERY_HOURS, scheduledBackupSettingsFromEnvironment, startScheduledBackups,
} from './scheduled-backups.ts';
import './server-for-tests.ts';

let store: Store;
let dispose: () => Promise<void>;
let folder: string;

const MOMENT = new Date('2026-11-13T09:30:00.000Z');
const LATER = new Date('2026-11-14T09:30:00.000Z');

before(async () => {
  const { openStoreForTests } = await import('@timeweft/store');
  ({ store, dispose } = await openStoreForTests());
  for (const slug of ['the-mill', 'the-mill-upstream']) {
    await store.beginRun(OPERATIONS.begin_run.input.parse({ slug, title: 'The Mill', setting: 'A mill on a stream.' }));
  }
});
after(async () => {
  await dispose();
});

async function freshFolder(): Promise<string> {
  folder = await mkdtemp(join(tmpdir(), 'timeweft-backups-'));
  return folder;
}

test('a backup\'s name is read back into its run and moment, and a slug that begins like another is its own', () => {
  assert.deepEqual(readBackupFileName('the-mill--20261113T093000Z.timeweft-run.json'), {
    fileName: 'the-mill--20261113T093000Z.timeweft-run.json', runSlug: 'the-mill', takenAt: '20261113T093000Z',
  });
  assert.equal(readBackupFileName('the-mill-upstream--20261113T093000Z.timeweft-run.json')?.runSlug, 'the-mill-upstream');
  for (const notABackup of ['the-mill.json', 'the-mill--20261113T093000Z.timeweft-run.json.tmp', '--20261113T093000Z.timeweft-run.json', 'the-mill--yesterday.timeweft-run.json']) {
    assert.equal(readBackupFileName(notABackup), null, notABackup);
  }
  assert.equal(readBackupFileName(backupFileName('the-mill', MOMENT))?.takenAt, '20261113T093000Z');
});

test('a run\'s backups are its own, oldest first, and the oldest are the ones let go', () => {
  const names = [
    backupFileName('the-mill', LATER), backupFileName('the-mill-upstream', MOMENT), 'notes.txt',
    backupFileName('the-mill', MOMENT), `${backupFileName('the-mill', new Date('2026-11-15T00:00:00Z'))}.tmp`,
  ];
  assert.deepEqual(backupsOfRun(names, 'the-mill'), [backupFileName('the-mill', MOMENT), backupFileName('the-mill', LATER)]);
  assert.equal(newestBackupOfRun(names, 'the-mill'), backupFileName('the-mill', LATER));
  assert.equal(newestBackupOfRun(names, 'the-weir'), null);
  assert.deepEqual(backupsToLetGo(names, 'the-mill', 1), [backupFileName('the-mill', MOMENT)]);
  assert.deepEqual(backupsToLetGo(names, 'the-mill', 2), []);
  assert.deepEqual(backupsToLetGo(names, 'the-mill-upstream', 1), []);
});

test('a run needs a backup where it has none or what it holds has changed, and only then', async () => {
  const document = await store.exportRun('the-mill');
  const again = await store.exportRun('the-mill');
  assert.equal(fingerprintOfRun(again), fingerprintOfRun(document), 'two exports of an unchanged run should fingerprint alike');
  assert.equal(runNeedsABackup(null, fingerprintOfRun(document)), true);
  assert.equal(runNeedsABackup(fingerprintOfRun(document), fingerprintOfRun(again)), false);
  const changed: RunExportDocument = { ...document, tables: { ...document.tables, runs: [{ ...document.tables.runs[0]!, title: 'The Old Mill' }] } };
  assert.equal(runNeedsABackup(fingerprintOfRun(document), fingerprintOfRun(changed)), true);
});

test('a backup is written whole under its own name, with nothing temporary left beside it', async () => {
  const into = await freshFolder();
  try {
    const document = await store.exportRun('the-mill');
    const fileName = await writeBackupFile(into, document, MOMENT);
    assert.equal(fileName, backupFileName('the-mill', MOMENT));
    assert.deepEqual(await readdir(into), [fileName]);
    assert.deepEqual(JSON.parse(await readFile(join(into, fileName), 'utf8')), document);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('a round backs up every run, skips a run unchanged since, and keeps only the newest', async () => {
  const into = await freshFolder();
  try {
    const first = await backUpEveryRun(store, { folder: into, backupsToKeep: 2 }, MOMENT);
    assert.deepEqual(first.written.sort(), ['the-mill', 'the-mill-upstream']);
    assert.deepEqual(first.failed, []);

    const second = await backUpEveryRun(store, { folder: into, backupsToKeep: 2 }, LATER);
    assert.deepEqual(second.written, [], 'a run unchanged since its last backup was written again');
    assert.deepEqual(second.unchanged.sort(), ['the-mill', 'the-mill-upstream']);

    for (const [index, moment] of [new Date('2026-11-15T09:30:00Z'), new Date('2026-11-16T09:30:00Z')].entries()) {
      await store.saveScene(OPERATIONS.save_scene.input.parse({
        run: 'the-mill', title: `Scene ${index + 1}`, when: 'a morning', summary: 'The wheel turns.', situationAfter: 'The wheel turns on.',
      }));
      const round = await backUpEveryRun(store, { folder: into, backupsToKeep: 2 }, moment);
      assert.deepEqual(round.written, ['the-mill']);
    }
    const names = await readdir(into);
    assert.deepEqual(backupsOfRun(names, 'the-mill'), [backupFileName('the-mill', new Date('2026-11-15T09:30:00Z')), backupFileName('the-mill', new Date('2026-11-16T09:30:00Z'))]);
    assert.deepEqual(backupsOfRun(names, 'the-mill-upstream'), [backupFileName('the-mill-upstream', MOMENT)], 'another run\'s backups were let go');
    assert.ok(names.every((name) => !name.endsWith('.tmp')));
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('a newest backup that cannot be read counts as no backup, so the run is written again', async () => {
  const into = await freshFolder();
  try {
    await writeFile(join(into, backupFileName('the-mill', MOMENT)), 'not a backup');
    const round = await backUpEveryRun(store, { folder: into, backupsToKeep: 5 }, LATER);
    assert.ok(round.written.includes('the-mill'));
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('one run failing leaves every other run\'s backup going, and the failure is in the report by slug', async () => {
  const into = await freshFolder();
  try {
    const runs = (await store.listRuns()).map((listing) => listing.run.slug);
    const failingSlug = runs[0]!;
    assert.ok(runs.length > 1, 'a run after the failing one is backed up too');
    const oneRunFails = {
      listRuns: () => store.listRuns(),
      exportRun: async (runSlug: string) => {
        if (runSlug === failingSlug) throw new TypeError('a line of a run');
        return store.exportRun(runSlug);
      },
    } as unknown as Store;
    const round = await backUpEveryRun(oneRunFails, { folder: into, backupsToKeep: 2 }, MOMENT);
    assert.deepEqual(round.failed, [{ runSlug: failingSlug, reason: 'TypeError' }]);
    assert.deepEqual(round.written, runs.filter((slug) => slug !== failingSlug));
    assert.deepEqual((await readdir(into)).sort(), round.written.map((slug) => backupFileName(slug, MOMENT)).sort());
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('a backup can be read by the user the server runs as and nobody else, and so can a folder it makes', async () => {
  const into = await freshFolder();
  try {
    const madeHere = join(into, 'made-by-the-server');
    const round = await backUpEveryRun(store, { folder: madeHere, backupsToKeep: 2 }, MOMENT);
    assert.ok(round.written.length > 0);
    assert.equal((await stat(madeHere)).mode & 0o777, 0o700);
    for (const fileName of await readdir(madeHere)) {
      assert.equal((await stat(join(madeHere, fileName))).mode & 0o777, 0o600, fileName);
    }
    // A temporary file left behind open to everyone does not pass its mode on to the backup.
    const document = await store.exportRun('the-mill');
    const fileName = backupFileName('the-mill', LATER);
    await writeFile(join(madeHere, `${fileName}.tmp`), 'left behind', { mode: 0o644 });
    await writeBackupFile(madeHere, document, LATER);
    assert.equal((await stat(join(madeHere, fileName))).mode & 0o777, 0o600);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('a round that cannot make its folder at all fails as a whole, and the timer says so and carries on', async () => {
  const into = await freshFolder();
  try {
    const notAFolder = join(into, 'a-file');
    await writeFile(notAFolder, '');
    await assert.rejects(backUpEveryRun(store, { folder: notAFolder, backupsToKeep: 2 }, MOMENT));
    const lines: Array<['info' | 'error', string]> = [];
    const backups = startScheduledBackups(store, { folder: notAFolder, backupsToKeep: 2, everyHours: 24 }, {
      info: (line) => lines.push(['info', line]), error: (line) => lines.push(['error', line]),
    }, { firstAfterMilliseconds: 60 * 60 * 1000 });
    try {
      await backups.runOnce();
    } finally {
      backups.stop();
    }
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.[0], 'error');
    assert.match(lines[0]?.[1] ?? '', /failed .*carries on/);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('the timer runs a round shortly after start and logs it in one line of slugs and counts', async () => {
  const into = await freshFolder();
  try {
    const lines: string[] = [];
    let roundDone: () => void = () => {};
    const done = new Promise<void>((resolve) => { roundDone = resolve; });
    const backups = startScheduledBackups(store, { folder: into, backupsToKeep: 3, everyHours: 24 }, {
      info: (line) => { lines.push(line); roundDone(); }, error: (line) => { lines.push(line); roundDone(); },
    }, { firstAfterMilliseconds: 1, now: () => MOMENT });
    try {
      await done;
    } finally {
      backups.stop();
    }
    assert.match(lines[0] ?? '', /^Backups of every run: 2 written, 0 unchanged since their last backup, 0 older files let go\.$/);
    assert.equal((await readdir(into)).length, 2);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test('a round said in words names failed runs by slug and kind of failure only', () => {
  const failure = Object.assign(new Error('a line of a run'), { code: 'EACCES' });
  assert.equal(failureInWords(failure), 'Error, EACCES');
  assert.equal(failureInWords(new TypeError('a line of a run')), 'TypeError');
  assert.equal(
    backupRoundInWords({ written: ['the-mill'], unchanged: [], failed: [{ runSlug: 'the-weir', reason: 'Error, EACCES' }], filesLetGo: 1 }),
    'Backups of every run: 1 written, 0 unchanged since their last backup, 1 older file let go. 1 failed: the-weir (Error, EACCES).',
  );
});

test('the settings are read from the environment, and a setting that cannot be read stops the start', () => {
  assert.equal(scheduledBackupSettingsFromEnvironment({}), null);
  assert.equal(scheduledBackupSettingsFromEnvironment({ TIMEWEFT_BACKUP_FOLDER: '  ' }), null);
  assert.deepEqual(scheduledBackupSettingsFromEnvironment({ TIMEWEFT_BACKUP_FOLDER: '/backups' }), {
    folder: '/backups', everyHours: DEFAULT_BACKUP_EVERY_HOURS, backupsToKeep: DEFAULT_BACKUPS_TO_KEEP,
  });
  assert.deepEqual(scheduledBackupSettingsFromEnvironment({ TIMEWEFT_BACKUP_FOLDER: '/backups', TIMEWEFT_BACKUP_EVERY_HOURS: '6', TIMEWEFT_BACKUPS_TO_KEEP: '30' }), {
    folder: '/backups', everyHours: 6, backupsToKeep: 30,
  });
  assert.equal(DEFAULT_BACKUP_EVERY_HOURS, 24);
  assert.equal(DEFAULT_BACKUPS_TO_KEEP, 14);
  for (const everyHours of ['0', '-1', 'daily', '1000']) {
    assert.throws(() => scheduledBackupSettingsFromEnvironment({ TIMEWEFT_BACKUP_FOLDER: '/backups', TIMEWEFT_BACKUP_EVERY_HOURS: everyHours }), /TIMEWEFT_BACKUP_EVERY_HOURS/);
  }
  for (const keep of ['0', '2.5', 'all']) {
    assert.throws(() => scheduledBackupSettingsFromEnvironment({ TIMEWEFT_BACKUP_FOLDER: '/backups', TIMEWEFT_BACKUPS_TO_KEEP: keep }), /TIMEWEFT_BACKUPS_TO_KEEP/);
  }
});
