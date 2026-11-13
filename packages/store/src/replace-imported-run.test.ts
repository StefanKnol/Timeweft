import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { sql } from 'kysely';
import {
  EarlierImportStandsInTheWay, OPERATIONS, Refusal, RunAlreadyExists, isRunAlreadyExistsSentence,
  type ImportedEntry, type ImportedRun, type ImportedScene, type Store,
} from '@timeweft/contract';
import { MIGRATIONS, PostgresStore, openStore, openStoreForTests, testDatabaseUrl } from './index.ts';
import { sceneInput, stateFactInput } from './demo-world.ts';
import { importRunInto } from './import.ts';

// A made-up demo world: a miller at a ford, imported from files and imported again.

let store: Store;
let dispose: () => Promise<void>;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

function scene(number: number): ImportedScene {
  return { number, title: `Scene ${number}`, starred: false, whenTyped: `day ${number}`, place: null, summary: 'The wheel turned.', record: '', steer: '', situationAfter: '', readings: [] };
}

function entry(name: string, extra: Partial<ImportedEntry> = {}): ImportedEntry {
  return { name, kind: 'person', alsoKnownAs: [], pronoun: '', introducedInScene: null, visibility: 'open', facts: [], trail: [], ...extra };
}

function millRun(slug: string, extra: Partial<ImportedRun> = {}): ImportedRun {
  return {
    slug, title: 'The Mill', setting: 'A mill by a ford.', status: 'binding', register: '',
    clocks: [{ name: 'days', countsFrom: 'the flood' }], scenes: [scene(1), scene(2)],
    entries: [entry('the miller', { facts: [{ property: 'where', value: 'at the mill', fromScene: 1, source: 'import', note: '' }], trail: [{ scene: 2, text: 'He ground the barley.' }] })],
    rulings: [{ text: 'Nobody swims.', source: 'author', scope: 'run', topics: [], about: [], scene: 1 }],
    threads: [{ text: 'Who broke the wheel?', about: ['the miller'], openedInScene: 1, closed: false, resolution: '' }],
    waypoints: [{ text: 'The wheel turns again.', reached: false }],
    legs: [{ from: 'the mill', to: 'the ford', duration: 'an hour', note: '', scene: 2 }],
    unplaced: [], ...extra,
  };
}

/** The same run with the miller moved on and a third scene, as corrected files would say. */
function correctedMillRun(slug: string, extra: Partial<ImportedRun> = {}): ImportedRun {
  return millRun(slug, {
    title: 'The Mill, corrected', scenes: [scene(1), scene(2), scene(3)],
    entries: [entry('the miller', { facts: [{ property: 'where', value: 'at the ford', fromScene: 3, source: 'import', note: '' }] }), entry('the baker')],
    ...extra,
  });
}

test('importing a slug that exists is refused with the sentence the page knows', async () => {
  await store.importRun(millRun('exists-already'));
  await assert.rejects(store.importRun(millRun('exists-already')), (error: unknown) =>
    error instanceof RunAlreadyExists && error.madeByAnImport && isRunAlreadyExistsSentence(error.message) && error.message.includes('"exists-already"'));
});

test('a slug taken by a run begun in a chat is refused without offering a replacement it would never make', async () => {
  await store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'taken-in-a-chat', title: 'The Ford' }));
  await assert.rejects(store.importRun(millRun('taken-in-a-chat')), (error: unknown) =>
    error instanceof RunAlreadyExists && !error.madeByAnImport
    && !isRunAlreadyExistsSentence(error.message) && !/can be replaced/.test(error.message)
    && /under another slug/.test(error.message));
});

test('replacing an earlier import removes it and imports the files in its place, counting both', async () => {
  const earlier = await store.importRun(millRun('replaced'));
  const replaced = await store.replaceImportedRun(correctedMillRun('replaced'));
  assert.deepEqual(replaced.removed, {
    scenes: 2, entries: 1, facts: 1, trailNotes: 1, rulings: 1, threads: 1, waypoints: 1, journeyLegs: 1, clocks: 1,
  });
  assert.notEqual(replaced.snapshot.run.id, earlier.run.id);
  assert.equal(replaced.snapshot.run.title, 'The Mill, corrected');
  assert.equal(replaced.snapshot.scenes.length, 3);
  assert.deepEqual(replaced.snapshot.entries.map((each) => each.name).sort(), ['the baker', 'the miller']);
  assert.deepEqual(replaced.snapshot.facts.map((fact) => fact.value), ['at the ford']);
  assert.equal(replaced.snapshot.notes.length, 0);
  // Replacing again works too: what the replacing import wrote is an import like any other.
  const again = await store.replaceImportedRun(millRun('replaced'));
  assert.equal(again.removed?.scenes, 3);
  assert.equal(again.snapshot.run.title, 'The Mill');
});

