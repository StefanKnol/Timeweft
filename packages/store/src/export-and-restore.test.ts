/**
 * Export and restore: a run carried out of the store whole and put back exactly as it was.
 *
 * Two kinds of test. The completeness tests ask the database's own catalogue which tables a run's
 * rows live in, and fail naming any table the export does not carry, or any column it carries
 * differently from the catalogue. The round-trip tests build a busy run (a redo with its struck
 * take, the author's hand, collisions, an author-only entry), export it, restore it somewhere
 * else, export it again and hold the two documents equal, and hold the briefing a story reads equal.
 *
 * A made-up demo world: a miller, a ferry, a ford and a lantern.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  OPERATIONS, RUN_EXPORT_TABLE_NAMES, Refusal, type InputOf, type OperationName, type RequestOf,
  type RunExportDocument, type Store,
} from '@timeweft/contract';
// The briefing is a pure package beside this one, read here only to hold a restore to what a story sees.
import { buildBriefing } from '../../briefing/src/index.ts';
import { PostgresStore, openStoreForTests } from './index.ts';
import { beginDemoRun, redoInput, sceneInput, stateFactInput } from './demo-world.ts';
import { CATALOGUE_TYPE_OF_KIND, RUN_TABLE_COLUMNS, columnNamesOf } from './run-tables.ts';

let store: Store;
let dispose: () => Promise<void>;
let elsewhere: Store;
let disposeElsewhere: () => Promise<void>;
let runCounter = 0;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
  ({ store: elsewhere, dispose: disposeElsewhere } = await openStoreForTests());
});
after(async () => {
  await dispose();
  await disposeElsewhere();
});

function inputOf<Name extends OperationName>(name: Name, request: RequestOf<Name>): InputOf<Name> {
  return OPERATIONS[name].input.parse(request) as InputOf<Name>;
}

function databaseOf(of: Store) {
  return (of as PostgresStore).database;
}

/** A document without the moment it was taken, which is the one thing two exports of one run differ in. */
function withoutWhenTaken(document: RunExportDocument): Omit<RunExportDocument, 'exportedAt'> {
  const { exportedAt: _differsEveryTime, ...rest } = document;
  return rest;
}

/** A copy that shares nothing with the original, as a file read back would. */
function asReadFromAFile(document: RunExportDocument): RunExportDocument {
  return JSON.parse(JSON.stringify(document)) as RunExportDocument;
}

async function storyBriefing(of: Store, slug: string) {
  return buildBriefing(await of.snapshotOf(slug, 'story'), { upcoming: ['the lantern'], budgetBytes: 40_000 });
}

/**
 * A busy run: two scenes and a redone third with its struck take, clock readings, a journey, a
 * ruling withdrawn, threads opened, touched by a scene and by the author and closed, a waypoint
 * reached, one reworded and one withdrawn, the run and an entry edited, a fact ended, an
 * author-only entry and an author-only fact, a collision settled and one waiting.
 */
