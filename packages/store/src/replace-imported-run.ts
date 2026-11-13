/**
 * Importing a run kept by hand again, over the run an earlier import of it made.
 *
 * The importer improves and the files get corrected, so the author imports the same run again.
 * This is the only door that removes a run, so it removes only what an import wrote:
 *
 * - Every row a run holds takes a write mark from one sequence when it is written, and an import
 *   marks its run with a mark taken after its last row (`imported_through`). Every row a story or
 *   the author writes afterwards carries a higher mark. A sequence only rises, so this holds even
 *   where the database's clock is stepped back. A door that changes a row writes one or marks it
 *   (a save writes a scene, a redo a new take, stating a fact or a ruling writes it, a collision is
 *   written when a save makes it; the author's hand keeps every earlier value as a history row, and
 *   a row the author changes in place, such as a fact ended or a thread closed, takes a fresh mark),
 *   so a run holding no row marked after its import holds nothing but the import.
 * - A run with no such mark was begun in a chat, or imported before the store kept marks and could
 *   not be dated, and is refused: it cannot be shown to hold nothing but an import.
 * - A row a migration rewrote in a run imported before the marks, where it cannot be told whether
 *   the import or a later write made it, is refused too, and said as exactly that.
 * - A run another run continues from is refused, naming those runs. Re-pointing them at the new
 *   run was not done: a continuing run reads its predecessor's present, and whether the files
 *   imported again still give it the same present is the author's to judge, not this door's.
 *
 * The removal and the import are one transaction, so an import the store refuses (or one that
 * fails part way) leaves the earlier run exactly as it was.
 */
import { sql, type Kysely } from 'kysely';
import { EarlierImportStandsInTheWay, type ImportedRun, type RunCounts } from '@timeweft/contract';
import type { Database } from './database.ts';
import { importRunInto } from './import.ts';
import { CANNOT_BE_TOLD_MARK, TABLES_THE_AUTHORS_HAND_WRITES, WRITE_MARKS } from './migrations.ts';

/** The tables a run's rows are counted in, by the name the counts give them. */
const COUNTED_TABLES = {
  scenes: 'scenes',
  entries: 'entries',
  facts: 'facts',
  trailNotes: 'entry_notes',
  rulings: 'rulings',
  threads: 'threads',
  waypoints: 'waypoints',
  journeyLegs: 'journey_legs',
  clocks: 'clocks',
} as const satisfies Record<keyof RunCounts, keyof Database>;

/** Each kind as the refusal names it, singular and plural. */
const KIND_IN_WORDS: Record<keyof RunCounts | 'collisions', [string, string]> = {
  scenes: ['scene', 'scenes'],
  entries: ['entry', 'entries'],
  facts: ['fact', 'facts'],
  trailNotes: ['trail note', 'trail notes'],
  rulings: ['ruling', 'rulings'],
  threads: ['thread', 'threads'],
  waypoints: ['waypoint', 'waypoints'],
  journeyLegs: ['journey leg', 'journey legs'],
  clocks: ['clock', 'clocks'],
  collisions: ['collision', 'collisions'],
};

/** The author's history rows, as the refusal names them. An import never writes one. */
const AUTHORS_HISTORY_IN_WORDS: Record<(typeof TABLES_THE_AUTHORS_HAND_WRITES)[number], [string, string]> = {
  run_edits: ["change to the run's title, setting, register or status", "changes to the run's title, setting, register or status"],
  entry_edits: ['change to an entry', 'changes to entries'],
  waypoint_rewordings: ['rewording of a waypoint', 'rewordings of waypoints'],
};

