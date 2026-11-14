/**
 * Carrying a run out of the store whole: every row of every table a run's rows live in, exactly as
 * the store keeps it, read inside one repeatable-read transaction so the document is of one moment.
 *
 * A moment is read as text in UTC with all six digits of the microseconds, and a big whole number as
 * text of decimal digits, so nothing passes through a JavaScript date or number and loses anything.
 * See docs/decisions/0004-export-and-restore.md.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';
import {
  RUN_EXPORT_FORMAT_NAME, RUN_EXPORT_FORMAT_VERSION, RUN_EXPORT_TABLE_NAMES, Refusal,
  type RunExportDocument, type RunExportTableName, type RunExportTables,
} from '@timeweft/contract';
import type { Database } from './database.ts';
import { HOW_A_RUNS_ROWS_ARE_FOUND, columnNamesOf, columnOf } from './run-tables.ts';

/** A moment as exact text in UTC: `2026-11-13T09:30:00.123456Z`. */
export function exactTimestampOf(expression: RawBuilder<unknown>): RawBuilder<string> {
  return sql<string>`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** How one column is selected, so its value arrives as the document writes it. */
function selectedColumn(table: RunExportTableName, column: string): RawBuilder<unknown> {
  const reference = sql.ref(`${table}.${column}`);
  const description = columnOf(table, column)!;
  if (description.kind === 'exact timestamp') return sql`${exactTimestampOf(sql`${reference}`)} as ${sql.ref(column)}`;
  if (description.kind === 'big whole number') return sql`${reference}::text as ${sql.ref(column)}`;
  return sql`${reference} as ${sql.ref(column)}`;
}

/** Every row of one table that belongs to the run, in the table's fixed order. */
export async function readRowsOfRun(database: Kysely<Database>, table: RunExportTableName, runId: string): Promise<Array<Record<string, unknown>>> {
  const found = HOW_A_RUNS_ROWS_ARE_FOUND[table];
  const columns = sql.join(columnNamesOf(table).map((column) => selectedColumn(table, column)));
  const query = sql<Record<string, unknown>>`select ${columns} from ${sql.raw(found.from)}
    where ${sql.raw(found.runIdIn)} = ${runId} order by ${sql.raw(found.orderBy)}`;
  const result = await query.execute(database);
  return result.rows;
}

/** Reads the whole run named by its slug into one document. Refuses a slug the store lacks. */
export async function exportRunFrom(database: Kysely<Database>, runSlug: string): Promise<RunExportDocument> {
  return database.transaction().setIsolationLevel('repeatable read').execute(async (transaction) => {
    const run = await transaction.selectFrom('runs').select(['id', 'continues_run_id']).where('slug', '=', runSlug).executeTakeFirst();
    if (run === undefined) throw new Refusal(`There is no run called "${runSlug}".`);
    const tables: Partial<Record<RunExportTableName, Array<Record<string, unknown>>>> = {};
    for (const table of RUN_EXPORT_TABLE_NAMES) tables[table] = await readRowsOfRun(transaction, table, run.id);
    let continuesRun: RunExportDocument['continuesRun'] = null;
    if (run.continues_run_id !== null) {
      const earlier = await transaction.selectFrom('runs').select(['id', 'slug']).where('id', '=', run.continues_run_id).executeTakeFirstOrThrow();
      continuesRun = { id: earlier.id, slug: earlier.slug };
    }
    const exportedAt = await sql<{ now: string }>`select ${exactTimestampOf(sql`clock_timestamp()`)} as now`.execute(transaction);
    // Kept in the order of the contract's RUN_EXPORT_TABLE_NAMES, so two exports of one run are written alike.
    const ordered = Object.fromEntries(RUN_EXPORT_TABLE_NAMES.map((table) => [table, tables[table]]));
    return {
      formatName: RUN_EXPORT_FORMAT_NAME,
      formatVersion: RUN_EXPORT_FORMAT_VERSION,
      exportedAt: exportedAt.rows[0]!.now,
      runSlug,
      continuesRun,
      tables: ordered as unknown as RunExportTables,
    };
  });
}