async function busyRun(of: Store = store): Promise<string> {
  const store = of;
  runCounter += 1;
  const slug = `busy-ford-${runCounter}`;
  await beginDemoRun(store, slug);
  const first = await store.saveScene(sceneInput({
    run: slug, place: 'the ford', title: 'The river rises',
    readings: [{ clock: 'days since the flood', count: 1, partOfDay: 'dawn' }],
    entries: [
      { name: 'Odo the miller', kind: 'person', alsoKnownAs: ['the miller'], pronoun: 'he' },
      { name: 'the lantern', kind: 'item' }, { name: 'the ford', kind: 'place' }, { name: 'the ferry', kind: 'item' },
    ],
    facts: [
      { entry: 'the lantern', property: 'held by', value: 'Odo', about: 'Odo the miller' },
      { entry: 'Odo the miller', property: 'age', value: 'sixty', statedByAuthor: true },
      { entry: 'the ferry', property: 'colour', value: 'green', statedByAuthor: true },
    ],
    notes: [{ entry: 'the lantern', text: 'It was lit at dusk.' }],
    rulings: [{ text: 'Nobody swims the ford.', topics: ['the river'], about: ['the ford'] }, { text: 'Narrate in the past tense.', topics: ['narration'] }],
    threadsOpened: [{ text: 'Who cut the ferry rope?', about: ['the ferry'] }, { text: 'Will Odo sell the mill?', about: ['Odo the miller'] }],
    legs: [{ from: 'the mill', to: 'the ford', duration: 'an hour', note: 'Odo walked.' }],
  }));
  const threads = (await store.snapshotOf(slug, 'author')).threads;
  const ropeThread = threads.find((thread) => thread.text.startsWith('Who cut'))!;
  const millThread = threads.find((thread) => thread.text.startsWith('Will Odo'))!;
  const waypoint = (await store.snapshotOf(slug, 'author')).waypoints[0]!;
  const second = await store.saveScene(sceneInput({
    run: slug, title: 'The ferry drifts',
    readings: [{ clock: 'days since the flood', count: '2.5' }],
    facts: [{ entry: 'Odo the miller', property: 'age', value: 'forty' }, { entry: 'the ferry', property: 'colour', value: 'red' }],
    threadsTouched: [{ thread: ropeThread.id, note: 'A knife was found.' }],
    waypointsReached: [waypoint.id],
  }));
  await store.settleCollision({ collision: second.collisions.find((collision) => collision.proposedValue === 'red')!.id, take: 'story' });
  await store.saveScene(sceneInput({
    run: slug, title: 'A first try at the bridge', entries: [{ name: 'the bridge', kind: 'place' }],
    facts: [{ entry: 'the lantern', property: 'state', value: 'out' }],
    threadsClosed: [{ thread: millThread.id, resolution: 'He kept it.' }],
  }));
  await store.redoScene(redoInput({
    run: slug, number: 3, title: 'The bridge, again',
    facts: [{ entry: 'the lantern', property: 'state', value: 'burning' }],
    notes: [{ entry: 'Odo the miller', text: 'He waited by the water.' }],
  }));
  const secret = await store.addEntry(inputOf('add_entry', { run: slug, name: 'the drowned bell', kind: 'item', visibility: 'author-only' }));
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the smith at the mill', visibility: 'author-only' }));
  await store.editRun(inputOf('edit_run', { run: slug, title: 'The Ford at Night', register: 'Close third person, past tense.' }));
  await store.editEntry(inputOf('edit_entry', { entry: secret.entry.id, alsoKnownAs: ['the bell'] }));
  await store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: waypoint.id, text: 'The ferry crosses at midnight.' }));
  const second_waypoint = await store.addWaypoint(inputOf('add_waypoint', { run: slug, text: 'The bell rings.' }));
  await store.withdrawWaypoint(inputOf('withdraw_waypoint', { waypoint: second_waypoint.id }));
  await store.touchThread(inputOf('touch_thread', { thread: ropeThread.id, note: 'The author says the knife was bent.' }));
  const ruling = (await store.snapshotOf(slug, 'author')).rulings.find((each) => each.text.startsWith('Narrate'))!;
  await store.withdrawRuling(inputOf('withdraw_ruling', { ruling: ruling.id }));
  const heldBy = (await store.snapshotOf(slug, 'author')).facts.find((fact) => fact.property === 'held by' && fact.untilSceneId === null)!;
  await store.endFact(inputOf('end_fact', { fact: heldBy.id }));
  assert.ok(first.scene.id);
  return slug;
}

/** Every table that holds a run's rows, found by walking the foreign keys outward from runs. */
async function tablesHoldingARunsRows(of: Store): Promise<string[]> {
  const result = await sql<{ table_name: string }>`
    with recursive holding(table_id) as (
      select 'runs'::regclass::oid
      union
      select constraints.conrelid from pg_constraint constraints join holding on constraints.confrelid = holding.table_id
      where constraints.contype = 'f'
    )
    select tables.relname as table_name from holding join pg_class tables on tables.oid = holding.table_id
    join pg_namespace schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = current_schema()
    order by tables.relname`.execute(databaseOf(of));
  return result.rows.map((row) => row.table_name);
}

