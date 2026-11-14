/**
 * Every table a run's rows live in, column by column, as an export writes them and a restore reads
 * them back. One description serves both doors, and `export-and-restore.test.ts` holds it to the
 * database's own catalogue: the same tables, the same columns, the same types and the same columns
 * allowed to be empty. A migration that changes a run table fails that test until this description,
 * the contract's row types and the format version change with it.
 */
import type { RunExportTableName, RunExportTables } from '@timeweft/contract';

/** How a column's value is written in a document. */
export type ColumnKind = 'id' | 'text' | 'text list' | 'whole number' | 'true or false' | 'big whole number' | 'exact timestamp';

export interface ColumnDescription {
  kind: ColumnKind;
  /** True where the column may hold nothing. */
  mayBeEmpty: boolean;
  /**
   * The run table an id column points at, where it points into the run. A restore refuses a
   * document whose id points at a row the document does not hold, so nothing it writes can point
   * into another run.
   */
  pointsInto?: RunExportTableName;
}

/** The PostgreSQL type each kind is kept as, as the catalogue names it. */
export const CATALOGUE_TYPE_OF_KIND: Record<ColumnKind, string> = {
  'id': 'uuid',
  'text': 'text',
  'text list': 'ARRAY',
  'whole number': 'integer',
  'true or false': 'boolean',
  'big whole number': 'bigint',
  'exact timestamp': 'timestamp with time zone',
};

type ColumnsOf<Table extends RunExportTableName> = { [Column in keyof RunExportTables[Table][number]]: ColumnDescription };

const id: ColumnDescription = { kind: 'id', mayBeEmpty: false };
const text: ColumnDescription = { kind: 'text', mayBeEmpty: false };
const textList: ColumnDescription = { kind: 'text list', mayBeEmpty: false };
const wholeNumber: ColumnDescription = { kind: 'whole number', mayBeEmpty: false };
const trueOrFalse: ColumnDescription = { kind: 'true or false', mayBeEmpty: false };
const writtenAt: ColumnDescription = { kind: 'exact timestamp', mayBeEmpty: false };
const bigWholeNumber: ColumnDescription = { kind: 'big whole number', mayBeEmpty: false };

function pointsInto(table: RunExportTableName, mayBeEmpty = false): ColumnDescription {
  return { kind: 'id', mayBeEmpty, pointsInto: table };
}

const theRun = pointsInto('runs');
const sceneOrNone = pointsInto('scenes', true);
const entryOrNone = pointsInto('entries', true);

/**
 * Every column of every run table. The tables are in the order of the contract's
 * `RUN_EXPORT_TABLE_NAMES`, which `export-and-restore.test.ts` holds; the order of the columns is
 * the order an export writes them in.
 */
