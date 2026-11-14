/**
 * Putting a run back exactly as an export held it, straight into the tables, in one transaction.
 *
 * Nothing is read through a record and nothing is re-interpreted: every row is written with its id,
 * its order written, its write mark and its time as the document gives them. Before anything is
 * written the document is checked, table by table and column by column, and every id in it that
 * points into the run must point at a row the document itself holds, so a restore can never write
 * into another run. Afterwards the store's sequences are moved past the highest values written, so a
 * later write still sorts after every restored row and still reads as written after an import.
 *
 * With `replace`, the run in the way (the one with the document's id, or else its slug) is removed
 * whole first, inside the same transaction, so a restore that is refused or fails part way leaves it
 * exactly as it was. See docs/decisions/0004-export-and-restore.md.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';
import {
  RUN_EXPORT_TABLE_NAMES, Refusal, isRunSlug, whyTheFormatVersionIsNotRead,
  type RestoredRunReport, type RunExportDocument, type RunExportRowCounts, type RunExportTableName, type RunRecord,
} from '@timeweft/contract';
import type { Database } from './database.ts';
import { WRITE_MARKS } from './migrations.ts';
import { runFromRow } from './rows.ts';
import { HOW_A_RUNS_ROWS_ARE_FOUND, columnNamesOf, columnOf, type ColumnDescription } from './run-tables.ts';
import { looksLikeAnId } from './checks.ts';

type Row = Record<string, unknown>;

const EXACT_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
const BIG_WHOLE_NUMBER = /^\d+$/;

/**
 * The highest order written or write mark a restore takes: 2 to the 62nd, half of what PostgreSQL's
 * bigint holds. The store's sequences are moved past the highest value restored, and every later
 * write in every run takes the next value, so a backup edited to hold a value near the top would
 * leave the shared sequence with no room and every later write on the server failing. A real store
 * never comes near it: a write a microsecond for a hundred thousand years is about 2 to the 52nd.
 */
export const HIGHEST_MARK_RESTORED = 2n ** 62n;

/** The most values one insert statement is given, well under PostgreSQL's limit of 65,535. */
const LARGEST_VALUES_PER_STATEMENT = 20_000;

/** The tables that keep their order written from an identity, which a restore writes over. */
const TABLES_WITH_AN_ORDER_WRITTEN = RUN_EXPORT_TABLE_NAMES.filter((table) => columnOf(table, 'written_order') !== undefined);

/** The tables whose rows have an id and a run id of their own. */
const TABLES_WITH_THEIR_OWN_IDS = RUN_EXPORT_TABLE_NAMES.filter((table) => table !== 'runs' && columnOf(table, 'id') !== undefined);

function emptyCounts(): RunExportRowCounts {
  return Object.fromEntries(RUN_EXPORT_TABLE_NAMES.map((table) => [table, 0])) as RunExportRowCounts;
}

function refuseTheRows(sentence: string): never {
  throw new Refusal(`This backup was not restored, and nothing was changed: ${sentence} The file may have been edited, or written by a server whose tables differ.`);
}

/** Text PostgreSQL keeps: any text but the character of code zero, which it cannot store. */
function isTextTheStoreKeeps(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\u0000');
}

/** A moment written as the export writes one, on a day the calendar has, in years 1 to 9999. */
function isAnExactTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = EXACT_TIMESTAMP.exec(value);
  if (parts === null) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (year < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const moment = new Date(0);
  moment.setUTCFullYear(year, month - 1, day);
  return moment.getUTCFullYear() === year && moment.getUTCMonth() === month - 1 && moment.getUTCDate() === day;
}

/** Whether a value is of the kind its column keeps. Emptiness is checked apart. */
function valueIsOfItsKind(description: ColumnDescription, value: unknown): boolean {
  switch (description.kind) {
    case 'id': return typeof value === 'string' && looksLikeAnId(value);
    case 'text': return isTextTheStoreKeeps(value);
    case 'text list': return Array.isArray(value) && value.every(isTextTheStoreKeeps);
    case 'whole number': return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 2_147_483_647;
    case 'true or false': return typeof value === 'boolean';
    case 'big whole number': {
      if (typeof value !== 'string' || !BIG_WHOLE_NUMBER.test(value)) return false;
      const number = BigInt(value);
      return number >= 1n && number <= HIGHEST_MARK_RESTORED;
    }
    case 'exact timestamp': return isAnExactTimestamp(value);
  }
}

const KIND_IN_WORDS: Record<ColumnDescription['kind'], string> = {
  'id': 'an id',
  'text': 'text without the character of code zero, which the store cannot keep',
  'text list': 'a list of text without the character of code zero, which the store cannot keep',
  'whole number': 'a whole number',
  'true or false': 'true or false',
  'big whole number': `a whole number from 1 to ${HIGHEST_MARK_RESTORED} written as text`,
  'exact timestamp': 'a moment on a real day, written as 2026-11-13T09:30:00.123456Z',
};

