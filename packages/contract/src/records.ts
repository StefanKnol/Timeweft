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
 * The parts of a run the author may change from their pages. Each is a value the run holds now;
 * what it held before is kept, one `RunEditRecord` per change.
 */
export const RUN_FIELDS_THE_AUTHOR_EDITS = ['title', 'setting', 'register', 'status'] as const;
export type RunFieldTheAuthorEdits = (typeof RUN_FIELDS_THE_AUTHOR_EDITS)[number];

/**
 * One change the author made to a run: which part, what it said before and what it says after.
 * The run's row holds the newest value, and these rows hold every earlier one, oldest first, so
 * nothing the run ever said is lost.
 *
 * `afterSceneId` dates the change as every author act made outside a scene is dated: the newest
 * standing scene when it was made, or null where the run had none yet. A redo of that scene moves
 * the date onto the new take and never undoes the change.
 */
export interface RunEditRecord {
  id: Id;
  runId: Id;
  field: RunFieldTheAuthorEdits;
  earlierValue: string;
  laterValue: string;
  afterSceneId: Id | null;
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

/**
 * A scene as the author's run page reads it: everything but its record (the prose), with the
 * record's length in words instead. A type of its own, so nothing reads an empty record as a scene
 * that has none. `read_scene_text` fetches the record of one take.
 */
export interface SceneOutline extends Omit<SceneRecord, 'record'> {
  /** How many words the record holds. 0 where it holds none. */
  recordWords: number;
}

/**
 * The parts of a saved scene the author may change from their pages. The scene keeps its id, since
 * a chat, a fact and a journey leg may hold it. What it established (facts, notes, rulings, threads,
 * legs) is never changed this way; those keep their own forms.
 */
export const SCENE_FIELDS_THE_AUTHOR_EDITS = ['title', 'summary', 'whenTyped', 'placeEntryId', 'record', 'steer', 'situationAfter', 'starred'] as const;
export type SceneFieldTheAuthorEdits = (typeof SCENE_FIELDS_THE_AUTHOR_EDITS)[number];

/**
 * One change the author made to a field of a saved scene. The scene's row holds the newest value,
 * and these rows hold every earlier one, oldest first. Both values are text: a place is its entry's
 * id, or the empty string for no place; a star is `true` or `false`.
 *
 * Dated as `RunEditRecord` is: `afterSceneId` is the newest standing scene when the change was made,
 * and a redo of that scene moves the date onto the new take. The edit itself stays with the take it
 * was made to, `sceneId`, even when that take is later struck. Never served to a story: a story
 * reads a scene's newest wording only.
 */
export interface SceneEditRecord {
  id: Id;
  runId: Id;
  sceneId: Id;
  field: SceneFieldTheAuthorEdits;
  earlierValue: string;
  laterValue: string;
  afterSceneId: Id | null;
  createdAt: string;
}

/**
 * A change to a saved scene as the author's run page reads it. A change to any field but the record
 * carries both values, as `SceneEditRecord` does. A change to the record (the prose) carries the
 * length of each side in words instead, for the reason `SceneOutline` leaves the record out: the
 * prose is most of a run, and both sides of every edit to it would travel on every load.
 */
export type SceneEditOutline =
  | (SceneEditRecord & { field: Exclude<SceneFieldTheAuthorEdits, 'record'> })
  | (Omit<SceneEditRecord, 'earlierValue' | 'laterValue'> & {
    field: 'record';
    /** How many words the record held before the change. */
    earlierWords: number;
    /** How many words it held after it. */
    laterWords: number;
  });

export const ENTRY_KINDS = ['person', 'group', 'place', 'item', 'other'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Who said a thing is so. The author's word outranks a story's invention. */
export const SOURCES = ['author', 'story', 'import'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Who a thing may be served to. `author-only` is never served to a chat writing a story, so it
 * can never shape a scene; the author's own pages show it.
 *
 * Author-only facts are a lane of their own. A story cannot see one, so a story's fact never
 * closes one, never collides with one and is never compared with one; and stating one never
 * closes an open fact, because the story would then see a value end with nothing in its place.
 * On one property an open fact and an author-only fact may both hold: the story reads the open
 * one, and the author's pages show both.
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
  /**
   * The author may turn an entry author-only, or open again, at any time. Author-only takes the
   * entry, every fact about it or pointing at it, its trail and every journey leg naming it out of
   * every story answer at once;
   * nothing is moved or closed to do it, so turning it open again puts all of it back.
   */
  visibility: Visibility;
  createdAt: string;
}

/**
 * The parts of an entry the author may change from their pages. A rename is a change to `name`
 * that also adds the old name to `alsoKnownAs`, so the entry stays findable by what it was called.
 */
export const ENTRY_FIELDS_THE_AUTHOR_EDITS = ['name', 'alsoKnownAs', 'pronoun', 'kind', 'visibility'] as const;
export type EntryFieldTheAuthorEdits = (typeof ENTRY_FIELDS_THE_AUTHOR_EDITS)[number];

/**
 * One change the author made to an entry. The entry's row holds the newest value, and these rows
 * hold every earlier one, oldest first. For `alsoKnownAs` both values are the whole list, written
 * as a JSON array of strings, so a name holding any character comes back as it was.
 *
 * Dated as `RunEditRecord` is. Never served to a story: a story reads an entry as it is now.
 */
export interface EntryEditRecord {
  id: Id;
  runId: Id;
  entryId: Id;
  field: EntryFieldTheAuthorEdits;
  earlierValue: string;
  laterValue: string;
  afterSceneId: Id | null;
  createdAt: string;
}

/**
 * One fact about an entry: a property and its value, holding from one scene until another.
 *
 * `untilSceneId` is null while the fact still holds. A fact that replaced another closed it;
 * nothing is ever written over. A fact the author ended with nothing in its place is closed the
 * same way, at the newest standing scene, and no fact follows it on that property.
 */
export interface FactRecord {
  id: Id;
  entryId: Id;
  /**
   * What is being said: `who`, `standing`, `state`, `voice`, `where`, `what`, or any other. Kept
   * trimmed and in lower case, so `Where` and `where` are one property.
   */
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
  /**
   * The scene at which it stopped applying, if it has. A withdrawn ruling is kept and stays readable
   * on the author's pages; only a story stops being told it. The author withdraws one as of the
   * newest standing scene.
   */
  withdrawnInSceneId: Id | null;
  createdAt: string;
}

/**
 * A scene that moved a thread on without opening or closing it, with what moved, where the scene
 * said. Kept as a row of its own, so a struck take's touch can stop counting while the row stays.
 */
export interface ThreadTouchRecord {
  sceneId: Id;
  /** What moved, in a sentence or less. Empty where the scene said nothing more than that it touched it. */
  note: string;
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
  /**
   * The scenes that touched it, standing ones only, oldest scene first. A struck take's touch is
   * never served. Derived by the store when it reads; nothing writes this list by hand.
   */
  touches: ThreadTouchRecord[];
  /**
   * The newest standing scene among the one that opened it, the ones that touched it and the one
   * that closed it: the scene it last moved in. Null where none of those is a standing scene.
   * Derived by the store when it reads, never written.
   */
  lastTouchedInSceneId: Id | null;
  createdAt: string;
}

/**
 * A scene the author wants the run to reach. A story is told to steer towards it and never to
 * narrate it.
 *
 * `text` is the newest wording; every earlier one is kept as a `WaypointRewordingRecord`. A
 * withdrawn waypoint is kept, readable on the author's pages, and never served to a story again.
 */
export interface WaypointRecord {
  id: Id;
  runId: Id;
  text: string;
  /** The scene that reached it, named by a scene's save or by the author. Null while ahead. */
  reachedInSceneId: Id | null;
  /** The newest standing scene when the author withdrew it. Null while it stands. */
  withdrawnInSceneId: Id | null;
  createdAt: string;
}

/**
 * One rewording of a waypoint: what it said before and what it says after. The waypoint keeps its
 * id, so a chat holding that id still names the same waypoint. Dated as `RunEditRecord` is.
 */
export interface WaypointRewordingRecord {
  id: Id;
  runId: Id;
  waypointId: Id;
  earlierText: string;
  laterText: string;
  afterSceneId: Id | null;
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

/**
 * Everything a run holds, as one value. What the briefing and the reader's pages are built from.
 *
 * Every list is in the order its records were written, unless it says otherwise. A reader may rely
 * on that: one save writes many records at one moment, so the moment cannot order them.
 */
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
  /** Withdrawn ones included for the author. A story is served only those not withdrawn. */
  waypoints: WaypointRecord[];
  legs: JourneyLegRecord[];
  collisions: CollisionRecord[];
  /** Every change the author made to the run, oldest first. Empty for a story. */
  runEdits: RunEditRecord[];
  /** Every change the author made to an entry, oldest first. Empty for a story. */
  entryEdits: EntryEditRecord[];
  /** Every rewording of a waypoint, oldest first. Empty for a story, which reads the newest wording. */
  waypointRewordings: WaypointRewordingRecord[];
  /** Every change the author made to a saved scene, oldest first. Empty for a story, which reads the newest wording. */
  sceneEdits: SceneEditRecord[];
}

/**
 * A whole run as the author's run page reads it: the snapshot with the scenes' prose left out, since
 * the prose is most of a run and is read one scene at a time. The prose is left out twice over: each
 * scene's record, and both sides of every change made to a record.
 */
export interface RunOutline extends Omit<RunSnapshot, 'scenes' | 'sceneEdits'> {
  /** Every scene, struck ones included, by number and then by time written, without its record. */
  scenes: SceneOutline[];
  /** Every change the author made to a saved scene, oldest first, a change to a record given in words counted. */
  sceneEdits: SceneEditOutline[];
}
