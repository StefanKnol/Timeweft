/**
 * A run carried out of the store whole, and put back exactly as it was.
 *
 * The document holds one list per table a run's rows live in, and every row as the store keeps it:
 * every column, under the column's own name, including the columns that never reach a record
 * (`established_by_scene_id`, `closed_by_scene_id`, `reached_by_scene_id`, `written_by_scene_id`,
 * `by_author`, `write_mark`, `written_order`, the run's `imported_through`). Nothing is read through
 * a record and nothing is re-interpreted, so a run restored from it behaves exactly as the run it
 * was taken from: a redo takes back what it took back before, and replacing an earlier import is
 * refused or allowed as it was. See docs/decisions/0004-export-and-restore.md.
 *
 * How a value is written:
 * - uuid and text: a string. A text array: an array of strings.
 * - integer: a number. boolean: true or false.
 * - bigint (`written_order`, `write_mark`, `imported_through`): a string of decimal digits, so no
 *   precision is lost.
 * - timestamptz: a string in UTC with all six digits of the microseconds PostgreSQL keeps, as
 *   `2026-11-13T09:30:00.123456Z`. A JavaScript date keeps only milliseconds, so the store reads
 *   and writes these as text, never through a Date.
 * - json or jsonb: the JSON value itself. No run table has such a column yet.
 * - null: null.
 */
import { Refusal } from './answers.ts';
import type { Id, RunRecord } from './records.ts';

/** The name every export document carries, so a file of another kind is refused by name. */
export const RUN_EXPORT_FORMAT_NAME = 'timeweft-run-export';

/**
 * The version this store writes. Raised whenever a run table gains, loses or changes a column.
 *
 * - 1: the first.
 * - 2: adds `scene_edits`, the author's changes to a saved scene. A version 1 document holds no such
 *   list, and is read as holding none.
 */
export const RUN_EXPORT_FORMAT_VERSION = 2;

/** Every version this store can restore. A version not here is refused with a sentence naming these. */
export const RUN_EXPORT_FORMAT_VERSIONS_READ: readonly number[] = [1, 2];

/** The tables a version 1 document does not carry, since they came after it. Each is read as empty. */
export const TABLES_ADDED_AFTER_VERSION_1 = ['scene_edits'] as const;

/** How a backup file's name ends. */
export const RUN_EXPORT_FILE_ENDING = '.timeweft-run.json';

/**
 * The shape every run's slug has: lower-case letters and digits in groups joined by one hyphen, as
 * `the-ford`. `begin_run`, `import_run` and a restore all hold a slug to it, and a backup file is
 * named by the slug, so a slug can never step out of the backups folder or hold two hyphens
 * together, which is what parts a backup's name from the moment it was taken.
 */
export const RUN_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether text is a slug a run may have. */
export function isRunSlug(text: unknown): text is string {
  return typeof text === 'string' && RUN_SLUG_PATTERN.test(text);
}

/** A moment as PostgreSQL keeps it, in UTC with microseconds: `2026-11-13T09:30:00.123456Z`. */
export type ExactTimestamp = string;

/** A bigint, as a string of decimal digits. */
export type BigIntegerText = string;

export interface RunsRow {
  id: Id;
  slug: string;
  title: string;
  setting: string;
  status: string;
  continues_run_id: Id | null;
  register: string;
  created_at: ExactTimestamp;
  imported_through: BigIntegerText | null;
}

export interface ClocksRow {
  id: Id;
  run_id: Id;
  name: string;
  counts_from: string;
  position: number;
  created_at: ExactTimestamp;
  write_mark: BigIntegerText;
}