/**
 * Checks every row of the document before anything is written: each row has exactly the columns its
 * table has, each value is of its column's kind, nothing is empty that may not be, every row belongs
 * to the document's run, no table holds one id twice, and every id that points into the run points
 * at a row the document holds.
 */
export function checkTheRows(document: RunExportDocument): void {
  const tables = document.tables as unknown as Record<RunExportTableName, unknown[]>;
  const run = tables.runs[0] as Row;
  const idsHeld = new Map<RunExportTableName, Set<string>>();
  for (const table of RUN_EXPORT_TABLE_NAMES) {
    const columns = columnNamesOf(table);
    for (const [index, candidate] of tables[table].entries()) {
      const where = `row ${index + 1} of ${table}`;
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) refuseTheRows(`${where} is not a row.`);
      const row = candidate as Row;
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) refuseTheRows(`${where} has a column "${key}", which ${table} does not have.`);
      }
      for (const column of columns) {
        if (!(column in row)) refuseTheRows(`${where} has no "${column}", which every row of ${table} has.`);
        const description = columnOf(table, column)!;
        const value = row[column];
        if (value === null) {
          if (!description.mayBeEmpty) refuseTheRows(`${where} holds nothing in "${column}", which may not be empty.`);
          continue;
        }
        if (!valueIsOfItsKind(description, value)) {
          refuseTheRows(`${where} holds ${JSON.stringify(value).slice(0, 60)} in "${column}", which must be ${KIND_IN_WORDS[description.kind]}.`);
        }
      }
      if (columns.includes('id')) {
        const held = idsHeld.get(table) ?? new Set<string>();
        if (held.has(row['id'] as string)) refuseTheRows(`${table} holds the id ${String(row['id'])} twice.`);
        held.add(row['id'] as string);
        idsHeld.set(table, held);
      }
      if (columns.includes('run_id') && row['run_id'] !== run['id']) {
        refuseTheRows(`${where} belongs to another run than the one the backup holds.`);
      }
    }
  }
  if (!isRunSlug(run['slug'])) {
    refuseTheRows('the run is named by a slug no run may have: a slug is lower-case letters and digits joined by single hyphens.');
  }
  for (const table of RUN_EXPORT_TABLE_NAMES) {
    for (const [index, row] of (tables[table] as Row[]).entries()) {
      for (const column of columnNamesOf(table)) {
        const pointsInto = columnOf(table, column)!.pointsInto;
        const value = row[column];
        if (pointsInto === undefined || value === null) continue;
        if (!(idsHeld.get(pointsInto)?.has(value as string) ?? false)) {
          refuseTheRows(`row ${index + 1} of ${table} points in "${column}" at a row of ${pointsInto} the backup does not hold.`);
        }
      }
    }
  }
}

/** How many rows of each table the run holds. */
async function countRowsOfRun(database: Kysely<Database>, runId: string): Promise<RunExportRowCounts> {
  const counts = emptyCounts();
  for (const table of RUN_EXPORT_TABLE_NAMES) {
    const found = HOW_A_RUNS_ROWS_ARE_FOUND[table];
    const result = await sql<{ count: number }>`select count(*)::int as count from ${sql.raw(found.from)} where ${sql.raw(found.runIdIn)} = ${runId}`.execute(database);
    counts[table] = result.rows[0]!.count;
  }
  return counts;
}

/** One value as an insert writes it, cast to its column's type. */
function valueToWrite(description: ColumnDescription, value: unknown): RawBuilder<unknown> {
  if (value === null) return sql`null`;
  switch (description.kind) {
    case 'exact timestamp': return sql`${value}::timestamptz`;
    case 'big whole number': return sql`${value}::bigint`;
    case 'text list': return sql`${value}::text[]`;
    case 'id': return sql`${value}::uuid`;
    default: return sql`${value}`;
  }
}

/** Writes one table's rows as they are, the order written included. */
async function writeRows(database: Kysely<Database>, table: RunExportTableName, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = columnNamesOf(table);
  const overriding = TABLES_WITH_AN_ORDER_WRITTEN.includes(table) ? sql` overriding system value` : sql``;
  const rowsPerStatement = Math.max(1, Math.floor(LARGEST_VALUES_PER_STATEMENT / columns.length));
  for (let start = 0; start < rows.length; start += rowsPerStatement) {
    const values = rows.slice(start, start + rowsPerStatement).map((row) =>
      sql`(${sql.join(columns.map((column) => valueToWrite(columnOf(table, column)!, row[column])))})`);
    await sql`insert into ${sql.table(table)} (${sql.join(columns.map((column) => sql.ref(column)))})${overriding}
      values ${sql.join(values)}`.execute(database);
  }
}

