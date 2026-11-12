/**
 * The shape of the tables as Kysely sees them, and the one place a connection is opened.
 *
 * Ids are made in JavaScript with crypto.randomUUID before a row is written, so a save or an
 * import can build rows that point at each other without a round trip per row. The tables still
 * default their ids to gen_random_uuid() for anybody writing to them by hand.
 *
 * Several columns exist only for the store's own use and never reach a record:
 * `established_by_scene_id` says which scene's save wrote a row, and `closed_by_scene_id` which
 * scene's save closed it. They are what lets a redo take back exactly what one take did and
 * nothing the author did around it.
 */
import pg from 'pg';
import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type WrittenOrder = ColumnType<string, never, never>;

export interface RunsTable {
  id: string;
  slug: string;
  title: string;
  setting: string;
  status: string;
  continues_run_id: string | null;
  register: string;
  created_at: CreatedAt;
}

export interface ClocksTable {
  id: string;
  run_id: string;
  name: string;
  counts_from: string;
  position: number;
  created_at: CreatedAt;
}

export interface ScenesTable {
  id: string;
  run_id: string;
  number: number;
  title: string;
  starred: boolean;
  when_typed: string;
  place_entry_id: string | null;
  summary: string;
  record: string;
  steer: string;
  situation_after: string;
  status: string;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface SceneReadingsTable {
  scene_id: string;
  clock_id: string;
  count: string;
  part_of_day: string;
  position: number;
}

export interface EntriesTable {
  id: string;
  run_id: string;
  kind: string;
  name: string;
  also_known_as: string[];
  pronoun: string;
  introduced_in_scene_id: string | null;
  source: string;
  visibility: string;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface FactsTable {
  id: string;
  run_id: string;
  entry_id: string;
  property: string;
  value: string;
  about_entry_id: string | null;
  from_scene_id: string | null;
  until_scene_id: string | null;
  source: string;
  visibility: string;
  note: string;
  established_by_scene_id: string | null;
  closed_by_scene_id: string | null;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface EntryNotesTable {
  id: string;
  run_id: string;
  entry_id: string;
  scene_id: string;
  text: string;
  visibility: string;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface RulingsTable {
  id: string;
  run_id: string;
  number: number;
  text: string;
  source: string;
  scope: string;
  topics: string[];
  scene_id: string | null;
  withdrawn_in_scene_id: string | null;
  established_by_scene_id: string | null;
  created_at: CreatedAt;
}

export interface RulingAboutEntriesTable {
  ruling_id: string;
  entry_id: string;
  position: number;
}

export interface ThreadsTable {
  id: string;
  run_id: string;
  text: string;
  opened_in_scene_id: string | null;
  closed_in_scene_id: string | null;
  resolution: string;
  established_by_scene_id: string | null;
  closed_by_scene_id: string | null;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface ThreadAboutEntriesTable {
  thread_id: string;
  entry_id: string;
  position: number;
}

export interface WaypointsTable {
  id: string;
  run_id: string;
  text: string;
  reached_in_scene_id: string | null;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface JourneyLegsTable {
  id: string;
  run_id: string;
  from_place: string;
  to_place: string;
  duration: string;
  note: string;
  scene_id: string | null;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface CollisionsTable {
  id: string;
  run_id: string;
  scene_id: string | null;
  entry_id: string;
  property: string;
  standing_fact_id: string;
  proposed_value: string;
  proposed_about_entry_id: string | null;
  state: string;
  created_at: CreatedAt;
  written_order: WrittenOrder;
}

export interface MigrationsTable {
  number: number;
  name: string;
  applied_at: Generated<Date>;
}

export interface Database {
  runs: RunsTable;
  clocks: ClocksTable;
  scenes: ScenesTable;
  scene_readings: SceneReadingsTable;
  entries: EntriesTable;
  facts: FactsTable;
  entry_notes: EntryNotesTable;
  rulings: RulingsTable;
  ruling_about_entries: RulingAboutEntriesTable;
  threads: ThreadsTable;
  thread_about_entries: ThreadAboutEntriesTable;
  waypoints: WaypointsTable;
  journey_legs: JourneyLegsTable;
  collisions: CollisionsTable;
  timeweft_migrations: MigrationsTable;
}

/**
 * Opens a pool. Where a schema is named, every connection the pool makes searches it first, so
 * the same code serves a test's private schema and the installation's public one.
 */
export function connectToDatabase(databaseUrl: string, schema: string | undefined): Kysely<Database> {
  const poolSettings: pg.PoolConfig = { connectionString: databaseUrl, max: 10 };
  if (schema !== undefined) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
      throw new Error(`A schema name must be lower-case letters, digits and underscores; "${schema}" is not.`);
    }
    poolSettings.options = `-c search_path=${schema}`;
  }
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool(poolSettings) }) });
}