export const RUN_TABLE_COLUMNS: { [Table in RunExportTableName]: ColumnsOf<Table> } = {
  runs: {
    id, slug: text, title: text, setting: text, status: text,
    continues_run_id: { kind: 'id', mayBeEmpty: true }, register: text, created_at: writtenAt,
    imported_through: { kind: 'big whole number', mayBeEmpty: true },
  },
  clocks: { id, run_id: theRun, name: text, counts_from: text, position: wholeNumber, created_at: writtenAt, write_mark: bigWholeNumber },
  scenes: {
    id, run_id: theRun, number: wholeNumber, title: text, starred: trueOrFalse, when_typed: text,
    place_entry_id: entryOrNone, summary: text, record: text, steer: text, situation_after: text, status: text,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  entries: {
    id, run_id: theRun, kind: text, name: text, also_known_as: textList, pronoun: text,
    introduced_in_scene_id: sceneOrNone, source: text, visibility: text,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  scene_readings: { scene_id: pointsInto('scenes'), clock_id: pointsInto('clocks'), count: text, part_of_day: text, position: wholeNumber },
  facts: {
    id, run_id: theRun, entry_id: pointsInto('entries'), property: text, value: text, about_entry_id: entryOrNone,
    from_scene_id: sceneOrNone, until_scene_id: sceneOrNone, source: text, visibility: text, note: text,
    established_by_scene_id: sceneOrNone, closed_by_scene_id: sceneOrNone,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  entry_notes: {
    id, run_id: theRun, entry_id: pointsInto('entries'), scene_id: pointsInto('scenes'), text, visibility: text,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  rulings: {
    id, run_id: theRun, number: wholeNumber, text, source: text, scope: text, topics: textList,
    scene_id: sceneOrNone, withdrawn_in_scene_id: sceneOrNone, established_by_scene_id: sceneOrNone,
    created_at: writtenAt, write_mark: bigWholeNumber,
  },
  ruling_about_entries: { ruling_id: pointsInto('rulings'), entry_id: pointsInto('entries'), position: wholeNumber },
  threads: {
    id, run_id: theRun, text, opened_in_scene_id: sceneOrNone, closed_in_scene_id: sceneOrNone, resolution: text,
    established_by_scene_id: sceneOrNone, closed_by_scene_id: sceneOrNone,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  thread_about_entries: { thread_id: pointsInto('threads'), entry_id: pointsInto('entries'), position: wholeNumber },
  thread_touches: {
    thread_id: pointsInto('threads'), scene_id: pointsInto('scenes'), note: text, written_by_scene_id: sceneOrNone,
    by_author: trueOrFalse, created_at: writtenAt, written_order: bigWholeNumber,
  },
  waypoints: {
    id, run_id: theRun, text, reached_in_scene_id: sceneOrNone, reached_by_scene_id: sceneOrNone,
    withdrawn_in_scene_id: sceneOrNone, created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  waypoint_rewordings: {
    id, run_id: theRun, waypoint_id: pointsInto('waypoints'), earlier_text: text, later_text: text, after_scene_id: sceneOrNone,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  run_edits: {
    id, run_id: theRun, field: text, earlier_value: text, later_value: text, after_scene_id: sceneOrNone,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  entry_edits: {
    id, run_id: theRun, entry_id: pointsInto('entries'), field: text, earlier_value: text, later_value: text,
    after_scene_id: sceneOrNone, created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  scene_edits: {
    id, run_id: theRun, scene_id: pointsInto('scenes'), field: text, earlier_value: text, later_value: text,
    after_scene_id: sceneOrNone, created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  journey_legs: {
    id, run_id: theRun, from_place: text, to_place: text, duration: text, note: text, scene_id: sceneOrNone,
    created_at: writtenAt, written_order: bigWholeNumber, write_mark: bigWholeNumber,
  },
  collisions: {
    id, run_id: theRun, scene_id: sceneOrNone, entry_id: pointsInto('entries'), property: text,
    standing_fact_id: pointsInto('facts'), proposed_value: text, proposed_about_entry_id: entryOrNone, state: text,
    created_at: writtenAt, written_order: bigWholeNumber,
  },
};

/** The columns of one table, in the order an export writes them. */
export function columnNamesOf(table: RunExportTableName): string[] {
  return Object.keys(RUN_TABLE_COLUMNS[table]);
}

/** The description of one column of one table, or undefined where the table has no such column. */
export function columnOf(table: RunExportTableName, column: string): ColumnDescription | undefined {
  return (RUN_TABLE_COLUMNS[table] as Record<string, ColumnDescription>)[column];
}

/**
 * How each table's rows are found for one run, and in what order an export lists them: `runIdIn`
 * is the column that holds the run's id. A table with no run_id of its own is reached through the
 * table that owns its rows, and listed in its owner's order and then by position.
 */
export const HOW_A_RUNS_ROWS_ARE_FOUND: Record<RunExportTableName, { from: string; runIdIn: string; orderBy: string }> = {
  runs: { from: 'runs', runIdIn: 'runs.id', orderBy: 'runs.id' },
  clocks: { from: 'clocks', runIdIn: 'clocks.run_id', orderBy: 'clocks.position, clocks.id' },
  scenes: { from: 'scenes', runIdIn: 'scenes.run_id', orderBy: 'scenes.written_order' },
  scene_readings: {
    from: 'scene_readings join scenes owner on owner.id = scene_readings.scene_id',
    runIdIn: 'owner.run_id', orderBy: 'owner.written_order, scene_readings.position, scene_readings.clock_id',
  },
  entries: { from: 'entries', runIdIn: 'entries.run_id', orderBy: 'entries.written_order' },
  facts: { from: 'facts', runIdIn: 'facts.run_id', orderBy: 'facts.written_order' },
  entry_notes: { from: 'entry_notes', runIdIn: 'entry_notes.run_id', orderBy: 'entry_notes.written_order' },
  rulings: { from: 'rulings', runIdIn: 'rulings.run_id', orderBy: 'rulings.number' },
  ruling_about_entries: {
    from: 'ruling_about_entries join rulings owner on owner.id = ruling_about_entries.ruling_id',
    runIdIn: 'owner.run_id', orderBy: 'owner.number, ruling_about_entries.position, ruling_about_entries.entry_id',
  },
  threads: { from: 'threads', runIdIn: 'threads.run_id', orderBy: 'threads.written_order' },
  thread_about_entries: {
    from: 'thread_about_entries join threads owner on owner.id = thread_about_entries.thread_id',
    runIdIn: 'owner.run_id', orderBy: 'owner.written_order, thread_about_entries.position, thread_about_entries.entry_id',
  },
  thread_touches: {
    from: 'thread_touches join threads owner on owner.id = thread_touches.thread_id',
    runIdIn: 'owner.run_id', orderBy: 'thread_touches.written_order',
  },
  waypoints: { from: 'waypoints', runIdIn: 'waypoints.run_id', orderBy: 'waypoints.written_order' },
  waypoint_rewordings: { from: 'waypoint_rewordings', runIdIn: 'waypoint_rewordings.run_id', orderBy: 'waypoint_rewordings.written_order' },
  run_edits: { from: 'run_edits', runIdIn: 'run_edits.run_id', orderBy: 'run_edits.written_order' },
  entry_edits: { from: 'entry_edits', runIdIn: 'entry_edits.run_id', orderBy: 'entry_edits.written_order' },
  scene_edits: { from: 'scene_edits', runIdIn: 'scene_edits.run_id', orderBy: 'scene_edits.written_order' },
  journey_legs: { from: 'journey_legs', runIdIn: 'journey_legs.run_id', orderBy: 'journey_legs.written_order' },
  collisions: { from: 'collisions', runIdIn: 'collisions.run_id', orderBy: 'collisions.written_order' },
};