test('replacing where no run has the slug simply imports, removing nothing', async () => {
  const replaced = await store.replaceImportedRun(millRun('never-there'));
  assert.equal(replaced.removed, null);
  assert.equal(replaced.snapshot.scenes.length, 2);
});

test('replacing is refused once a story has saved a scene in the run, and nothing changes', async () => {
  await store.importRun(millRun('played-on'));
  await store.saveScene(sceneInput({ run: 'played-on', facts: [{ entry: 'the miller', property: 'mood', value: 'tired' }] }));
  const before = await store.snapshotOf('played-on', 'author');
  await assert.rejects(store.replaceImportedRun(correctedMillRun('played-on')), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay
    && /1 scene, 1 fact/.test(error.message)
    && /wrote after it was imported/.test(error.message)
    && /nothing was changed/.test(error.message));
  assert.deepEqual(await store.snapshotOf('played-on', 'author'), before);
});

test('replacing is refused once the author has stated a fact in the run', async () => {
  await store.importRun(millRun('stated-on'));
  await store.stateFact(stateFactInput({ run: 'stated-on', entry: 'the miller', property: 'age', value: 'sixty' }));
  await assert.rejects(store.replaceImportedRun(correctedMillRun('stated-on')), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay && /: 1 fact\./.test(error.message));
});

test('replacing is refused for a run begun in a chat, which no import made', async () => {
  await store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'begun-in-a-chat', title: 'The Ford' }));
  await assert.rejects(store.replaceImportedRun(millRun('begun-in-a-chat')), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay && /no record that an import made it/.test(error.message));
  assert.equal((await store.snapshotOf('begun-in-a-chat', 'author')).run.title, 'The Ford');
});

test('replacing is refused for a run another run continues from, naming it', async () => {
  await store.importRun(millRun('followed'));
  await store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'the-sequel', title: 'After the Mill', continues: 'followed' }));
  await assert.rejects(store.replaceImportedRun(correctedMillRun('followed')), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay && /a run continues from it \("the-sequel"\)/.test(error.message));
});

test('an import the store refuses while replacing leaves the earlier run whole', async () => {
  const before = await store.importRun(millRun('kept-whole'));
  const broken = correctedMillRun('kept-whole', {
    entries: [entry('the miller', { trail: [{ scene: 99, text: 'He went nowhere.' }] })],
  });
  await assert.rejects(store.replaceImportedRun(broken), (error: unknown) =>
    error instanceof Refusal && !(error instanceof EarlierImportStandsInTheWay) && /scene 99/.test(error.message));
  assert.deepEqual(await store.snapshotOf('kept-whole', 'author'), before);
  // And it can still be replaced afterwards, so the refusal left nothing half written.
  assert.equal((await store.replaceImportedRun(correctedMillRun('kept-whole'))).removed?.scenes, 2);
});

test('a story\'s scene is found however far the database clock was stepped back after the import', async () => {
  await store.importRun(millRun('clock-stepped-back'));
  await store.saveScene(sceneInput({ run: 'clock-stepped-back' }));
  // As though the database host's clock went back an hour between the import and the save.
  const database = (store as PostgresStore).database;
  await sql`update scenes set created_at = created_at - interval '1 hour'
    where run_id = (select id from runs where slug = 'clock-stepped-back') and number = 3`.execute(database);
  await assert.rejects(store.replaceImportedRun(correctedMillRun('clock-stepped-back')), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay && /wrote after it was imported: 1 scene\./.test(error.message));
  assert.equal((await store.snapshotOf('clock-stepped-back', 'author')).scenes.length, 3);
});

/**
 * A schema at an older migration, for the store as it was before marks were kept. Each migration
 * is applied in a transaction with its record, as the store applies them, so a row a migration
 * rewrites shares that record's xmin. Hands the store, a raw query and the rest of the migrations.
 */
async function withAnOlderSchema(appliedUpTo: number, act: (older: PostgresStore, query: (text: string) => Promise<unknown>) => Promise<void>): Promise<void> {
  const databaseUrl = testDatabaseUrl();
  const schema = `test_older_${Math.random().toString(16).slice(2, 10)}`;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const query = (text: string) => client.query(text);
  await client.query(`create schema ${schema}`);
  await client.query(`set search_path to ${schema}`);
  await client.query(`create table timeweft_migrations (number integer primary key, name text not null, applied_at timestamptz not null default now())`);
  for (const migration of MIGRATIONS.filter((each) => each.number <= appliedUpTo)) {
    await client.query('begin');
    for (const statement of migration.statements) await client.query(statement);
    await client.query(`insert into timeweft_migrations (number, name) values ($1, $2)`, [migration.number, migration.name]);
    await client.query('commit');
  }
  const older = await openStore(databaseUrl, { schema }) as PostgresStore;
  try {
    await act(older, query);
  } finally {
    await older.close();
    await client.query(`drop schema ${schema} cascade`);
    await client.end();
  }
}

