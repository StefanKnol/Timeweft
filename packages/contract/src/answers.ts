/**
 * What the operations answer with, and the interfaces between the parts of the app.
 *
 * The parts are built against these and nothing else: the store keeps records, the briefing is a
 * pure function over a snapshot, the importer is a pure reader of files, and the server joins
 * them. A part never reaches into another's insides.
 */
import type { InputOf } from './operations.ts';
import type {
  ClockRecord, CollisionRecord, EntryEditRecord, EntryKind, EntryNoteRecord, EntryRecord, FactRecord, Id,
  JourneyLegRecord, RulingRecord, RulingScope, RunEditRecord, RunRecord, RunSnapshot, RunStatus, SceneRecord,
  Source, ThreadRecord, Visibility, WaypointRecord, WaypointRewordingRecord,
} from './records.ts';

/** A refusal the caller can act on. Never thrown for a programming fault. */
export class Refusal extends Error {
  override name = 'Refusal';
}

export interface RunListing {
  run: RunRecord;
  standingScenes: number;
  /** The newest standing scene's number, title and when, or null where the run has none. */
  latest: { number: number; title: string; whenTyped: string } | null;
  openThreads: number;
  waitingCollisions: number;
}

/** One part of a briefing, and whether all of it fitted. */
export interface BriefingSection {
  name: string;
  bytes: number;
  /** How many items of this kind were served. */
  served: number;
  /** How many more exist and were left out. */
  leftOut: number;
  /** Which operation fetches what was left out, in words. Empty where nothing was. */
  fetchWith: string;
}

/** The present of a run, sized to fit a chat. */
export interface Briefing {
  /** The briefing itself, as Markdown a model reads. Never larger than the budget asked for. */
  text: string;
  bytes: number;
  budgetBytes: number;
  sections: BriefingSection[];
}

export interface SavedScene {
  scene: SceneRecord;
  entriesAdded: EntryRecord[];
  factsWritten: FactRecord[];
  /** Facts the save was given that already held exactly, so nothing was written. */
  factsUnchanged: number;
  rulingsRecorded: RulingRecord[];
  threadsOpened: ThreadRecord[];
  threadsClosed: ThreadRecord[];
  /** Open threads the scene moved on without opening or closing, as they stand after the save. */
  threadsTouched: ThreadRecord[];
  /** What was held back for the author. */
  collisions: CollisionRecord[];
  /** Anything the caller should know, in sentences: a name that already exists, a fact skipped. */
  cautions: string[];
}

export interface EntryLookup {
  entry: EntryRecord;
  /** Every fact that still holds, one per property unless several stand alongside. */
  holding: FactRecord[];
  /** Earlier facts, newest first. Empty unless history was asked for. */
  history: FactRecord[];
  /** The latest trail notes, newest first. */
  trail: Array<{ note: EntryNoteRecord; sceneNumber: number }>;
  trailLeftOut: number;
  threads: ThreadRecord[];
  rulings: RulingRecord[];
}

/**
 * What an author's write to an entry answers with: the entry as it now stands, and anything the
 * author should know, in sentences. A name that now answers to two entries is said here, since a
 * story naming it will be refused until one of them is renamed.
 */
export interface EntryWritten {
  entry: EntryRecord;
  cautions: string[];
}

export interface FoundItem {
  kind: 'entry' | 'fact' | 'note' | 'scene' | 'ruling' | 'thread';
  /** What to show: a line of text holding the match. */
  text: string;
  /** How to open it: an entry's name, or a scene's number. */
  entryName: string | null;
  sceneNumber: number | null;
}

/**
 * The store's doors. Every write is one transaction. Names are resolved inside the store, by
 * name and other names, case-blind, within the run; where two entries answer to one name the
 * door refuses and says so.
 *
 * `audience` on a read decides whether author-only material is in the answer. A `story` read
 * never returns it.
 */
export interface Store {
  migrate(): Promise<void>;
  close(): Promise<void>;

  listRuns(): Promise<RunListing[]>;
  beginRun(input: InputOf<'begin_run'>): Promise<RunSnapshot>;
  /** Everything the run holds, filtered for the audience. Refuses a slug the store lacks. */
  snapshotOf(runSlug: string, audience: 'story' | 'author'): Promise<RunSnapshot>;