function countInWords(count: number, kind: keyof typeof KIND_IN_WORDS): string {
  const [singular, plural] = KIND_IN_WORDS[kind];
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Marks a run as written by an import, with a write mark taken after every row the import wrote.
 * Called last in the import's transaction.
 */
export async function markRunAsImported(database: Kysely<Database>, slug: string): Promise<void> {
  await database.updateTable('runs').set({ imported_through: sql<string>`nextval(${WRITE_MARKS}::regclass)` }).where('slug', '=', slug).execute();
}

/** Which of a run's rows are counted: all of them, those written after its import, or those that cannot be told. */
type RowsCounted = 'all' | 'written after the import' | 'cannot be told from the import';

/**
 * How much a run holds, kind by kind, of the rows asked for. The marks are compared inside
 * PostgreSQL. A row a migration rewrote that cannot be told from a later write is counted on its
 * own, never as written after the import, so that the refusal says what is true of it.
 */
async function countRowsOfRun(database: Kysely<Database>, runId: string, counted: RowsCounted): Promise<RunCounts> {
  const entries = await Promise.all((Object.keys(COUNTED_TABLES) as Array<keyof RunCounts>).map(async (kind) => {
    let query = database.selectFrom(COUNTED_TABLES[kind]).select(sql<number>`count(*)::int`.as('count')).where('run_id', '=', runId);
    if (counted === 'written after the import') {
      query = query.where(sql<boolean>`write_mark > (select imported_through from runs where runs.id = ${runId}) and write_mark <> ${CANNOT_BE_TOLD_MARK}`);
    } else if (counted === 'cannot be told from the import') {
      query = query.where(sql<boolean>`write_mark = ${CANNOT_BE_TOLD_MARK}`);
    }
    const row = await query.executeTakeFirstOrThrow();
    return [kind, row.count] as const;
  }));
  return Object.fromEntries(entries) as unknown as RunCounts;
}

/**
 * Why the run cannot be replaced, or null where it holds nothing but its import. Every reason is
 * said at once, in kinds, counts and slugs only.
 */
async function whatStandsInTheWay(database: Kysely<Database>, run: { id: string; slug: string; imported_through: string | null }): Promise<string | null> {
  if (run.imported_through === null) {
    return `The run "${run.slug}" was not replaced: the store has no record that an import made it (it was begun in a chat, or imported before the store kept when), so it cannot be shown to hold nothing but an import. Import the files under another slug.`;
  }
  const reasons: string[] = [];
  const writtenAfter = await countRowsOfRun(database, run.id, 'written after the import');
  const cannotBeTold = await countRowsOfRun(database, run.id, 'cannot be told from the import');
  const collisions = await database.selectFrom('collisions').select(sql<number>`count(*)::int`.as('count')).where('run_id', '=', run.id).executeTakeFirstOrThrow();
  const laterKinds = (Object.keys(writtenAfter) as Array<keyof RunCounts>).filter((kind) => writtenAfter[kind] > 0)
    .map((kind) => countInWords(writtenAfter[kind], kind));
  if (collisions.count > 0) laterKinds.push(countInWords(collisions.count, 'collisions'));
  for (const table of TABLES_THE_AUTHORS_HAND_WRITES) {
    const later = await database.selectFrom(table as 'run_edits').select(sql<number>`count(*)::int`.as('count')).where('run_id', '=', run.id)
      .where(sql<boolean>`write_mark > (select imported_through from runs where runs.id = ${run.id})`).executeTakeFirstOrThrow();
    if (later.count === 0) continue;
    const [singular, plural] = AUTHORS_HISTORY_IN_WORDS[table];
    laterKinds.push(`${later.count} ${later.count === 1 ? singular : plural}`);
  }
  if (laterKinds.length > 0) {
    reasons.push(`it holds what a story or the author wrote after it was imported: ${laterKinds.join(', ')}. Replacing it would lose that, and only a run holding nothing but its import is ever replaced.`);
  }
  const untoldKinds = (Object.keys(cannotBeTold) as Array<keyof RunCounts>).filter((kind) => cannotBeTold[kind] > 0)
    .map((kind) => countInWords(cannotBeTold[kind], kind));
  if (untoldKinds.length > 0) {
    reasons.push(`it was imported before the store kept which writes were an import's, and an upgrade of the store since rewrote ${untoldKinds.join(', ')} in it, so whether the import or a later write made ${untoldKinds.length === 1 && /^1 /.test(untoldKinds[0] ?? '') ? 'it' : 'them'} cannot be told.`);
  }
  const continuing = await database.selectFrom('runs').select('slug').where('continues_run_id', '=', run.id).orderBy('slug').execute();
  if (continuing.length > 0) {
    reasons.push(`${continuing.length === 1 ? 'a run continues' : `${continuing.length} runs continue`} from it (${continuing.map((each) => `"${each.slug}"`).join(', ')}), and removing it would leave ${continuing.length === 1 ? 'that run' : 'them'} continuing from nothing.`);
  }
  if (reasons.length === 0) return null;
  return `The earlier import of "${run.slug}" was not replaced, and nothing was changed: ${reasons.join(' Also, ')} Import the files under another slug instead.`;
}

/**
 * Removes the run an earlier import of this slug made and imports the files in its place. Runs
 * inside the caller's transaction. Answers with what was removed, or null where no run had the
 * slug and the files were simply imported.
 */
export async function replaceImportedRunIn(database: Kysely<Database>, imported: ImportedRun): Promise<RunCounts | null> {
  const earlier = await database.selectFrom('runs').select(['id', 'slug', 'imported_through'])
    .where('slug', '=', imported.slug).forUpdate().executeTakeFirst();
  let removed: RunCounts | null = null;
  if (earlier !== undefined) {
    const refusal = await whatStandsInTheWay(database, earlier);
    if (refusal !== null) throw new EarlierImportStandsInTheWay(refusal);
    removed = await countRowsOfRun(database, earlier.id, 'all');
    // Every table holding a run's rows cascades from the run, so this one delete takes them all.
    await database.deleteFrom('runs').where('id', '=', earlier.id).execute();
  }
  await importRunInto(database, imported);
  await markRunAsImported(database, imported.slug);
  return removed;
}
