/**
 * The records of the story loop: what a run keeps so that any fresh chat can pick it up.
 *
 * One rule shapes every record here. **History is kept whole, and only the newest is served.**
 * A fact is never changed in place: a newer fact closes the older one by naming the scene it
 * stopped holding at. So "where is the jar now?" is one row, and "where has the jar been?" is
 * every row, and neither costs the other anything.
 *
 * The store holds facts where they are known. It does not hold a mystery, a maybe, or what
 * nobody will ever know; those are the telling's.
 */

/** A uuid, as text. Names are never keys: two things may share a name. */
export type Id = string;

/** Whether what a run establishes is canon for later runs, or stays inside the run. */
export const RUN_STATUSES = ['binding', 'telling'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * A run is one story, played across as many chats as it takes. It is not a chat: it has scenes,
 * it may continue an earlier run, and it is resumed at a scene.
 */
export interface RunRecord {
  id: Id;
  /** A short handle a chat can name the run by. Unique. */
  slug: string;
  title: string;
  /** Where and when it is set, in the author's words. The world store will replace this text. */
  setting: string;
  /** Binding by default: what it establishes is canon at once. A telling's facts stay in the run. */
  status: RunStatus;
  /** The run this one follows on from, if any. */
  continuesRunId: Id | null;
  /** How the run is narrated: voice, spelling, point of view. Read whole on every resume. */
  register: string;
  createdAt: string;
}

/**
 * A clock is one named count a run keeps: days since an event, days in one place. A run may keep
 * several side by side, since two places need not share a day. A count is exact; what the clock
 * counts from may be given its own date later, and every reading then resolves.
 */
export interface ClockRecord {
  id: Id;
  runId: Id;
  name: string;
  /** What it counts and from what, in words. */
  countsFrom: string;
}

/** One clock's reading at one scene. */
export interface ClockReading {
  clockId: Id;
  /** The count, as a decimal in text so that no precision is lost. */
  count: string;
  /** The part of the day, in the setting's own words. Empty where not said. */
  partOfDay: string;
}

export const SCENE_STATUSES = ['standing', 'struck'] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

/**
 * A scene is the unit a run is saved and resumed by. It has two sizes on purpose: the summary is
 * short and always served, and the record is as long as it needs to be and served on request.
 */
export interface SceneRecord {
  id: Id;
  runId: Id;
  /** Its place in the run. A redone scene keeps its number; the earlier take is struck. */
  number: number;
  title: string;
  /** A scene a later run could plausibly lean on. Starred scenes outrank others in a briefing. */
  starred: boolean;
  /** When it happens, as the setting says it. Kept as typed. */
  whenTyped: string;
  /** Where it happens, where that is an entry. */
  placeEntryId: Id | null;
  /** Two to four sentences. Always served. */
  summary: string;
  /** Everything worth keeping: who, what changed, anchors, lines as spoken. Served on request. */
  record: string;
  /** What the author directed at this scene, in their words. Empty where nothing was said. */
  steer: string;
  /** Where things stand once the scene is over. The newest standing scene's is the run's present. */
  situationAfter: string;
  status: SceneStatus;
  readings: ClockReading[];
  createdAt: string;
}

export const ENTRY_KINDS = ['person', 'group', 'place', 'item', 'other'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Who said a thing is so. The author's word outranks a story's invention. */
export const SOURCES = ['author', 'story', 'import'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Who a thing may be served to. `author-only` is never served to a chat writing a story, so it
 * can never shape a scene; the author's own pages show it.
 */
export const VISIBILITIES = ['open', 'author-only'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Anything a story names: a person, a people, a place, an object. */
export interface EntryRecord {
  id: Id;
  runId: Id;
  kind: EntryKind;
  name: string;
  /** Other names it goes by. A name is not a key, so these are for finding it. */
  alsoKnownAs: string[];
  /** For a person: how the narration refers to them. Empty where it does not apply. */
  pronoun: string;
  introducedInSceneId: Id | null;
  source: Source;
  visibility: Visibility;
  createdAt: string;
}

/**
 * One fact about an entry: a property and its value, holding from one scene until another.
 *
 * `untilSceneId` is null while the fact still holds. A fact that replaced another closed it;
 * nothing is ever written over.
 */
export interface FactRecord {
  id: Id;
  entryId: Id;
  /** What is being said: `who`, `standing`, `state`, `voice`, `where`, `what`, or any other. */
  property: string;
  value: string;
  /** Another entry the fact points at: who holds an item, where a person is. */
  aboutEntryId: Id | null;
  fromSceneId: Id | null;
  untilSceneId: Id | null;
  source: Source;
  visibility: Visibility;
  note: string;
  createdAt: string;
}

/** What happened to or with an entry in one scene: the trail, kept apart from its present. */
export interface EntryNoteRecord {
  id: Id;
  entryId: Id;
  sceneId: Id;
  text: string;
  visibility: Visibility;
  createdAt: string;
}

/** Whether a ruling binds this run only or says how the world is. */
export const RULING_SCOPES = ['run', 'world'] as const;
export type RulingScope = (typeof RULING_SCOPES)[number];

/**
 * A ruling is an instruction about how the run is played or what is so, kept word for word and
 * never trimmed. There are too many to read whole, so each says what it is about and is served
 * to the scenes it bears on.
 */
export interface RulingRecord {
  id: Id;
  runId: Id;
  /** Its number in the run, in the order given. */
  number: number;
  /** Verbatim. */
  text: string;
  source: Source;
  scope: RulingScope;
  /** Free words saying what it bears on: `narration`, `time`, `naming`, a practice, a theme. */
  topics: string[];
  /** The entries it is about. */
  aboutEntryIds: Id[];
  /** The scene it was given at, where known. */
  sceneId: Id | null;
  /** The scene at which it stopped applying, if it has. */
  withdrawnInSceneId: Id | null;
  createdAt: string;
}

/** Something left open: a question, a promise, a tension. */
export interface ThreadRecord {
  id: Id;
  runId: Id;
  text: string;
  aboutEntryIds: Id[];
  openedInSceneId: Id | null;
  closedInSceneId: Id | null;
  /** How it closed, in a sentence. Empty while open. */
  resolution: string;
  createdAt: string;
}

/** A scene the author wants the run to reach. Never shown in the narration. */
export interface WaypointRecord {
  id: Id;
  runId: Id;
  text: string;
  reachedInSceneId: Id | null;
  createdAt: string;
}

/** A journey between two places as first travelled: how long it took, by whom and how. */
export interface JourneyLegRecord {
  id: Id;
  runId: Id;
  fromPlace: string;
  toPlace: string;
  /** As stated, in the setting's words. */
  duration: string;
  note: string;
  sceneId: Id | null;
  createdAt: string;
}

/** What became of something a story proposed that collided with what the author had said. */
export const COLLISION_STATES = ['waiting', 'author-kept', 'story-taken'] as const;
export type CollisionState = (typeof COLLISION_STATES)[number];

/**
 * A story tried to replace a fact the author stated. The author's fact stands, the story's is
 * kept here, and the author decides. This is the only thing a save ever stops to ask about.
 */
export interface CollisionRecord {
  id: Id;
  runId: Id;
  sceneId: Id | null;
  entryId: Id;
  property: string;
  /** The author's fact that stands. */
  standingFactId: Id;
  /** What the story said instead. */
  proposedValue: string;
  proposedAboutEntryId: Id | null;
  state: CollisionState;
  createdAt: string;
}

/** Everything a run holds, as one value. What the briefing and the reader's pages are built from. */
export interface RunSnapshot {
  run: RunRecord;
  clocks: ClockRecord[];
  /** Every scene, struck ones included, by number and then by time written. */
  scenes: SceneRecord[];
  entries: EntryRecord[];
  /** Every fact, closed ones included. */
  facts: FactRecord[];
  notes: EntryNoteRecord[];
  rulings: RulingRecord[];
  threads: ThreadRecord[];
  waypoints: WaypointRecord[];
  legs: JourneyLegRecord[];
  collisions: CollisionRecord[];
}