  saveScene(input: InputOf<'save_scene'>): Promise<SavedScene>;
  redoScene(input: InputOf<'redo_scene'>): Promise<SavedScene>;
  recordRuling(input: InputOf<'record_ruling'>): Promise<RulingRecord>;
  /**
   * States a fact in the author's name. The entry is named by `entryId` or by `entry`, exactly one;
   * what it points at by `aboutEntryId` or by `about`, at most one; anything else is refused.
   */
  stateFact(input: InputOf<'state_fact'>): Promise<FactRecord>;
  settleCollision(input: InputOf<'settle_collision'>): Promise<CollisionRecord>;

  /*
   * The author's hand. Every door below is the author's alone and is dated by one rule, set down in
   * docs/decisions/0003-the-authors-hand.md: an act made outside a scene is dated to the newest
   * standing scene of its run when it is made, and no scene's save is recorded as having done it, so
   * a redo of that scene carries the act onto the new take and never takes it back. Where the run has
   * no standing scene, what starts is dated to no scene, and what has to stop at a scene is refused.
   * Nothing here deletes a row or writes over a value without keeping what it held, and a redo
   * leaves what the author did as the author left it: an entry's edited fields, a touch, a closing.
   */

  /** Closes an open fact as of the newest standing scene, with nothing in its place. */
  endFact(input: InputOf<'end_fact'>): Promise<FactRecord>;
  /** Withdraws a ruling as of the newest standing scene. The ruling is kept word for word. */
  withdrawRuling(input: InputOf<'withdraw_ruling'>): Promise<RulingRecord>;

  addWaypoint(input: InputOf<'add_waypoint'>): Promise<WaypointRecord>;
  /** Gives a waypoint new words under the same id, keeping the earlier words as a rewording. */
  rewordWaypoint(input: InputOf<'reword_waypoint'>): Promise<WaypointRecord>;
  /** Marks a waypoint reached at the standing scene the author names, which no redo takes back. */
  markWaypointReached(input: InputOf<'mark_waypoint_reached'>): Promise<WaypointRecord>;
  /** Withdraws a waypoint as of the newest standing scene. It is kept, and never served to a story. */
  withdrawWaypoint(input: InputOf<'withdraw_waypoint'>): Promise<WaypointRecord>;

  /** Changes what is given of a run's title, setting, register and status, keeping each earlier value. */
  editRun(input: InputOf<'edit_run'>): Promise<RunRecord>;

  /** Opens a thread as of the newest standing scene, or of no scene where the run has none. */
  openThread(input: InputOf<'open_thread'>): Promise<ThreadRecord>;
  /** Touches an open thread at the newest standing scene. */
  touchThread(input: InputOf<'touch_thread'>): Promise<ThreadRecord>;
  /** Closes an open thread as of the newest standing scene, with how it resolved. */
  closeThread(input: InputOf<'close_thread'>): Promise<ThreadRecord>;

  /** Adds an entry in the author's name, introduced by no scene. */
  addEntry(input: InputOf<'add_entry'>): Promise<EntryWritten>;
  /** Changes what is given of an entry's kind, other names and pronoun, keeping each earlier value. */
  editEntry(input: InputOf<'edit_entry'>): Promise<EntryWritten>;
  /** Renames an entry. The old name joins its other names, and both changes are kept. */
  renameEntry(input: InputOf<'rename_entry'>): Promise<EntryWritten>;
  /** Turns an entry open or author-only. Only the entry's row changes, and the change is kept. */
  setEntryVisibility(input: InputOf<'set_entry_visibility'>): Promise<EntryWritten>;

  /** Write a whole run read from files, in one transaction. Refuses a slug already there with `RunAlreadyExists`. */
  importRun(run: ImportedRun): Promise<RunSnapshot>;
  /**
   * Write a whole run read from files over the run an earlier import of the same slug made, in one
   * transaction: the earlier run is removed and the files are imported in its place, so a failed
   * import leaves the earlier run whole. Refused with `EarlierImportStandsInTheWay` where that run
   * holds anything written after its import, or where another run continues from it. Where no run
   * has the slug, the files are imported as `importRun` would and nothing is removed.
   */
  replaceImportedRun(run: ImportedRun): Promise<ReplacedImport>;
}

/** How much a run holds, kind by kind. */
export interface RunCounts {
  scenes: number;
  entries: number;
  facts: number;
  trailNotes: number;
  rulings: number;
  threads: number;
  waypoints: number;
  journeyLegs: number;
  clocks: number;
}

export interface ReplacedImport {
  snapshot: RunSnapshot;
  /** What the earlier import held and was removed, or null where no run had the slug. */
  removed: RunCounts | null;
}