async function catalogueColumns(of: Store, table: string) {
  const result = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_schema = current_schema() and table_name = ${table} order by ordinal_position`.execute(databaseOf(of));
  return result.rows;
}

test('the export carries every table the catalogue says holds a run\'s rows, with every column', async () => {
  const slug = await busyRun();
  const document = await store.exportRun(slug);
  const tablesInTheDatabase = await tablesHoldingARunsRows(store);
  assert.ok(tablesInTheDatabase.includes('scene_readings') && tablesInTheDatabase.includes('thread_touches'), 'the walk reaches tables a run holds only through another table');
  for (const table of tablesInTheDatabase) {
    const rows = (document.tables as unknown as Record<string, unknown>)[table];
    assert.ok(Array.isArray(rows), `The export does not carry the table ${table}, which holds a run's rows.`);
    const columns = (await catalogueColumns(store, table)).map((column) => column.column_name).sort();
    for (const row of rows as Array<Record<string, unknown>>) {
      assert.deepEqual(Object.keys(row).sort(), columns, `A row of ${table} in the export does not carry exactly the table's columns.`);
    }
  }
  assert.deepEqual([...Object.keys(document.tables)].sort(), [...tablesInTheDatabase].sort(), 'The export carries a table the catalogue does not say holds a run\'s rows.');
  assert.deepEqual([...RUN_EXPORT_TABLE_NAMES].sort(), [...tablesInTheDatabase].sort());
  // A busy run fills every table, so every column above was read from a real row.
  for (const table of tablesInTheDatabase) {
    assert.ok(((document.tables as unknown as Record<string, unknown[]>)[table] ?? []).length > 0, `The busy run holds no row of ${table}, so its columns were not checked.`);
  }
});

test('the description of each column agrees with the catalogue: its name, its type and whether it may be empty', async () => {
  for (const table of RUN_EXPORT_TABLE_NAMES) {
    const catalogue = await catalogueColumns(store, table);
    assert.deepEqual(columnNamesOf(table).sort(), catalogue.map((column) => column.column_name).sort(), `The columns of ${table}`);
    for (const column of catalogue) {
      const description = (RUN_TABLE_COLUMNS[table] as Record<string, { kind: keyof typeof CATALOGUE_TYPE_OF_KIND; mayBeEmpty: boolean }>)[column.column_name]!;
      assert.equal(CATALOGUE_TYPE_OF_KIND[description.kind], column.data_type, `The type of ${table}.${column.column_name}`);
      assert.equal(description.mayBeEmpty, column.is_nullable === 'YES', `Whether ${table}.${column.column_name} may be empty`);
    }
  }
});

