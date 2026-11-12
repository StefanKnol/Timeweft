/**
 * How an operation travels, and what each one answers with.
 *
 * Over the web every operation is `POST /api/operations/<name>` with its input as the JSON body.
 * The answer is always JSON: `{ ok: true, answer }`, or `{ ok: false, refusal }` with status 400
 * where the store refused, 404 for a name that is not an operation, and 500 for a fault. Over
 * MCP each operation is a tool of the same name taking the same input, answering with text made
 * for a model to read plus the same answer as structured content.
 */
import type { Briefing, EntryLookup, FoundItem, RunListing, SavedScene } from './answers.ts';
import type {
  CollisionRecord, EntryNoteRecord, EntryRecord, FactRecord, RulingRecord, RunSnapshot,
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
}

/** A scene as a listing shows it: everything but the long record. */
export type SceneSummary = Omit<SceneRecord, 'record'>;

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
}

export type WireAnswer<Answer> = { ok: true; answer: Answer } | { ok: false; refusal: string };