async function importTheOldWay(older: PostgresStore, run: ImportedRun): Promise<void> {
  await older.database.transaction().execute((transaction) => importRunInto(transaction, run));
}

test('the migration dates a run imported before marks were kept, refuses what a story wrote later, and leaves a begun run undated', async () => {
  await withAnOlderSchema(3, async (older, query) => {
    await importTheOldWay(older, millRun('imported-before'));
    await importTheOldWay(older, millRun('played-on-before'));
    // A story saved into the second in a later transaction, before the migration.
    await older.saveScene(sceneInput({ run: 'played-on-before', facts: [{ entry: 'the miller', property: 'mood', value: 'tired' }] }));
    await query(`insert into runs (slug, title, status) values ('begun-before', 'The Ford', 'binding')`);
    await older.migrate();
    await assert.rejects(older.replaceImportedRun(millRun('begun-before')), (error: unknown) =>
      error instanceof EarlierImportStandsInTheWay && /no record that an import made it/.test(error.message));
    await assert.rejects(older.replaceImportedRun(correctedMillRun('played-on-before')), (error: unknown) =>
      error instanceof EarlierImportStandsInTheWay && /wrote after it was imported: 1 scene, 1 fact\./.test(error.message));
    assert.equal((await older.snapshotOf('played-on-before', 'author')).scenes.length, 3);
    // The run nothing played on holds nothing but its import, so it can be replaced; after a story saves, it cannot.
    assert.equal((await older.replaceImportedRun(millRun('imported-before'))).removed?.scenes, 2);
    await older.saveScene(sceneInput({ run: 'imported-before' }));
    await assert.rejects(older.replaceImportedRun(correctedMillRun('imported-before')), EarlierImportStandsInTheWay);
  });
});

test('a fact an upgrade rewrote after an old import is never blamed on a story, and never taken as the import\'s when it may be the author\'s', async () => {
  const bareRun = (slug: string) => millRun(slug, { rulings: [], threads: [], waypoints: [], legs: [],
    entries: [entry('the miller', { facts: [{ property: 'where', value: 'at the mill', fromScene: 1, source: 'import', note: '' }] })] });
  await withAnOlderSchema(1, async (older, query) => {
    await importTheOldWay(older, bareRun('bare'));
    await importTheOldWay(older, bareRun('stated-before'));
    // The author stated a fact in a later transaction, before migrations 2 and 3 rewrote every fact.
    await query(`insert into facts (run_id, entry_id, property, value, source, visibility)
      select runs.id, entries.id, 'age', 'sixty', 'author', 'open' from runs join entries on entries.run_id = runs.id
      where runs.slug = 'stated-before'`);
    await older.migrate();
    for (const slug of ['bare', 'stated-before']) {
      await assert.rejects(older.replaceImportedRun(correctedMillRun(slug)), (error: unknown) =>
        error instanceof EarlierImportStandsInTheWay
        && /an upgrade of the store since rewrote \d+ facts? in it/.test(error.message)
        && !/wrote after it was imported/.test(error.message));
    }
    assert.ok((await older.snapshotOf('stated-before', 'author')).facts.some((fact) => fact.value === 'sixty'));
  });
});

test('a run copied in one transaction, as a restore does, is left undated and its story\'s scene is kept', async () => {
  await withAnOlderSchema(3, async (older, query) => {
    await importTheOldWay(older, millRun('restored'));
    await older.saveScene(sceneInput({ run: 'restored' }));
    // A single-transaction restore gives every row it writes, the migrations' records too, one xmin.
    await query('begin');
    await query(`update timeweft_migrations set name = name`);
    await query(`update runs set title = title`);
    await query(`update scene_readings set count = count`);
    for (const table of ['clocks', 'scenes', 'entries', 'facts', 'entry_notes', 'rulings', 'threads', 'waypoints', 'journey_legs']) {
      await query(`update ${table} set run_id = run_id`);
    }
    await query('commit');
    await older.migrate();
    await assert.rejects(older.replaceImportedRun(correctedMillRun('restored')), (error: unknown) =>
      error instanceof EarlierImportStandsInTheWay && /no record that an import made it/.test(error.message));
    assert.equal((await older.snapshotOf('restored', 'author')).scenes.length, 3);
  });
});