test('a busy run restored into another store exports exactly as it did, and a story reads the same briefing', async () => {
  const slug = await busyRun();
  const before = await store.exportRun(slug);
  assert.match(before.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  assert.ok(before.tables.scenes.some((scene) => scene.status === 'struck'), 'the busy run holds a struck take');
  assert.ok(before.tables.entries.some((entry) => entry.visibility === 'author-only'), 'the busy run holds an author-only entry');
  assert.deepEqual(before.tables.collisions.map((collision) => collision.state).sort(), ['story-taken', 'waiting']);
  const report = await elsewhere.restoreRun(asReadFromAFile(before), { replace: false });
  assert.equal(report.replaced, null);
  assert.equal(report.run.slug, slug);
  assert.equal(report.run.title, 'The Ford at Night');
  for (const table of RUN_EXPORT_TABLE_NAMES) assert.equal(report.rowsRestored[table], before.tables[table].length, table);
  const after = await elsewhere.exportRun(slug);
  assert.deepEqual(withoutWhenTaken(after), withoutWhenTaken(before));
  assert.deepEqual(await storyBriefing(elsewhere, slug), await storyBriefing(store, slug));
  assert.deepEqual(await elsewhere.snapshotOf(slug, 'author'), await store.snapshotOf(slug, 'author'));
});

test('a run removed and restored in its own store comes back exactly, and later writes sort after it', async () => {
  const slug = await busyRun();
  const before = await store.exportRun(slug);
  const briefingBefore = await storyBriefing(store, slug);
  await databaseOf(store).deleteFrom('runs').where('slug', '=', slug).execute();
  await store.restoreRun(asReadFromAFile(before), { replace: false });
  assert.deepEqual(withoutWhenTaken(await store.exportRun(slug)), withoutWhenTaken(before));
  assert.deepEqual(await storyBriefing(store, slug), briefingBefore);

  // A store that never wrote these rows still gives later writes higher orders and marks.
  await elsewhere.restoreRun(asReadFromAFile(before), { replace: false });
  const saved = await elsewhere.saveScene(sceneInput({ run: slug, title: 'After the restore', facts: [{ entry: 'the ferry', property: 'state', value: 'moored' }] }));
  const after = await elsewhere.exportRun(slug);
  const restoredScenes = before.tables.scenes;
  const newScene = after.tables.scenes.find((scene) => scene.id === saved.scene.id)!;
  const highest = (values: string[]) => values.map(BigInt).reduce((left, right) => (left > right ? left : right));
  assert.ok(BigInt(newScene.written_order) > highest(restoredScenes.map((scene) => scene.written_order)));
  const everyRestoredMark = RUN_EXPORT_TABLE_NAMES.flatMap((table) => (before.tables[table] as unknown as Array<Record<string, unknown>>)
    .map((row) => row['write_mark']).filter((mark): mark is string => typeof mark === 'string'));
  assert.ok(BigInt(newScene.write_mark) > highest(everyRestoredMark));
  const newFact = after.tables.facts.find((fact) => fact.value === 'moored')!;
  assert.ok(BigInt(newFact.written_order) > highest(before.tables.facts.map((fact) => fact.written_order)));
});

test('a run already there is refused without replace, and with replace is put back in its place', async () => {
  const slug = await busyRun();
  const before = await store.exportRun(slug);
  await assert.rejects(store.restoreRun(asReadFromAFile(before), { replace: false }),
    (error: unknown) => error instanceof Refusal && /already in the store/.test(error.message) && /nothing was changed/.test(error.message));
  await store.saveScene(sceneInput({ run: slug, title: 'Written after the backup' }));
  const report = await store.restoreRun(asReadFromAFile(before), { replace: true });
  assert.ok(report.replaced !== null);
  assert.equal(report.replaced.rowsRemoved.scenes, before.tables.scenes.length + 1);
  assert.deepEqual(withoutWhenTaken(await store.exportRun(slug)), withoutWhenTaken(before));
});

test('the same run under a new name is refused without replace, and replaced by its id with replace', async () => {
  const slug = await busyRun();
  const before = await store.exportRun(slug);
  const renamed = asReadFromAFile(before);
  renamed.tables.runs[0]!.slug = `${slug}-renamed`;
  renamed.runSlug = `${slug}-renamed`;
  await assert.rejects(store.restoreRun(renamed, { replace: false }),
    (error: unknown) => error instanceof Refusal && new RegExp(`under the name "${slug}"`).test(error.message));
  const report = await store.restoreRun(renamed, { replace: true });
  assert.equal(report.replaced?.run.slug, slug);
  assert.equal(report.run.slug, `${slug}-renamed`);
  assert.deepEqual((await store.listRuns()).filter((listing) => listing.run.id === before.tables.runs[0]!.id).map((listing) => listing.run.slug), [`${slug}-renamed`]);
});

test('a backup whose id and name belong to two different runs is refused even with replace', async () => {
  const slug = await busyRun();
  const other = await busyRun();
  const document = asReadFromAFile(await store.exportRun(slug));
  document.tables.runs[0]!.slug = other;
  await assert.rejects(store.restoreRun(document, { replace: true }),
    (error: unknown) => error instanceof Refusal && /two runs/.test(error.message));
  assert.ok((await store.listRuns()).some((listing) => listing.run.slug === slug));
  assert.ok((await store.listRuns()).some((listing) => listing.run.slug === other));
});

test('a run others continue from may be replaced by itself, but not by a different run', async () => {
  runCounter += 1;
  const earlier = `earlier-ford-${runCounter}`;
  await beginDemoRun(store, earlier);
  await store.saveScene(sceneInput({ run: earlier, title: 'Before the flood' }));
  await store.beginRun(inputOf('begin_run', { slug: `${earlier}-after`, title: 'After the flood', continues: earlier }));
  const backup = await store.exportRun(earlier);
  await store.saveScene(sceneInput({ run: earlier, title: 'Written after the backup' }));
  const report = await store.restoreRun(asReadFromAFile(backup), { replace: true });
  assert.equal(report.run.id, backup.tables.runs[0]!.id);
  const continuing = (await store.snapshotOf(`${earlier}-after`, 'author')).run;
  assert.equal(continuing.continuesRunId, backup.tables.runs[0]!.id);

  // A different run, made in the other store, so none of its ids are here.
  const takingTheName = asReadFromAFile(await elsewhere.exportRun(await busyRun(elsewhere)));
  takingTheName.tables.runs[0]!.slug = earlier;
  await assert.rejects(store.restoreRun(takingTheName, { replace: true }),
    (error: unknown) => error instanceof Refusal && /continuing from nothing/.test(error.message) && error.message.includes(`"${earlier}-after"`));
});

test('a backup of a run that continues from a run the store lacks is refused, naming that run', async () => {
  runCounter += 1;
  const earlier = `missing-ford-${runCounter}`;
  await beginDemoRun(store, earlier);
  await store.beginRun(inputOf('begin_run', { slug: `${earlier}-after`, title: 'After', continues: earlier }));
  const backup = await store.exportRun(`${earlier}-after`);
  assert.deepEqual(backup.continuesRun?.slug, earlier);
  await assert.rejects(elsewhere.restoreRun(asReadFromAFile(backup), { replace: false }),
    (error: unknown) => error instanceof Refusal && error.message.includes(`"${earlier}"`) && /Restore that run first/.test(error.message));
});

test('a backup in a format version this store does not read is refused, saying which it reads', async () => {
  const document = asReadFromAFile(await store.exportRun(await busyRun()));
  document.formatVersion = 99;
  await assert.rejects(elsewhere.restoreRun(document, { replace: false }),
    (error: unknown) => error instanceof Refusal && /version 99/.test(error.message) && /reads version 1 only/.test(error.message));
});

test('rows a server would not write are refused by table and column, and nothing is written', async () => {
  const slug = await busyRun();
  const original = await store.exportRun(slug);
  await databaseOf(store).deleteFrom('runs').where('slug', '=', slug).execute();
  const withAStrayColumn = asReadFromAFile(original);
  (withAStrayColumn.tables.facts[0] as unknown as Record<string, unknown>)['colour'] = 'blue';
  await assert.rejects(store.restoreRun(withAStrayColumn, { replace: false }),
    (error: unknown) => error instanceof Refusal && /row 1 of facts has a column "colour"/.test(error.message));
  const withAMissingColumn = asReadFromAFile(original);
  delete (withAMissingColumn.tables.scenes[0] as unknown as Record<string, unknown>)['write_mark'];
  await assert.rejects(store.restoreRun(withAMissingColumn, { replace: false }),
    (error: unknown) => error instanceof Refusal && /row 1 of scenes has no "write_mark"/.test(error.message));
  const withABadMoment = asReadFromAFile(original);
  withABadMoment.tables.entries[0]!.created_at = '2026-11-13 09:30';
  await assert.rejects(store.restoreRun(withABadMoment, { replace: false }),
    (error: unknown) => error instanceof Refusal && /"created_at"/.test(error.message));
  const pointingElsewhere = asReadFromAFile(original);
  pointingElsewhere.tables.facts[0]!.from_scene_id = randomUUID();
  await assert.rejects(store.restoreRun(pointingElsewhere, { replace: false }),
    (error: unknown) => error instanceof Refusal && /row 1 of facts points in "from_scene_id" at a row of scenes the backup does not hold/.test(error.message));
  const ofAnotherRun = asReadFromAFile(original);
  ofAnotherRun.tables.clocks[0]!.run_id = randomUUID();
  await assert.rejects(store.restoreRun(ofAnotherRun, { replace: false }),
    (error: unknown) => error instanceof Refusal && /row 1 of clocks belongs to another run than the one the backup holds/.test(error.message));
  const breakingACheck = asReadFromAFile(original);
  breakingACheck.tables.entries[0]!.kind = 'dragon';
  await assert.rejects(store.restoreRun(breakingACheck, { replace: false }),
    (error: unknown) => error instanceof Refusal && /rows of entries break a rule the store keeps/.test(error.message));
  assert.equal((await store.listRuns()).some((listing) => listing.run.slug === slug), false, 'nothing was written');
  await store.restoreRun(asReadFromAFile(original), { replace: false });
});

test('values PostgreSQL could not keep are refused by row and column before anything is written', async () => {
  const slug = await busyRun();
  const original = await store.exportRun(slug);
  await databaseOf(store).deleteFrom('runs').where('slug', '=', slug).execute();
  const cases: Array<[string, (document: RunExportDocument) => void, RegExp]> = [
    ['a day the calendar lacks', (document) => { document.tables.entries[0]!.created_at = '2026-02-30T10:00:00.000000Z'; }, /row 1 of entries holds .* in "created_at", which must be a moment on a real day/],
    ['an hour past the day', (document) => { document.tables.entries[0]!.created_at = '2026-02-03T24:00:00.000000Z'; }, /"created_at"/],
    ['the year nought', (document) => { document.tables.entries[0]!.created_at = '0000-01-01T00:00:00.000000Z'; }, /"created_at"/],
    ['a number beyond what bigint holds', (document) => { document.tables.scenes[0]!.write_mark = '99999999999999999999'; }, /row 1 of scenes .* in "write_mark", which must be a whole number from 1 to 4611686018427387904/],
    ['the highest mark bigint holds', (document) => { document.tables.scenes[0]!.write_mark = '9223372036854775807'; }, /"write_mark"/],
    ['an order written just past the highest taken', (document) => { document.tables.facts[0]!.written_order = (2n ** 62n + 1n).toString(); }, /row 1 of facts .* in "written_order"/],
    ['a mark of nought', (document) => { document.tables.scenes[0]!.write_mark = '0'; }, /"write_mark"/],
    ['the character of code zero in text', (document) => { document.tables.scenes[0]!.summary = 'a\u0000b'; }, /row 1 of scenes .* in "summary", which must be text without the character of code zero/],
    ['the character of code zero in a list', (document) => { document.tables.entries[0]!.also_known_as = ['a\u0000b']; }, /"also_known_as"/],
  ];
  for (const [what, change, said] of cases) {
    const document = asReadFromAFile(original);
    change(document);
    await assert.rejects(store.restoreRun(document, { replace: false }),
      (error: unknown) => error instanceof Refusal && /^This backup was not restored, and nothing was changed: /.test(error.message) && said.test(error.message), what);
  }
  assert.equal((await store.listRuns()).some((listing) => listing.run.slug === slug), false, 'nothing was written');
  const restored = await store.restoreRun(asReadFromAFile(original), { replace: false });
  assert.equal(restored.run.slug, slug);
  // The shared sequence was never moved by a refused value: a later write still takes an ordinary mark.
  const marks = await sql<{ mark: string }>`select max(write_mark)::text as mark from scenes`.execute(databaseOf(store));
  assert.ok(BigInt(marks.rows[0]!.mark) < 2n ** 40n);
});

test('a run named by a slug no run may have is refused, so a backup file can never be named by it', async () => {
  const slug = await busyRun();
  const original = await store.exportRun(slug);
  for (const strange of ['../../srv/x', 'a/b', 'the ford', 'x--y']) {
    const document = asReadFromAFile(original);
    document.tables.runs[0]!.slug = strange;
    document.runSlug = strange;
    await assert.rejects(store.restoreRun(document, { replace: true }),
      (error: unknown) => error instanceof Refusal && /the run is named by a slug no run may have/.test(error.message), strange);
  }
  assert.ok((await store.listRuns()).some((listing) => listing.run.slug === slug), 'the run was left as it was');
});

test('the tables are kept and exported in the contract\'s order', async () => {
  assert.deepEqual(Object.keys(RUN_TABLE_COLUMNS), [...RUN_EXPORT_TABLE_NAMES]);
  const slug = await busyRun();
  assert.deepEqual(Object.keys((await store.exportRun(slug)).tables), [...RUN_EXPORT_TABLE_NAMES]);
});

test('a backup holding an id another run already holds is refused, naming the table', async () => {
  const slug = await busyRun();
  const copy = asReadFromAFile(await store.exportRun(slug));
  copy.tables.runs[0]!.id = randomUUID();
  copy.tables.runs[0]!.slug = `${slug}-copy`;
  for (const table of RUN_EXPORT_TABLE_NAMES) {
    for (const row of copy.tables[table] as unknown as Array<Record<string, unknown>>) if ('run_id' in row) row['run_id'] = copy.tables.runs[0]!.id;
  }
  await assert.rejects(store.restoreRun(copy, { replace: false }),
    (error: unknown) => error instanceof Refusal && /of clocks in it/.test(error.message) && /another run in the store already holds/.test(error.message));
});

test('an imported run restored elsewhere can still be replaced by importing again, and refused once a story wrote', async () => {
  runCounter += 1;
  const slug = `imported-mill-${runCounter}`;
  const imported = {
    slug, title: 'The Mill', setting: 'A mill by a ford.', status: 'binding' as const, register: '',
    clocks: [{ name: 'days', countsFrom: 'the flood' }],
    scenes: [{ number: 1, title: 'Scene 1', starred: false, whenTyped: 'day 1', place: null, summary: 'The wheel turned.', record: '', steer: '', situationAfter: '', readings: [] }],
    entries: [{ name: 'the miller', kind: 'person' as const, alsoKnownAs: [], pronoun: '', introducedInScene: null, visibility: 'open' as const, facts: [], trail: [] }],
    rulings: [], threads: [], waypoints: [], legs: [], unplaced: [],
  };
  await store.importRun(imported);
  const backup = await store.exportRun(slug);
  assert.notEqual(backup.tables.runs[0]!.imported_through, null);
  await elsewhere.restoreRun(asReadFromAFile(backup), { replace: false });
  const replaced = await elsewhere.replaceImportedRun({ ...imported, title: 'The Mill, corrected' });
  assert.equal(replaced.snapshot.run.title, 'The Mill, corrected');

  await store.saveScene(sceneInput({ run: slug, title: 'A story wrote here' }));
  const written = await store.exportRun(slug);
  await elsewhere.restoreRun(asReadFromAFile(written), { replace: true });
  await assert.rejects(elsewhere.replaceImportedRun(imported), /wrote after it was imported/);
});

test('exporting a run the store lacks is refused', async () => {
  await assert.rejects(store.exportRun('no-such-ford'), (error: unknown) => error instanceof Refusal && /no run called "no-such-ford"/.test(error.message));
});
