/**
 * How an operation travels, and what each one answers with.
 *
 * Over the web every operation is `POST /api/operations/<name>` with its input as the JSON body.
 * The answer is always JSON: `{ ok: true, answer }`, or `{ ok: false, refusal }` with status 400
 * where the store refused, 401 without the access token (sent as `Authorization: Bearer`), 404 for
 * a name that is not an operation, 405 for anything but POST, 413 for a body too large, 415 for a
 * body that is not JSON, and 500 for a fault. A body may be 5 MB, and 24 MB for `import_run`,
 * which carries whole files. Over
 * MCP each operation is a tool of the same name taking the same input, answering with text made
 * for a model to read, plus `{ answer }` as structured content. `resume_run` is the exception: its
 * text is the briefing and its structured content carries only the sizes, so the whole result
 * stays inside the budget asked for.
 *
 * Over MCP, a parameter sent as null is read as left out, at the top of a tool's input and inside
 * each item of a list: a client may offer null beside every optional parameter, and no parameter
 * here gives null a meaning. Over the web a null is refused, as any wrong value is.
 */
import type { Briefing, EntryLookup, FoundItem, RunListing, SavedScene } from './answers.ts';
import type {
  CollisionRecord, EntryNoteRecord, EntryRecord, FactRecord, JourneyLegRecord, RulingRecord, RunRecord, RunSnapshot,
  SceneRecord, ThreadRecord,
} from './records.ts';

export const OPERATION_ROUTE_PREFIX = '/api/operations/';

export interface SceneInFull {
  scene: SceneRecord;
  entriesIntroduced: EntryRecord[];
  factsEstablished: FactRecord[];
  notes: EntryNoteRecord[];
  rulings: RulingRecord[];
  threadsOpened: ThreadRecord[];
  threadsClosed: ThreadRecord[];
  /** The journeys first travelled in this scene. */
  legs: JourneyLegRecord[];
}

/** A scene as a listing shows it: everything but the long record. */
export type SceneSummary = Omit<SceneRecord, 'record'>;

/** What an import read and wrote, in counts, and what it could not place, in sentences. */
export interface ImportedRunReport {
  run: RunRecord;
  counts: {
    scenes: number;
    entries: number;
    facts: number;
    trailNotes: number;
    rulings: number;
    threads: number;
    waypoints: number;
    journeyLegs: number;
    clocks: number;
  };
  /** Every line the reader could not place, naming the file and the line. Nothing is dropped in silence. */
  unplaced: string[];
}

export interface AnswerByOperation {
  list_runs: RunListing[];
  begin_run: RunSnapshot;
  resume_run: Briefing;
  save_scene: SavedScene;
  redo_scene: SavedScene;
  read_scene: SceneInFull;
  list_scenes: SceneSummary[];
  look_up: EntryLookup;
  find: FoundItem[];
  list_rulings: RulingRecord[];
  list_threads: ThreadRecord[];
  record_ruling: RulingRecord;
  state_fact: FactRecord;
  list_collisions: CollisionRecord[];
  settle_collision: CollisionRecord;
  read_run: RunSnapshot;
  import_run: ImportedRunReport;
}

export type WireAnswer<Answer> = { ok: true; answer: Answer } | { ok: false; refusal: string };