/**
 * Moves a sequence on to the highest value written, where that is past where it stands, so the next
 * value it gives is higher than every restored one. A sequence never moves back.
 */
async function moveSequencePast(database: Kysely<Database>, sequence: RawBuilder<unknown>, highestWritten: bigint): Promise<void> {
  await sql`select setval(found.sequence, ${highestWritten.toString()}::bigint)
    from (select ${sequence}::regclass as sequence) found
    where ${highestWritten.toString()}::bigint > coalesce(
      pg_sequence_last_value(found.sequence),
      (select seqstart - 1 from pg_sequence where seqrelid = found.sequence))`.execute(database);
}

function highestOf(values: Iterable<unknown>): bigint | null {
  let highest: bigint | null = null;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const number = BigInt(value);
    if (highest === null || number > highest) highest = number;
  }
  return highest;
}

/** The run with this id and the run with this slug, locked, either or both absent. */
async function runsInTheWay(database: Kysely<Database>, runId: string, slug: string) {
  const found = await database.selectFrom('runs').select(['id', 'slug']).where((where) => where.or([where('id', '=', runId), where('slug', '=', slug)]))
    .forUpdate().execute();
  return { byId: found.find((run) => run.id === runId), bySlug: found.find((run) => run.slug === slug) };
}

/** Why the restore may not go ahead, or the run it removes to make room. */
async function decideWhatGoesAside(
  database: Kysely<Database>, document: RunExportDocument, replace: boolean,
): Promise<{ id: string; slug: string } | null> {
  const run = document.tables.runs[0]!;
  const { byId, bySlug } = await runsInTheWay(database, run.id, run.slug);
  if (byId === undefined && bySlug === undefined) return null;
  if (!replace) {
    const which = byId !== undefined && bySlug !== undefined && byId.id === bySlug.id
      ? `the run "${run.slug}" is already in the store`
      : byId !== undefined
        ? `the run this backup holds is already in the store under the name "${byId.slug}"`
        : `another run is already in the store under the name "${run.slug}"`;
    throw new Refusal(`This backup was not restored, and nothing was changed: ${which}. To put the backup in its place, restore it again choosing to replace the run already there, which removes that run and everything it holds.`);
  }
  if (byId !== undefined && bySlug !== undefined && byId.id !== bySlug.id) {
    throw new Refusal(`This backup was not restored, and nothing was changed: the run it holds is in the store under the name "${byId.slug}", and another run already has the name "${run.slug}". Replacing would remove two runs, so neither was touched. Rename or remove one of them first.`);
  }
  const removed = (byId ?? bySlug)!;
  if (removed.id !== run.id) {
    const continuing = await database.selectFrom('runs').select('slug').where('continues_run_id', '=', removed.id).where('id', '<>', removed.id).orderBy('slug').execute();
    if (continuing.length > 0) {
      throw new Refusal(`This backup was not restored, and nothing was changed: ${continuing.length === 1 ? 'a run continues' : `${continuing.length} runs continue`} from "${removed.slug}" (${continuing.map((each) => `"${each.slug}"`).join(', ')}), and the backup is a different run, so removing "${removed.slug}" would leave ${continuing.length === 1 ? 'that run' : 'them'} continuing from nothing.`);
    }
  }
  return removed;
}

/** Refuses a backup whose run continues from a run the store does not hold, or one this restore removes. */
async function checkTheRunItContinues(database: Kysely<Database>, document: RunExportDocument, removed: { id: string } | null): Promise<void> {
  const run = document.tables.runs[0]!;
  const continuesId = run.continues_run_id;
  if (continuesId === null || continuesId === run.id) return;
  const name = document.continuesRun?.id === continuesId ? `"${document.continuesRun.slug}"` : 'one the backup does not name';
  const earlier = await database.selectFrom('runs').select('id').where('id', '=', continuesId).executeTakeFirst();
  if (earlier === undefined || (removed !== null && removed.id === continuesId)) {
    throw new Refusal(`This backup was not restored, and nothing was changed: the run it holds continues from the run ${name}, which is not in the store. Restore that run first.`);
  }
}

/** Refuses a backup holding a row whose id another run's row already has. */
async function checkNoIdIsTaken(database: Kysely<Database>, document: RunExportDocument, removed: { id: string } | null): Promise<void> {
  for (const table of TABLES_WITH_THEIR_OWN_IDS) {
    const ids = (document.tables[table] as unknown as Row[]).map((row) => row['id'] as string);
    if (ids.length === 0) continue;
    const taken = await sql<{ count: number }>`select count(*)::int as count from ${sql.table(table)}
      where id = any(${ids}::uuid[]) ${removed === null ? sql`` : sql`and run_id <> ${removed.id}`}`.execute(database);
    const count = taken.rows[0]!.count;
    if (count > 0) {
      throw new Refusal(`This backup was not restored, and nothing was changed: ${count === 1 ? 'a row' : `${count} rows`} of ${table} in it ${count === 1 ? 'has an id' : 'have ids'} another run in the store already holds. The backup may be of a copy of a run that is already here under another name.`);
    }
  }
}

