/**
 * What the operations answer with, and the interfaces between the parts of the app.
 *
 * The parts are built against these and nothing else: the store keeps records, the briefing is a
 * pure function over a snapshot, the importer is a pure reader of files, and the server joins
 * them. A part never reaches into another's insides.
 */
import type { InputOf } from './operations.ts';
import type {
  ClockRecord, CollisionRecord, EntryKind, EntryNoteRecord, EntryRecord, FactRecord, Id,
  JourneyLegRecord, RulingRecord, RulingScope, RunRecord, RunSnapshot, RunStatus, SceneRecord,
  Source, ThreadRecord, Visibility, WaypointRecord,
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
  stateFact(input: InputOf<'state_fact'>): Promise<FactRecord>;
  settleCollision(input: InputOf<'settle_collision'>): Promise<CollisionRecord>;

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
  threads: Array<{ text: string; about: string[]; openedInScene: number | null; closed: boolean; resolution: string }>;
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
  ClockRecord, CollisionRecord, EntryNoteRecord, EntryRecord, FactRecord, Id, JourneyLegRecord,
  RulingRecord, RunRecord, RunSnapshot, SceneRecord, ThreadRecord, WaypointRecord,
};