/**
 * The refusal for an import whose slug a run already has. Its sentence quotes nothing but the slug
 * the author gave, so it may be said anywhere. It offers replacing the earlier run only where an
 * import the store can date made it, since no other run is ever replaced, and the page knows that
 * sentence by `isRunAlreadyExistsSentence` to offer the replacement.
 */
export class RunAlreadyExists extends Refusal {
  /** Whether an import the store can date made the run, so that replacing it may be offered. */
  readonly madeByAnImport: boolean;

  constructor(slug: string, madeByAnImport: boolean) {
    super(madeByAnImport ? runAlreadyExistsSentence(slug) : runAlreadyExistsUnreplaceablySentence(slug));
    this.madeByAnImport = madeByAnImport;
  }
}

const RUN_ALREADY_EXISTS_ENDING = '" already exists, so it was not imported again. Its earlier import can be replaced by these files, which removes that run and writes the files in its place.';

const RUN_ALREADY_EXISTS_UNREPLACEABLY_ENDING = '" already exists, so it was not imported again. No import the store can date made it (it was begun in a chat, or imported before the store kept which writes were an import\'s), so it is never replaced. Import the files under another slug.';

export function runAlreadyExistsSentence(slug: string): string {
  return `A run called "${slug}${RUN_ALREADY_EXISTS_ENDING}`;
}

/** The sentence for a slug taken by a run no import the store can date made, which offers no replacement. */
export function runAlreadyExistsUnreplaceablySentence(slug: string): string {
  return `A run called "${slug}${RUN_ALREADY_EXISTS_UNREPLACEABLY_ENDING}`;
}

/** True for the sentence `RunAlreadyExists` carries where replacing is offered, as it arrives over the web. */
export function isRunAlreadyExistsSentence(sentence: string): boolean {
  return sentence.startsWith('A run called "') && sentence.endsWith(RUN_ALREADY_EXISTS_ENDING);
}

/**
 * The refusal to replace an earlier import because the run holds more than its import: something
 * written after it, or a run that continues from it. It names kinds, counts and slugs and quotes
 * nothing a file said, so it may be said anywhere.
 */
export class EarlierImportStandsInTheWay extends Refusal {}

/**
 * A run as read out of the five files a story kept by hand. Everything refers to other things by
 * name or by scene number, since the files have no ids; the store resolves them on the way in.
 */
export interface ImportedRun {
  slug: string;
  title: string;
  setting: string;
  status: RunStatus;
  register: string;
  clocks: Array<{ name: string; countsFrom: string }>;
  scenes: ImportedScene[];
  entries: ImportedEntry[];
  rulings: ImportedRuling[];
  /**
   * `touchedInScenes` holds every scene the thread's text names after its opening, a range read
   * for its last scene, oldest first: the importer writes each as a touch. Left out, it has none.
   */
  threads: Array<{ text: string; about: string[]; openedInScene: number | null; closed: boolean; resolution: string; touchedInScenes?: number[] }>;
  waypoints: Array<{ text: string; reached: boolean }>;
  legs: Array<{ from: string; to: string; duration: string; note: string; scene: number | null }>;
  /** What the reader could not place, in sentences, so nothing is dropped in silence. */
  unplaced: string[];
}

export interface ImportedScene {
  number: number;
  title: string;
  starred: boolean;
  whenTyped: string;
  place: string | null;
  summary: string;
  record: string;
  steer: string;
  /** Empty for every scene but the last, whose situation is the run's present. */
  situationAfter: string;
  readings: Array<{ clock: string; count: string; partOfDay: string }>;
}

export interface ImportedEntry {
  name: string;
  kind: EntryKind;
  alsoKnownAs: string[];
  pronoun: string;
  introducedInScene: number | null;
  visibility: Visibility;
  /** Oldest first within one property; the last of each property is what holds now. */
  facts: Array<{ property: string; value: string; fromScene: number | null; source: Source; note: string }>;
  trail: Array<{ scene: number; text: string }>;
}

export interface ImportedRuling {
  text: string;
  source: Source;
  scope: RulingScope;
  topics: string[];
  about: string[];
  scene: number | null;
}

/** The five files, as text. A file the run did not keep is an empty string. */
export interface WeaverFiles {
  log: string;
  state: string;
  cast: string;
  items: string;
  places: string;
}

export type {
  ClockRecord, CollisionRecord, EntryEditRecord, EntryNoteRecord, EntryRecord, FactRecord, Id, JourneyLegRecord,
  RulingRecord, RunEditRecord, RunRecord, RunSnapshot, SceneRecord, ThreadRecord, WaypointRecord,
  WaypointRewordingRecord,
};