export interface ScenesRow {
  id: Id;
  run_id: Id;
  number: number;
  title: string;
  starred: boolean;
  when_typed: string;
  place_entry_id: Id | null;
  summary: string;
  record: string;
  steer: string;
  situation_after: string;
  status: string;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface SceneReadingsRow {
  scene_id: Id;
  clock_id: Id;
  count: string;
  part_of_day: string;
  position: number;
}

export interface EntriesRow {
  id: Id;
  run_id: Id;
  kind: string;
  name: string;
  also_known_as: string[];
  pronoun: string;
  introduced_in_scene_id: Id | null;
  source: string;
  visibility: string;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface FactsRow {
  id: Id;
  run_id: Id;
  entry_id: Id;
  property: string;
  value: string;
  about_entry_id: Id | null;
  from_scene_id: Id | null;
  until_scene_id: Id | null;
  source: string;
  visibility: string;
  note: string;
  established_by_scene_id: Id | null;
  closed_by_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface EntryNotesRow {
  id: Id;
  run_id: Id;
  entry_id: Id;
  scene_id: Id;
  text: string;
  visibility: string;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface RulingsRow {
  id: Id;
  run_id: Id;
  number: number;
  text: string;
  source: string;
  scope: string;
  topics: string[];
  scene_id: Id | null;
  withdrawn_in_scene_id: Id | null;
  established_by_scene_id: Id | null;
  created_at: ExactTimestamp;
  write_mark: BigIntegerText;
}

export interface RulingAboutEntriesRow {
  ruling_id: Id;
  entry_id: Id;
  position: number;
}

export interface ThreadsRow {
  id: Id;
  run_id: Id;
  text: string;
  opened_in_scene_id: Id | null;
  closed_in_scene_id: Id | null;
  resolution: string;
  established_by_scene_id: Id | null;
  closed_by_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface ThreadAboutEntriesRow {
  thread_id: Id;
  entry_id: Id;
  position: number;
}

export interface ThreadTouchesRow {
  thread_id: Id;
  scene_id: Id;
  note: string;
  written_by_scene_id: Id | null;
  by_author: boolean;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
}

export interface WaypointsRow {
  id: Id;
  run_id: Id;
  text: string;
  reached_in_scene_id: Id | null;
  reached_by_scene_id: Id | null;
  withdrawn_in_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface WaypointRewordingsRow {
  id: Id;
  run_id: Id;
  waypoint_id: Id;
  earlier_text: string;
  later_text: string;
  after_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface RunEditsRow {
  id: Id;
  run_id: Id;
  field: string;
  earlier_value: string;
  later_value: string;
  after_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface EntryEditsRow {
  id: Id;
  run_id: Id;
  entry_id: Id;
  field: string;
  earlier_value: string;
  later_value: string;
  after_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface SceneEditsRow {
  id: Id;
  run_id: Id;
  scene_id: Id;
  field: string;
  earlier_value: string;
  later_value: string;
  after_scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface JourneyLegsRow {
  id: Id;
  run_id: Id;
  from_place: string;
  to_place: string;
  duration: string;
  note: string;
  scene_id: Id | null;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
  write_mark: BigIntegerText;
}

export interface CollisionsRow {
  id: Id;
  run_id: Id;
  scene_id: Id | null;
  entry_id: Id;
  property: string;
  standing_fact_id: Id;
  proposed_value: string;
  proposed_about_entry_id: Id | null;
  state: string;
  created_at: ExactTimestamp;
  written_order: BigIntegerText;
}

/**
 * One list per table, keyed by the table's own name, holding every row of the run.
 *
 * Each list is in a fixed order, so two exports of one unchanged run are equal: by `written_order`
 * where the table has one; `rulings` by number; `clocks` by position; `scene_readings`,
 * `ruling_about_entries` and `thread_about_entries` by their owner's order and then by position.
 * `runs` holds exactly one row.
 */
export interface RunExportTables {
  runs: RunsRow[];
  clocks: ClocksRow[];
  scenes: ScenesRow[];
  entries: EntriesRow[];
  scene_readings: SceneReadingsRow[];
  facts: FactsRow[];
  entry_notes: EntryNotesRow[];
  rulings: RulingsRow[];
  ruling_about_entries: RulingAboutEntriesRow[];
  threads: ThreadsRow[];
  thread_about_entries: ThreadAboutEntriesRow[];
  thread_touches: ThreadTouchesRow[];
  waypoints: WaypointsRow[];
  waypoint_rewordings: WaypointRewordingsRow[];
  run_edits: RunEditsRow[];
  entry_edits: EntryEditsRow[];
  scene_edits: SceneEditsRow[];
  journey_legs: JourneyLegsRow[];
  collisions: CollisionsRow[];
}

export type RunExportTableName = keyof RunExportTables;

/**
 * Every table a document carries, in the order a restore writes them: a table after every table it
 * points at. Scenes and entries point at each other through two deferred keys, so either order holds.
 */
export const RUN_EXPORT_TABLE_NAMES = [
  'runs', 'clocks', 'scenes', 'entries', 'scene_readings', 'facts', 'entry_notes', 'rulings',
  'ruling_about_entries', 'threads', 'thread_about_entries', 'thread_touches', 'waypoints',
  'waypoint_rewordings', 'run_edits', 'entry_edits', 'scene_edits', 'journey_legs', 'collisions',
] as const satisfies readonly RunExportTableName[];

/**
 * Each table of a backup in plain words, in the order a restore writes them. The commands, the
 * server's own words and the page all read this one list, so a count is named the same everywhere.
 */
export const RUN_EXPORT_TABLE_IN_WORDS: Record<RunExportTableName, string> = {
  runs: 'The run itself',
  clocks: 'Clocks',
  scenes: 'Scenes, struck takes included',
  entries: 'People, places and things',
  scene_readings: 'Clock readings of scenes',
  facts: 'Facts, with their history',
  entry_notes: 'Trail notes',
  rulings: 'Rulings',
  ruling_about_entries: 'What rulings name',
  threads: 'Threads',
  thread_about_entries: 'What threads are about',
  thread_touches: 'Touches on threads',
  waypoints: 'Waypoints',
  waypoint_rewordings: 'Rewordings of waypoints',
  run_edits: 'Changes made to the run',
  entry_edits: 'Changes made to entries',
  scene_edits: 'Changes made to saved scenes',
  journey_legs: 'Legs of journeys',
  collisions: 'Collisions',
};

/** How many rows of each table, as a restore and a replace answer with. */
export type RunExportRowCounts = Record<RunExportTableName, number>;

/** One run, whole, as the store keeps it. What export_run answers with and a backup file holds. */
export interface RunExportDocument {
  formatName: typeof RUN_EXPORT_FORMAT_NAME;
  formatVersion: number;
  /** When it was taken, as an exact timestamp. Two exports of one run differ here and nowhere else. */
  exportedAt: ExactTimestamp;
  /** The run's slug when it was taken, so a file can be told apart without reading its tables. */
  runSlug: string;
  /**
   * The run this one continues from, by id and by the slug it had when this was taken, or null. A
   * restore needs that run in the store first, and names it by this slug where it is missing.
   */
  continuesRun: { id: Id; slug: string } | null;
  tables: RunExportTables;
}

/** What restore_run answers with. */
export interface RestoredRunReport {
  /** The run as it now stands, read back after the restore. */
  run: RunRecord;
  /** How many rows were written into each table. */
  rowsRestored: RunExportRowCounts;
  /** The run that was removed to make room, with how many rows it held, or null where none was. */
  replaced: { run: RunRecord; rowsRemoved: RunExportRowCounts } | null;
}

/**
 * Why a document's format version cannot be read, or null where this store reads it. A version
 * that is missing, or written as anything but a number, is said in its own words, so the sentence
 * never names a version the store does read as one it does not.
 */
export function whyTheFormatVersionIsNotRead(version: unknown): string | null {
  const read = `this server reads ${versionsReadInWords()} only`;
  if (version === undefined || version === null) {
    return `This backup does not say which format version it is written in, and ${read}. The file may have been cut short or edited.`;
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return `This backup gives its format version as ${JSON.stringify(version).slice(0, 20)}, which is not a whole number, and ${read}. The file may have been edited.`;
  }
  if (RUN_EXPORT_FORMAT_VERSIONS_READ.includes(version)) return null;
  return `This backup is written in format version ${version}, and ${read}. Restore it with a server that reads that version, or take the backup again from where the run now lives.`;
}

/** The versions this store reads, as a sentence says them: "version 1", "versions 1 and 2". */
function versionsReadInWords(): string {
  const versions = RUN_EXPORT_FORMAT_VERSIONS_READ.map(String);
  if (versions.length === 1) return `version ${versions[0]}`;
  return `versions ${versions.slice(0, -1).join(', ')} and ${versions[versions.length - 1]}`;
}

/**
 * The text a backup file holds: the document as JSON with two spaces of indentation and a closing
 * line break. The server's backups, the commands and the page's download all write this one text,
 * so the same backup taken any of those ways is the same file, byte for byte.
 */
export function runExportDocumentAsText(document: RunExportDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * The tables of a version 1 backup, with an empty list for each table added after it. A version 1
 * backup was taken before those tables existed and holds none of their rows; one that holds rows of
 * such a table was not written by a server and is refused.
 */
export function tablesOfAVersion1Document<Tables extends Record<string, unknown>>(tables: Tables): Tables {
  for (const table of TABLES_ADDED_AFTER_VERSION_1) {
    const list = tables[table];
    if (list !== undefined && !(Array.isArray(list) && list.length === 0)) {
      throw new Refusal(`This backup says it is written in format version 1, which has no list for ${table}, and it holds one with rows in it, so it was not restored. The file may have been edited.`);
    }
  }
  return { ...tables, ...Object.fromEntries(TABLES_ADDED_AFTER_VERSION_1.map((table) => [table, []])) };
}

/**
 * Checks the outside of a document before the store reads its rows: the format's name, a version
 * this store reads, a slug, and one list for every table. The rows themselves, column by column, are
 * the store's to check, since the store knows its own tables. Refuses with a sentence a person reads.
 */
export function readRunExportDocument(value: unknown): RunExportDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Refusal('This is not a Timeweft backup of a run: it holds no document at all.');
  }
  const document = value as Record<string, unknown>;
  if (document['formatName'] !== RUN_EXPORT_FORMAT_NAME) {
    throw new Refusal(`This is not a Timeweft backup of a run: a backup says "${RUN_EXPORT_FORMAT_NAME}" as its format, and this does not.`);
  }
  const versionNotRead = whyTheFormatVersionIsNotRead(document['formatVersion']);
  if (versionNotRead !== null) throw new Refusal(versionNotRead);
  if (typeof document['runSlug'] !== 'string' || document['runSlug'] === '') {
    throw new Refusal('This backup does not say which run it holds, so it was not restored. The file may have been cut short or edited.');
  }
  if (!isRunSlug(document['runSlug'])) {
    throw new Refusal('This backup names its run by a slug no run may have (a slug is lower-case letters and digits joined by single hyphens), so it was not restored. The file may have been edited.');
  }
  const tablesAsWritten = document['tables'];
  if (typeof tablesAsWritten !== 'object' || tablesAsWritten === null || Array.isArray(tablesAsWritten)) {
    throw new Refusal('This backup holds no tables, so it was not restored. The file may have been cut short or edited.');
  }
  const tables = document['formatVersion'] === 1
    ? tablesOfAVersion1Document(tablesAsWritten as Record<string, unknown>)
    : tablesAsWritten as Record<string, unknown>;
  const missing = RUN_EXPORT_TABLE_NAMES.filter((name) => !Array.isArray(tables[name]));
  if (missing.length > 0) {
    throw new Refusal(`This backup is missing ${missing.length === 1 ? 'the list' : 'the lists'} for ${missing.join(', ')}, so it was not restored. The file may have been cut short or edited.`);
  }
  const runs = (tables as Record<string, unknown[]>)['runs'] ?? [];
  if (runs.length !== 1) {
    throw new Refusal(`A backup holds exactly one run, and this one holds ${runs.length}. It was not restored.`);
  }
  const run = runs[0];
  if (typeof run === 'object' && run !== null && (run as Record<string, unknown>)['slug'] !== document['runSlug']) {
    throw new Refusal('This backup names its run by one slug on the outside and holds a run with another, so it was not restored. The file may have been edited.');
  }
  return (tables === tablesAsWritten ? value : { ...document, tables }) as RunExportDocument;
}

/**
 * The name a backup file is given: the slug, then the time in UTC to the second, then the ending,
 * as `the-ford--20261113T093000Z.timeweft-run.json`. Sorting the names of one run's files sorts
 * them oldest first.
 */
export function backupFileName(runSlug: string, takenAt: Date): string {
  // A file named by anything else could land outside the folder it was meant for.
  if (!RUN_SLUG_PATTERN.test(runSlug)) throw new Refusal(`A backup file cannot be named by "${runSlug.slice(0, 60)}", which is not a slug a run may have.`);
  const stamp = takenAt.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return `${runSlug}--${stamp}${RUN_EXPORT_FILE_ENDING}`;
}