/** The SQLSTATE of a PostgreSQL error, or null where the error is not one. */
function sqlStateOf(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/** Whether an error is PostgreSQL refusing a row for a rule the store keeps (a key, a check, a unique index). */
function brokeARuleTheStoreKeeps(error: unknown): error is { code: string; table?: string; constraint?: string } {
  return sqlStateOf(error)?.startsWith('23') ?? false;
}

/**
 * Whether an error is PostgreSQL refusing a value it cannot keep (class 22: a number out of range, a
 * moment that is not one, a character it cannot store). The rows are checked before anything is
 * written, so this is the net under those checks.
 */
function heldAValueTheStoreCannotKeep(error: unknown): error is { code: string; table?: string; column?: string } {
  return sqlStateOf(error)?.startsWith('22') ?? false;
}

/** Writes the document's run back into the store, in one transaction. */
export async function restoreRunInto(
  database: Kysely<Database>, document: RunExportDocument, options: { replace: boolean },
): Promise<RestoredRunReport> {
  const versionNotRead = whyTheFormatVersionIsNotRead(document.formatVersion);
  if (versionNotRead !== null) throw new Refusal(versionNotRead);
  checkTheRows(document);
  const runId = document.tables.runs[0]!.id;
  try {
    return await database.transaction().execute(async (transaction) => {
      // Scenes and entries point at each other, and a run restored over itself is pointed at by the
      // runs continuing from it while it is removed and written again; every such check waits to the end.
      await sql`set constraints all deferred`.execute(transaction);
      const removed = await decideWhatGoesAside(transaction, document, options.replace);
      await checkTheRunItContinues(transaction, document, removed);
      await checkNoIdIsTaken(transaction, document, removed);
      let replaced: RestoredRunReport['replaced'] = null;
      if (removed !== null) {
        const earlier = await transaction.selectFrom('runs').selectAll().where('id', '=', removed.id).executeTakeFirstOrThrow();
        const rowsRemoved = await countRowsOfRun(transaction, removed.id);
        // Every table holding a run's rows cascades from the run, so this one delete takes them all.
        await transaction.deleteFrom('runs').where('id', '=', removed.id).execute();
        replaced = { run: runFromRow(earlier), rowsRemoved };
      }
      const rowsRestored = emptyCounts();
      for (const table of RUN_EXPORT_TABLE_NAMES) {
        const rows = document.tables[table] as unknown as Row[];
        await writeRows(transaction, table, rows);
        rowsRestored[table] = rows.length;
      }
      for (const table of TABLES_WITH_AN_ORDER_WRITTEN) {
        const highest = highestOf((document.tables[table] as unknown as Row[]).map((row) => row['written_order']));
        if (highest !== null) await moveSequencePast(transaction, sql`pg_get_serial_sequence(${table}, 'written_order')`, highest);
      }
      const marks = RUN_EXPORT_TABLE_NAMES.flatMap((table) => (document.tables[table] as unknown as Row[])
        .flatMap((row) => [row['write_mark'], row['imported_through']]));
      const highestMark = highestOf(marks);
      if (highestMark !== null) await moveSequencePast(transaction, sql`${WRITE_MARKS}`, highestMark);
      // Asked here rather than at the commit, so a key the document breaks is said like any other refusal.
      await sql`set constraints all immediate`.execute(transaction);
      const restored = await transaction.selectFrom('runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
      const run: RunRecord = runFromRow(restored);
      return { run, rowsRestored, replaced };
    });
  } catch (error) {
    if (brokeARuleTheStoreKeeps(error)) {
      const where = error.table === undefined ? 'its rows' : `its rows of ${error.table}`;
      throw new Refusal(`This backup was not restored, and nothing was changed: ${where} break a rule the store keeps${error.constraint === undefined ? '' : ` (${error.constraint})`}. The file may have been edited.`);
    }
    if (heldAValueTheStoreCannotKeep(error)) {
      // The database's own message is not repeated: it may quote the value, which may be canon.
      const where = error.table === undefined ? 'its rows hold' : `its rows of ${error.table} hold`;
      throw new Refusal(`This backup was not restored, and nothing was changed: ${where} a value the store cannot keep${error.column === undefined ? '' : ` in "${error.column}"`}. The file may have been edited.`);
    }
    throw error;
  }
}
