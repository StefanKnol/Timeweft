/**
 * Every bit of data shaping the pages need, as small pure functions.
 *
 * The pages only draw what these hand them. Keeping the shaping here, away from React and the
 * browser, is what lets `node --test` hold it: a rule about which fact holds or which take is
 * struck is tested once, not looked at in a screenshot.
 */
import { ENTRY_KINDS, OPERATION_ROUTE_PREFIX, OPERATIONS, isRunAlreadyExistsSentence } from '@timeweft/contract';
import type {
  ClockReading, ClockRecord, CollisionRecord, EntryKind, EntryNoteRecord, EntryRecord, FactRecord,
  EntryEditRecord, Id, ImportedRunReport, JourneyLegRecord, RequestOf, RulingRecord, RulingScope, RunEditRecord, RunSnapshot, RunStatus, SceneRecord, ThreadRecord, Visibility, WaypointRecord, WireAnswer,
} from '@timeweft/contract';

// ---------------------------------------------------------------------------------------------
// Scenes

/** One scene number, with the take that stands and every take struck at that number. */
export interface SceneSlot {
  number: number;
  /** Null where every take at this number was struck. */
  standing: SceneRecord | null;
  /** Oldest first, so the order reads as the order they were written. */
  struck: SceneRecord[];
}

/** Scenes by number, with struck takes kept under their number rather than mixed into the list. */
export function scenesByNumber(scenes: SceneRecord[]): SceneSlot[] {
  const slotsByNumber = new Map<number, SceneSlot>();
  const oldestFirst = [...scenes].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  for (const scene of oldestFirst) {
    let slot = slotsByNumber.get(scene.number);
    if (slot === undefined) {
      slot = { number: scene.number, standing: null, struck: [] };
      slotsByNumber.set(scene.number, slot);
    }
    if (scene.status === 'struck') slot.struck.push(scene);
    // If a store ever handed back two standing takes, the newest is the one that stands.
    else slot.standing = scene;
  }
  return [...slotsByNumber.values()].sort((first, second) => first.number - second.number);
}

// ---------------------------------------------------------------------------------------------
// Drawing a long list a step at a time

/**
 * Scenes drawn at once before "Show older" is needed. A long run holds hundreds, and drawing every
 * one put hundreds of thousands of characters on one page; fifty is what a reader scrolls back
 * through before they would rather search.
 */
export const SCENES_SHOWN_AT_A_TIME = 50;

/** Rulings drawn at once. A ruling is shorter than a scene card, so a step holds more of them. */
export const RULINGS_SHOWN_AT_A_TIME = 100;

/** The newest of a list, and what is left older than them. */
export interface NewestShown<Item> {
  /** The newest items, kept in the list's own order, oldest of them first. */
  shown: Item[];
  /** How many older items are not drawn. */
  olderNotShown: number;
  /** How many one press of "Show older" would add: a step, or what is left where less is. */
  showOlderWouldAdd: number;
}

/**
 * The newest `shownCount` items of a list in oldest-first order. The list is everything that
 * matches (a filter searches all of it first), so only the drawing is cut, never the search.
 */
export function newestShown<Item>(oldestFirst: readonly Item[], shownCount: number, step: number): NewestShown<Item> {
  const countShown = Math.max(0, Math.min(oldestFirst.length, Math.floor(shownCount)));
  const olderNotShown = oldestFirst.length - countShown;
  return {
    shown: oldestFirst.slice(olderNotShown),
    olderNotShown,
    showOlderWouldAdd: Math.min(olderNotShown, step),
  };
}

/** How many are drawn after "Show older": one step more, never more than there are. */
export function shownAfterShowingOlder(shownCount: number, step: number, totalCount: number): number {
  return Math.min(totalCount, shownCount + step);
}

/** The rulings a filter finds, and the newest of them to draw. */
export interface RulingsToDraw extends NewestShown<RulingRecord> {
  /** Every ruling the filter matches, drawn or not. */
  matchingCount: number;
}

/**
 * The filter runs over every ruling first, and only then is the drawing cut to the newest, so a
 * ruling older than the drawn step is still found by searching for it.
 */
export function rulingsToDraw(rulings: RulingRecord[], filterText: string, shownCount: number): RulingsToDraw {
  const matching = rulingsMatching(rulings, filterText);
  return { matchingCount: matching.length, ...newestShown(matching, shownCount, RULINGS_SHOWN_AT_A_TIME) };
}

/** Scene ids to their numbers, so a fact can say which scene it held from. */
export function sceneNumbersById(scenes: SceneRecord[]): Map<Id, number> {
  return new Map(scenes.map((scene) => [scene.id, scene.number]));
}

/** What one scene established, read out of the whole run. */
export interface SceneEstablished {
  entriesIntroduced: EntryRecord[];
  factsEstablished: FactRecord[];
  notes: EntryNoteRecord[];
  rulings: RulingRecord[];
  threadsOpened: ThreadRecord[];
  threadsClosed: ThreadRecord[];
  /**
   * The threads this scene moved on without closing, with what moved where it said: the same
   * threads read_scene lists as touched. A struck take is not in a thread's touches, so it has none.
   */
  threadsTouched: Array<{ thread: ThreadRecord; note: string }>;
  /** The journeys first travelled in this scene. */
  legs: JourneyLegRecord[];
}

export function whatASceneEstablished(sceneId: Id, snapshot: RunSnapshot): SceneEstablished {
  return {
    entriesIntroduced: snapshot.entries.filter((entry) => entry.introducedInSceneId === sceneId),
    factsEstablished: snapshot.facts.filter((fact) => fact.fromSceneId === sceneId),
    notes: snapshot.notes.filter((note) => note.sceneId === sceneId),
    rulings: snapshot.rulings.filter((ruling) => ruling.sceneId === sceneId),
    threadsOpened: snapshot.threads.filter((thread) => thread.openedInSceneId === sceneId),
    threadsClosed: snapshot.threads.filter((thread) => thread.closedInSceneId === sceneId),
    threadsTouched: snapshot.threads.flatMap((thread) => {
      const touch = thread.touches.find((each) => each.sceneId === sceneId);
      return touch === undefined || thread.closedInSceneId === sceneId ? [] : [{ thread, note: touch.note }];
    }),
    legs: snapshot.legs.filter((leg) => leg.sceneId === sceneId),
  };
}

/** A clock reading with the clock's name, where the run still keeps that clock. */
export function readingsWithClockNames(readings: ClockReading[], clocks: ClockRecord[]): Array<{ clockName: string; count: string; partOfDay: string }> {
  const clockNamesById = new Map(clocks.map((clock) => [clock.id, clock.name]));
  return readings.map((reading) => ({
    clockName: clockNamesById.get(reading.clockId) ?? 'a clock the run no longer names',
    count: reading.count,
    partOfDay: reading.partOfDay,
  }));
}

// ---------------------------------------------------------------------------------------------
// Entries and their facts

/** Entries in the contract's order of kinds, each kind's entries by name. Empty kinds left out. */
export function entriesGroupedByKind(entries: EntryRecord[]): Array<{ kind: EntryKind; entries: EntryRecord[] }> {
  return ENTRY_KINDS
    .map((kind) => ({
      kind,
      entries: entries
        .filter((entry) => entry.kind === kind)
        .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })),
    }))
    .filter((group) => group.entries.length > 0);
}

/** A fact as the page draws it: its value, what it points at, and the scenes it held between. */
export interface FactAsDrawn {
  fact: FactRecord;
  aboutName: string | null;
  fromSceneNumber: number | null;
  untilSceneNumber: number | null;
}

/** One property of an entry: what holds now, and what held before, oldest to newest. */
export interface PropertyOfEntry {
  property: string;
  holding: FactAsDrawn[];
  history: FactAsDrawn[];
}

/**
 * An entry's facts grouped by property. A fact holds while it has no `untilSceneId`; every other
 * fact is history. The order of properties is the order they were first said in.
 */
export function factsOfEntryByProperty(entryId: Id, snapshot: RunSnapshot): PropertyOfEntry[] {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const entryNamesById = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  const drawn = (fact: FactRecord): FactAsDrawn => ({
    fact,
    aboutName: fact.aboutEntryId === null ? null : entryNamesById.get(fact.aboutEntryId) ?? null,
    fromSceneNumber: fact.fromSceneId === null ? null : sceneNumbers.get(fact.fromSceneId) ?? null,
    untilSceneNumber: fact.untilSceneId === null ? null : sceneNumbers.get(fact.untilSceneId) ?? null,
  });
  const factsOfEntry = snapshot.facts
    .filter((fact) => fact.entryId === entryId)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  const propertiesInOrder: PropertyOfEntry[] = [];
  const propertiesByName = new Map<string, PropertyOfEntry>();
  for (const fact of factsOfEntry) {
    let property = propertiesByName.get(fact.property);
    if (property === undefined) {
      property = { property: fact.property, holding: [], history: [] };
      propertiesByName.set(fact.property, property);
      propertiesInOrder.push(property);
    }
    if (fact.untilSceneId === null) property.holding.push(drawn(fact));
    else property.history.push(drawn(fact));
  }
  for (const property of propertiesInOrder) property.history.sort(oldestHeldFirst);
  return propertiesInOrder;
}

/** By the scene a fact began holding, a fact held from before any scene first, then by when written. */
function oldestHeldFirst(first: FactAsDrawn, second: FactAsDrawn): number {
  const firstFrom = first.fromSceneNumber ?? 0;
  const secondFrom = second.fromSceneNumber ?? 0;
  if (firstFrom !== secondFrom) return firstFrom - secondFrom;
  return first.fact.createdAt.localeCompare(second.fact.createdAt);
}

/** The words for the span a fact held over, by scene number. */
export function heldSpanInWords(fromSceneNumber: number | null, untilSceneNumber: number | null): string {
  const from = fromSceneNumber === null ? 'from before the scenes' : `from scene ${fromSceneNumber}`;
  if (untilSceneNumber === null) return `${from}, still holding`;
  return `${from} until scene ${untilSceneNumber}`;
}

/** What happened to or with an entry, scene by scene, oldest first. */
export function trailOfEntry(entryId: Id, snapshot: RunSnapshot): Array<{ note: EntryNoteRecord; sceneNumber: number | null }> {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return snapshot.notes
    .filter((note) => note.entryId === entryId)
    .map((note) => ({ note, sceneNumber: sceneNumbers.get(note.sceneId) ?? null }))
    .sort((first, second) => {
      const byScene = (first.sceneNumber ?? 0) - (second.sceneNumber ?? 0);
      return byScene !== 0 ? byScene : first.note.createdAt.localeCompare(second.note.createdAt);
    });
}

/** Whether a thing must be marked as never served to a story. */
export function isAuthorOnly(visibility: Visibility): boolean {
  return visibility === 'author-only';
}

// ---------------------------------------------------------------------------------------------
// Rulings and threads

/**
 * Rulings by number, narrowed to those whose words, topics, scope or source hold every word of
 * the filter, case-blind. An empty filter keeps them all.
 */
export function rulingsMatching(rulings: RulingRecord[], filterText: string): RulingRecord[] {
  const wordsSought = filterText.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return rulings
    .filter((ruling) => {
      const searchable = [ruling.text, ruling.scope, ruling.source, String(ruling.number), ...ruling.topics].join(' ').toLowerCase();
      return wordsSought.every((word) => searchable.includes(word));
    })
    .sort((first, second) => first.number - second.number);
}

/** A waypoint moved to another list by the author: marked reached at a scene, or withdrawn. */
export type WaypointMove = { kind: 'reached'; text: string; sceneNumber: number } | { kind: 'withdrawn'; text: string };

/** What the page says after a waypoint moved, naming it and the list it went to. */
export function waypointMoveInWords(move: WaypointMove): string {
  if (move.kind === 'reached') return `\u201c${move.text}\u201d is marked reached at scene ${move.sceneNumber}. It is kept under Waypoints reached below.`;
  return `\u201c${move.text}\u201d is withdrawn. It is kept among the waypoints withdrawn below, with what it said.`;
}

/** A thread with the scene numbers it opened at, was last touched at and closed at. */
export interface ThreadAsDrawn {
  thread: ThreadRecord;
  openedInSceneNumber: number | null;
  /** The scene that last opened, touched or closed it, as the store derived it. */
  lastTouchedInSceneNumber: number | null;
  /** What moved in that scene, where its touch said. */
  lastTouchNote: string;
  /**
   * The newest touch the thread holds, with what it said, or null where it was never touched.
   * Read off the touches themselves, so a touch at the scene the thread opened in is still drawn.
   */
  lastTouch: { sceneNumber: number | null; note: string } | null;
  closedInSceneNumber: number | null;
}

/** The newest touch of a thread in words, for its card: '' where it was never touched. */
export function threadLastTouchInWords(item: ThreadAsDrawn): string {
  if (item.lastTouch === null) return '';
  const where = item.lastTouch.sceneNumber === null ? 'Last touched' : `Last touched at scene ${item.lastTouch.sceneNumber}`;
  return item.lastTouch.note === '' ? `${where}.` : `${where}: ${item.lastTouch.note}`;
}

/**
 * Open threads first. Each half in the order a briefing ranks threads: the one a scene moved last
 * first, by the scene it was last touched in, then the scene it opened in, the newest first, then
 * the latest written. An unknown scene ranks after every known one at its step.
 */
function newestTouchOf(thread: ThreadRecord, numberOf: (sceneId: string | null) => number | null): ThreadAsDrawn['lastTouch'] {
  let newest: ThreadAsDrawn['lastTouch'] = null;
  for (const touch of thread.touches) {
    const sceneNumber = numberOf(touch.sceneId);
    // The later touch wins a tie, since touches are kept in the order they were made.
    if (newest === null || (sceneNumber ?? -1) >= (newest.sceneNumber ?? -1)) newest = { sceneNumber, note: touch.note };
  }
  return newest;
}

export function threadsOpenFirst(threads: ThreadRecord[], scenes: SceneRecord[]): { open: ThreadAsDrawn[]; closed: ThreadAsDrawn[] } {
  const sceneNumbers = sceneNumbersById(scenes);
  const numberOf = (sceneId: string | null): number | null => (sceneId === null ? null : sceneNumbers.get(sceneId) ?? null);
  const newestFirst = (first: number | null, second: number | null): number => {
    if (first === null && second !== null) return 1;
    if (first !== null && second === null) return -1;
    return (second ?? 0) - (first ?? 0);
  };
  const drawn = threads
    .map((thread, writtenPosition) => ({
      writtenPosition,
      item: {
        thread,
        openedInSceneNumber: numberOf(thread.openedInSceneId),
        lastTouchedInSceneNumber: numberOf(thread.lastTouchedInSceneId),
        lastTouchNote: thread.touches.find((touch) => touch.sceneId === thread.lastTouchedInSceneId)?.note ?? '',
        lastTouch: newestTouchOf(thread, numberOf),
        closedInSceneNumber: numberOf(thread.closedInSceneId),
      },
    }))
    .sort((first, second) =>
      newestFirst(first.item.lastTouchedInSceneNumber, second.item.lastTouchedInSceneNumber)
      || newestFirst(first.item.openedInSceneNumber, second.item.openedInSceneNumber)
      || second.writtenPosition - first.writtenPosition)
    .map((each) => each.item);
  // A thread is closed by the scene that closed it; a resolution alone does not close it.
  return {
    open: drawn.filter((item) => item.thread.closedInSceneId === null),
    closed: drawn.filter((item) => item.thread.closedInSceneId !== null),
  };
}

// ---------------------------------------------------------------------------------------------
// Waypoints and journeys

/** A waypoint with the number of the scene that reached it, where a standing scene did. */
export interface WaypointAsDrawn {
  waypoint: WaypointRecord;
  reachedInSceneNumber: number | null;
  /** The scene it was withdrawn at; null while it stands. */
  withdrawnInSceneNumber: number | null;
  /** What it said before its present words, oldest first. */
  earlierWordings: EarlierWording[];
}

/**
 * Waypoints still ahead first, in the order the author set them, then the reached in scene order,
 * then the withdrawn in the order they were set. A waypoint is reached only by a standing scene:
 * one a struck take reached is still ahead, since the story never reached it in any take that is
 * served. A withdrawn waypoint is withdrawn whether or not it was reached, since a story is no
 * longer told of it either way.
 */
export function waypointsAheadFirst(snapshot: RunSnapshot): { ahead: WaypointAsDrawn[]; reached: WaypointAsDrawn[]; withdrawn: WaypointAsDrawn[] } {
  const standingNumbers = new Map(snapshot.scenes.filter((scene) => scene.status === 'standing').map((scene) => [scene.id, scene.number]));
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const drawn = [...snapshot.waypoints]
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((waypoint) => ({
      waypoint,
      reachedInSceneNumber: waypoint.reachedInSceneId === null ? null : standingNumbers.get(waypoint.reachedInSceneId) ?? null,
      withdrawnInSceneNumber: waypoint.withdrawnInSceneId === null ? null : sceneNumbers.get(waypoint.withdrawnInSceneId) ?? null,
      earlierWordings: earlierWordingsOfWaypoint(waypoint.id, snapshot),
    }));
  const standing = drawn.filter((item) => item.waypoint.withdrawnInSceneId === null);
  return {
    ahead: standing.filter((item) => item.reachedInSceneNumber === null),
    reached: standing
      .filter((item) => item.reachedInSceneNumber !== null)
      .sort((first, second) => (first.reachedInSceneNumber ?? 0) - (second.reachedInSceneNumber ?? 0)),
    withdrawn: drawn.filter((item) => item.waypoint.withdrawnInSceneId !== null),
  };
}

/** One earlier wording of a waypoint, with the scene the change was made after. */
export interface EarlierWording {
  text: string;
  /** The newest standing scene when the words were changed; null where the run had none yet. */
  changedAfterSceneNumber: number | null;
}

/**
 * Every wording a waypoint had before its present one, oldest first. Each rewording keeps the
 * words it replaced, so the list is those, in the order they were replaced.
 */
export function earlierWordingsOfWaypoint(waypointId: Id, snapshot: RunSnapshot): EarlierWording[] {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return snapshot.waypointRewordings
    .filter((rewording) => rewording.waypointId === waypointId)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((rewording) => ({
      text: rewording.earlierText,
      changedAfterSceneNumber: rewording.afterSceneId === null ? null : sceneNumbers.get(rewording.afterSceneId) ?? null,
    }));
}

/** A journey with the number of the scene it was first travelled in, where one is known. */
export interface JourneyAsDrawn {
  leg: JourneyLegRecord;
  sceneNumber: number | null;
}

/**
 * Journeys in the order they were travelled: those from before the scenes first, then by scene
 * number and the order written. A journey from a struck take is kept apart, as a struck take is.
 */
export function journeysInSceneOrder(snapshot: RunSnapshot): { travelled: JourneyAsDrawn[]; inStruckTakes: JourneyAsDrawn[] } {
  const scenesById = new Map(snapshot.scenes.map((scene) => [scene.id, scene]));
  const drawn = snapshot.legs
    .map((leg) => {
      const scene = leg.sceneId === null ? undefined : scenesById.get(leg.sceneId);
      return { leg, sceneNumber: scene?.number ?? null, struck: scene?.status === 'struck' };
    })
    .sort((first, second) => {
      const byScene = (first.sceneNumber ?? 0) - (second.sceneNumber ?? 0);
      return byScene !== 0 ? byScene : first.leg.createdAt.localeCompare(second.leg.createdAt);
    });
  const asDrawn = ({ leg, sceneNumber }: { leg: JourneyLegRecord; sceneNumber: number | null }) => ({ leg, sceneNumber });
  return {
    travelled: drawn.filter((item) => !item.struck).map(asDrawn),
    inStruckTakes: drawn.filter((item) => item.struck).map(asDrawn),
  };
}

// ---------------------------------------------------------------------------------------------
// Collisions

/** A collision with both sides spelled out for the page. */
export interface CollisionAsDrawn {
  collision: CollisionRecord;
  entryName: string;
  property: string;
  /** The author's fact, or null where the store no longer holds it. */
  authorsValue: string | null;
  authorsAboutName: string | null;
  storysValue: string;
  storysAboutName: string | null;
  sceneNumber: number | null;
}

/** Waiting collisions first, then the settled, each half in the order they arose. */
export function collisionsWithBothSides(snapshot: RunSnapshot): { waiting: CollisionAsDrawn[]; settled: CollisionAsDrawn[] } {
  const entryNamesById = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  const factsById = new Map(snapshot.facts.map((fact) => [fact.id, fact]));
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const nameOf = (entryId: Id | null): string | null => (entryId === null ? null : entryNamesById.get(entryId) ?? null);
  const drawn = [...snapshot.collisions]
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((collision): CollisionAsDrawn => {
      const authorsFact = factsById.get(collision.standingFactId) ?? null;
      return {
        collision,
        entryName: nameOf(collision.entryId) ?? 'an entry the run no longer holds',
        property: collision.property,
        authorsValue: authorsFact === null ? null : authorsFact.value,
        authorsAboutName: authorsFact === null ? null : nameOf(authorsFact.aboutEntryId),
        storysValue: collision.proposedValue,
        storysAboutName: nameOf(collision.proposedAboutEntryId),
        sceneNumber: collision.sceneId === null ? null : sceneNumbers.get(collision.sceneId) ?? null,
      };
    });
  return {
    waiting: drawn.filter((item) => item.collision.state === 'waiting'),
    settled: drawn.filter((item) => item.collision.state !== 'waiting'),
  };
}

export function collisionStateInWords(collision: CollisionRecord): string {
  if (collision.state === 'author-kept') return "Settled: the author's fact was kept.";
  if (collision.state === 'story-taken') return "Settled: the story's fact was taken.";
  return 'Waiting for the author.';
}

// ---------------------------------------------------------------------------------------------
// The briefing form

/** Names typed one per line or separated by commas, trimmed, each once whatever its case. */
export function upcomingNamesFromText(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const piece of text.split(/[,\n]/)) {
    const name = piece.trim();
    if (name === '' || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

export const SMALLEST_BUDGET_BYTES = 2000;
export const LARGEST_BUDGET_BYTES = 200000;
export const DEFAULT_BUDGET_BYTES = 20000;

/** The budget as typed, read into the whole number of bytes resume_run takes, or why it cannot be. */
export function budgetFromText(text: string): { ok: true; budgetBytes: number } | { ok: false; reason: string } {
  const typed = text.trim().replace(/[\s,_]/g, '');
  if (typed === '') return { ok: true, budgetBytes: DEFAULT_BUDGET_BYTES };
  if (!/^\d+$/.test(typed)) return { ok: false, reason: 'The budget is a whole number of bytes.' };
  const budgetBytes = Number(typed);
  if (budgetBytes < SMALLEST_BUDGET_BYTES || budgetBytes > LARGEST_BUDGET_BYTES) {
    return { ok: false, reason: `The budget is between ${SMALLEST_BUDGET_BYTES.toLocaleString('en')} and ${LARGEST_BUDGET_BYTES.toLocaleString('en')} bytes.` };
  }
  return { ok: true, budgetBytes };
}

/** A size a person reads: bytes up to a thousand, kilobytes past it. */
export function sizeInWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  return `${(bytes / 1000).toFixed(1)} kB (${bytes.toLocaleString('en')} bytes)`;
}

// ---------------------------------------------------------------------------------------------
// The wire

/** What one call to the server came to, as the page needs to act on it. */
export type CallOutcome<Answer> =
  | { kind: 'answer'; answer: Answer }
  | { kind: 'refusal'; refusal: string }
  | { kind: 'access-needed' }
  | { kind: 'fault'; fault: string };

export function routeOfOperation(operationName: string): string {
  return `${OPERATION_ROUTE_PREFIX}${operationName}`;
}

/**
 * Reads a response by its status and body. A 401 asks for the token again before anything is
 * read, since the body of a refused request says nothing the page can use.
 */
export function outcomeOfResponse<Answer>(status: number, bodyText: string): CallOutcome<Answer> {
  if (status === 401) return { kind: 'access-needed' };
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { kind: 'fault', fault: `The server answered ${status} with something that is not JSON.` };
  }
  if (typeof body !== 'object' || body === null || !('ok' in body)) {
    return { kind: 'fault', fault: `The server answered ${status} in a shape the page does not know.` };
  }
  const wire = body as WireAnswer<Answer>;
  if (wire.ok === true) {
    if (status >= 200 && status < 300) return { kind: 'answer', answer: wire.answer };
    return { kind: 'fault', fault: `The server answered ${status} and said it succeeded.` };
  }
  if (status === 400) return { kind: 'refusal', refusal: wire.refusal };
  // A body too large is refused before the operation runs, and the server's sentence names the
  // route's limit, which is what the author needs rather than a fault with a status in it.
  if (status === 413) return { kind: 'refusal', refusal: wire.refusal };
  return { kind: 'fault', fault: `The server answered ${status}: ${wire.refusal}` };
}

// ---------------------------------------------------------------------------------------------
// Routes

export const RUN_SECTIONS = ['scenes', 'entries', 'rulings', 'threads', 'journeys', 'collisions', 'briefing'] as const;
export type RunSection = (typeof RUN_SECTIONS)[number];

export type Route =
  | { page: 'runs' }
  | { page: 'run'; slug: string; section: RunSection; itemId: string | null };

/** Reads the address after the `#`. Anything not understood is the list of runs. */
export function routeFromHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter((part) => part !== '').map(safelyDecoded);
  if (parts[0] !== 'runs' || parts[1] === undefined) return { page: 'runs' };
  const sectionText = parts[2] ?? 'scenes';
  const section = (RUN_SECTIONS as readonly string[]).includes(sectionText) ? (sectionText as RunSection) : 'scenes';
  return { page: 'run', slug: parts[1], section, itemId: parts[3] ?? null };
}

export function hashOfRoute(route: Route): string {
  if (route.page === 'runs') return '#/runs';
  const base = `#/runs/${encodeURIComponent(route.slug)}/${route.section}`;
  return route.itemId === null ? base : `${base}/${encodeURIComponent(route.itemId)}`;
}

function safelyDecoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

// ---------------------------------------------------------------------------------------------
// Importing a run kept by hand

/** The five files a story kept by hand, in the order the import form lists them. */
export const IMPORT_PARTS = ['log', 'state', 'cast', 'items', 'places'] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

/**
 * The largest body the server takes for `import_run`: the figure of
 * `LARGEST_BODY_BYTES_BY_OPERATION.import_run` in apps/server/src/http-server.ts, which the
 * contract does not hold. A server test reads this file and fails if the two figures part.
 */
export const LARGEST_IMPORT_BODY_BYTES = 24 * 1024 * 1024;

/** A picked file as the matching needs it. The browser's `File` has both. */
export interface FileToMatch {
  name: string;
  size: number;
}

export interface FilesMatchedToParts<FilePicked extends FileToMatch> {
  /** The one file matched to each part, or null where none was given. */
  byPart: Record<ImportPart, FilePicked | null>;
  /** Files that match no part, kept so the page can say they will not be read. */
  notUsed: FilePicked[];
  /** One sentence per part that more than one file matched, naming every one of them. */
  refusals: string[];
}

/**
 * The part a file name is for, case-blind, or null. A name is the part's own (`log.md`) or ends
 * with it after something that is not a letter or a digit (`the-run-log.md`, `9e21-state.md`),
 * since a downloaded file often carries a prefix. The boundary is what keeps `catalog.md` and
 * `estate.md` from being read as a log and a state.
 */
export function partOfFileName(fileName: string): ImportPart | null {
  const lowered = fileName.trim().toLowerCase();
  for (const part of IMPORT_PARTS) {
    const ending = `${part}.md`;
    if (lowered === ending) return part;
    if (lowered.endsWith(ending) && !/[a-z0-9]/.test(lowered.charAt(lowered.length - ending.length - 1))) return part;
  }
  return null;
}

/** Each picked file matched to its part by name; two for one part is refused rather than guessed. */
export function matchFilesToParts<FilePicked extends FileToMatch>(files: readonly FilePicked[]): FilesMatchedToParts<FilePicked> {
  const candidatesByPart = new Map<ImportPart, FilePicked[]>(IMPORT_PARTS.map((part) => [part, []]));
  const notUsed: FilePicked[] = [];
  for (const file of files) {
    const part = partOfFileName(file.name);
    if (part === null) notUsed.push(file);
    else candidatesByPart.get(part)?.push(file);
  }
  const byPart = Object.fromEntries(IMPORT_PARTS.map((part) => [part, null])) as Record<ImportPart, FilePicked | null>;
  const refusals: string[] = [];
  for (const part of IMPORT_PARTS) {
    const candidates = candidatesByPart.get(part) ?? [];
    if (candidates.length === 1) byPart[part] = candidates[0] ?? null;
    if (candidates.length > 1) {
      const everyOne = candidates.length === 2 ? 'both' : 'all';
      refusals.push(`${namesInWords(candidates.map((file) => `"${file.name}"`))} are ${everyOne} read as ${part}.md. Pick only one of them.`);
    }
  }
  return { byPart, notUsed, refusals };
}

function namesInWords(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** How many parts have a file. */
export function partsMatchedCount(matched: FilesMatchedToParts<FileToMatch>): number {
  return IMPORT_PARTS.filter((part) => matched.byPart[part] !== null).length;
}

/**
 * The title line of a log file, as the server's reader takes it: the first top heading, unless it
 * names a movement, with a trailing "- log" taken off. Null where there is none.
 */
export function titleFromLogText(logText: string): string | null {
  for (const line of logText.split(/\r?\n/)) {
    const heading = /^#\s+(.*)$/.exec(line);
    if (heading === null) continue;
    const headingText = (heading[1] ?? '').trim();
    if (/^(movement|act|part|book)\b/i.test(headingText) && !/\s[-–]\s*log$/i.test(headingText)) return null;
    const title = headingText.replace(/\s*[-–]\s*log$/i, '').trim();
    return title === '' ? null : title;
  }
  return null;
}

/** The longest slug offered from a title. A slug is a handle, not the title written again. */
export const LONGEST_OFFERED_SLUG = 60;

/**
 * A slug made from a title: lower case, accents taken off, every run of anything else a hyphen,
 * cut at a hyphen near sixty characters. An empty string where the title has no letter or digit.
 */
export function slugFromTitle(title: string): string {
  const plain = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const slug = plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= LONGEST_OFFERED_SLUG) return slug;
  const cut = slug.slice(0, LONGEST_OFFERED_SLUG);
  const lastHyphen = cut.lastIndexOf('-');
  return (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, '');
}

/** The slug the box shows: what the author typed once they have typed, else the one offered. */
export function slugShown(typedSlug: string, authorTyped: boolean, titleOfLog: string | null): string {
  if (authorTyped) return typedSlug;
  return titleOfLog === null ? '' : slugFromTitle(titleOfLog);
}

/**
 * Why a slug is not well formed, or null where it is. The rule is the contract's own pattern,
 * asked of the operation's schema so the page cannot drift from what the server takes.
 */
export function whySlugIsNotWellFormed(slug: string): string | null {
  if (slug === '') return 'Give the run a slug.';
  if (OPERATIONS.import_run.input.shape.slug.safeParse(slug).success) return null;
  return 'A slug is lower case letters and digits, in words joined by single hyphens, with no hyphen at either end.';
}

/** A size in megabytes as a person reads it, for the size refusal. */
export function megabytesInWords(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why the files together are too large to send, or null where they may fit, asked before they
 * are read. What is sent is never smaller than the files, since JSON only adds to text, so files
 * over the limit can never fit; files under it may still not, which `importToSend` says.
 */
export function whyFilesAreTooLarge(sizes: readonly number[]): string | null {
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  if (totalBytes <= LARGEST_IMPORT_BODY_BYTES) return null;
  return `The files come to ${megabytesInWords(totalBytes)} together, and an import takes at most ${megabytesInWords(LARGEST_IMPORT_BODY_BYTES)}.`;
}

/**
 * Why the Import button cannot be pressed yet, or null where it can. The first reason that holds
 * is the one given, so the author fixes one thing at a time.
 */
export function whyImportCannotStart(matched: FilesMatchedToParts<FileToMatch>, slug: string): string | null {
  if (matched.refusals.length > 0) return matched.refusals[0] ?? null;
  if (partsMatchedCount(matched) === 0) return 'Pick at least one of the five files.';
  const sizes = IMPORT_PARTS.flatMap((part) => {
    const file = matched.byPart[part];
    return file === null ? [] : [file.size];
  });
  const tooLarge = whyFilesAreTooLarge(sizes);
  if (tooLarge !== null) return tooLarge;
  return whySlugIsNotWellFormed(slug);
}

export interface ImportForm {
  slug: string;
  title: string;
  setting: string;
  status: RunStatus;
  /** True where the author ticked replacing the earlier import. Left out, nothing is replaced. */
  replaceEarlierImport?: boolean;
}

/**
 * The `import_run` input from the form and the text of each file read. A part with no file goes
 * as an empty text, which is how the contract says "not kept"; a title or setting left blank is
 * left out, so the server reads the title from the files' own heading.
 */
export function importRunInput(form: ImportForm, textByPart: Partial<Record<ImportPart, string>>): RequestOf<'import_run'> {
  const title = form.title.trim();
  const setting = form.setting.trim();
  return {
    slug: form.slug,
    ...(title === '' ? {} : { title }),
    ...(setting === '' ? {} : { setting }),
    status: form.status,
    files: Object.fromEntries(IMPORT_PARTS.map((part) => [part, textByPart[part] ?? ''])) as Record<ImportPart, string>,
    ...(form.replaceEarlierImport === true ? { replaceEarlierImport: true } : {}),
  };
}

/**
 * The slug the server last refused because a run already has it, or null. Replacing the earlier
 * import is offered only after that refusal, so nobody removes a run they did not know was there.
 */
export function slugRefusedAsExisting(refusal: string, slugSent: string): string | null {
  return isRunAlreadyExistsSentence(refusal) ? slugSent : null;
}

/**
 * Whether the box to replace the earlier import is drawn: only while the slug in the form is the
 * one the server said already exists. Changing the slug takes the offer away, since the run the
 * offer was about is no longer the one the import would land on.
 */
export function replaceEarlierImportOffered(slugTheServerSaidExists: string | null, slug: string): boolean {
  return slugTheServerSaidExists !== null && slugTheServerSaidExists === slug;
}

/** The label of the box, naming the run and saying the picked files are what take its place. */
export function replaceEarlierImportLabel(slug: string): string {
  return `Replace the earlier import of "${slug}" with the files picked above. The run it made is removed with everything it holds, and these files are imported in its place. The store refuses this if a story or you wrote anything in that run after it was imported.`;
}

/** The import button's text: plain, or saying it replaces the earlier import. */
export function importButtonText(running: boolean, replacing: boolean): string {
  if (running) return replacing ? 'Replacing…' : 'Importing…';
  return replacing ? 'Import, replacing the earlier one' : 'Import';
}

/** The size of a request body as it travels: its JSON, escaping counted, in UTF-8 bytes. */
export function bodyBytesOf(input: unknown): number {
  return new TextEncoder().encode(JSON.stringify(input)).length;
}

/**
 * The input to send, or why it cannot be sent: the body is measured as it will travel, since
 * JSON escaping can more than double a text (a quote or a line break becomes two characters),
 * and is held to the server's limit so an import the page starts never meets a 413.
 */
export function importToSend(
  form: ImportForm,
  textByPart: Partial<Record<ImportPart, string>>,
): { ok: true; input: RequestOf<'import_run'> } | { ok: false; reason: string } {
  const input = importRunInput(form, textByPart);
  const bodyBytes = bodyBytesOf(input);
  if (bodyBytes <= LARGEST_IMPORT_BODY_BYTES) return { ok: true, input };
  return {
    ok: false,
    reason: `The import comes to ${megabytesInWords(bodyBytes)} as it would be sent, and the server takes at most ${megabytesInWords(LARGEST_IMPORT_BODY_BYTES)}. Nothing was sent.`,
  };
}

/** Every count an import answers with, in words, in a fixed order. */
const IMPORT_COUNT_LABELS: Record<keyof ImportedRunReport['counts'], string> = {
  scenes: 'Scenes',
  entries: 'Entries',
  facts: 'Facts',
  trailNotes: 'Trail notes',
  rulings: 'Rulings',
  threads: 'Threads',
  waypoints: 'Waypoints',
  journeyLegs: 'Journey legs',
  clocks: 'Clocks',
};

export function importCountsInWords(counts: ImportedRunReport['counts']): Array<{ label: string; count: number }> {
  return (Object.keys(IMPORT_COUNT_LABELS) as Array<keyof ImportedRunReport['counts']>).map((key) => ({
    label: IMPORT_COUNT_LABELS[key],
    count: counts[key],
  }));
}

/** What a replacing import removed, in the same words and order as what it imported, or null where it replaced nothing. */
export function removedEarlierImportInWords(report: ImportedRunReport): Array<{ label: string; count: number }> | null {
  const removed = report.removedEarlierImport ?? null;
  return removed === null ? null : importCountsInWords(removed);
}

/** The sentence for the lines the reader could not place, singular where there is one. */
export function unplacedInWords(unplacedCount: number): string {
  if (unplacedCount === 0) return 'Every line was placed.';
  if (unplacedCount === 1) return '1 line could not be placed.';
  return `${unplacedCount.toLocaleString('en')} lines could not be placed.`;
}

// ---------------------------------------------------------------------------------------------
// The author's hand: what the forms on a run's page send, and the history they leave

/**
 * The newest standing scene of the run, which is the scene every act the author makes outside a
 * scene is dated to (docs/decisions/0003). Null where the run has no standing scene yet.
 */
export function newestStandingScene(snapshot: RunSnapshot): SceneRecord | null {
  let newest: SceneRecord | null = null;
  for (const scene of snapshot.scenes) {
    if (scene.status !== 'standing') continue;
    if (newest === null || scene.number > newest.number) newest = scene;
  }
  return newest;
}

/** When an act made now takes effect, in words: "as of scene 3", or "before the scenes". */
export function asOfNowInWords(snapshot: RunSnapshot): string {
  const newest = newestStandingScene(snapshot);
  return newest === null ? 'before the scenes' : `as of scene ${newest.number}`;
}

/**
 * Why an act that has to stop at a scene cannot be made yet, or null where it can. Ending a fact,
 * withdrawing, closing and touching all stop at the newest standing scene, so they wait for one.
 */
export function whyAnActNeedsAScene(snapshot: RunSnapshot): string | null {
  return newestStandingScene(snapshot) === null
    ? 'The run has no scene yet, so there is nothing for this to stop at. It can be done once a scene is saved.'
    : null;
}

/** The numbers of the standing scenes, lowest first: the scenes a waypoint can be marked reached at. */
export function standingSceneNumbers(snapshot: RunSnapshot): number[] {
  return snapshot.scenes
    .filter((scene) => scene.status === 'standing')
    .map((scene) => scene.number)
    .sort((first, second) => first - second);
}

/** What a form hands the server, or why it is not sent yet. */
export type ToSend<Input> = { ok: true; input: Input } | { ok: false; reason: string };

/** Text the author typed, trimmed, or the reason it cannot be sent empty. */
export function typedTextOrReason(text: string, whatItIs: string): ToSend<string> {
  const trimmed = text.trim();
  return trimmed === '' ? { ok: false, reason: `Write ${whatItIs} first.` } : { ok: true, input: trimmed };
}

/** What an answer says the author should know. Only an entry's write carries cautions. */
export function cautionsOfAnswer(answer: unknown): string[] {
  if (typeof answer !== 'object' || answer === null || !('cautions' in answer)) return [];
  const cautions = (answer as { cautions: unknown }).cautions;
  return Array.isArray(cautions) ? cautions.filter((caution): caution is string => typeof caution === 'string') : [];
}

// The run's own details

/** The run's details as the edit form holds them. */
export interface RunDetailsForm {
  title: string;
  setting: string;
  register: string;
  status: RunStatus;
}

export function runDetailsFormOf(run: RunSnapshot['run']): RunDetailsForm {
  return { title: run.title, setting: run.setting, register: run.register, status: run.status };
}

/**
 * The `edit_run` input for what the form changed, and only that, or why nothing is sent. A title
 * is trimmed and may not be empty; the setting and the register are kept as typed, since line
 * breaks in them are the author's.
 */
export function runEditToSend(runSlug: string, run: RunSnapshot['run'], form: RunDetailsForm): ToSend<RequestOf<'edit_run'>> {
  const title = form.title.trim();
  if (title === '') return { ok: false, reason: 'The run needs a title.' };
  const input: RequestOf<'edit_run'> = { run: runSlug };
  if (title !== run.title) input.title = title;
  if (form.setting !== run.setting) input.setting = form.setting;
  if (form.register !== run.register) input.register = form.register;
  if (form.status !== run.status) input.status = form.status;
  if (Object.keys(input).length === 1) return { ok: false, reason: 'Nothing here differs from what the run holds.' };
  return { ok: true, input };
}

const RUN_FIELD_LABELS: Record<RunEditRecord['field'], string> = {
  title: 'Title',
  setting: 'Setting',
  register: 'How it is narrated',
  status: 'Status',
};

/**
 * One earlier value of a part of the run or of an entry, as the page draws it. `earlier` and
 * `later` are ready to draw: each value in its own quotation marks, or "nothing recorded" where
 * there was none, so an empty value never reads as a word that was typed.
 */
export interface EarlierValue {
  label: string;
  earlier: string;
  later: string;
  changedAfterSceneNumber: number | null;
}

const NOTHING_RECORDED = 'nothing recorded';

/** One value in quotation marks, or "nothing recorded" where it is empty. */
export function quotedValueInWords(value: string): string {
  return value === '' ? NOTHING_RECORDED : `\u201c${value}\u201d`;
}

/**
 * Names each in its own quotation marks, so a name that holds a comma still reads as one name;
 * "nothing recorded" where there are none.
 */
export function quotedNamesInWords(names: readonly string[]): string {
  return names.length === 0 ? NOTHING_RECORDED : names.map((name) => `\u201c${name}\u201d`).join(', ');
}

function statusInWords(value: string): string {
  if (value === 'binding') return 'binding';
  if (value === 'telling') return 'a telling';
  return value;
}

/** Every change the author made to the run, oldest first, in words. */
export function runHistoryInWords(snapshot: RunSnapshot): EarlierValue[] {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return [...snapshot.runEdits]
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((edit) => {
      const inWords = (value: string) => quotedValueInWords(edit.field === 'status' ? statusInWords(value) : value);
      return {
        label: RUN_FIELD_LABELS[edit.field],
        earlier: inWords(edit.earlierValue),
        later: inWords(edit.laterValue),
        changedAfterSceneNumber: edit.afterSceneId === null ? null : sceneNumbers.get(edit.afterSceneId) ?? null,
      };
    });
}

/** Where a change was made, in words. */
export function changedWhenInWords(changedAfterSceneNumber: number | null): string {
  return changedAfterSceneNumber === null ? 'before the scenes' : `after scene ${changedAfterSceneNumber}`;
}

// Entries

const ENTRY_FIELD_LABELS: Record<EntryEditRecord['field'], string> = {
  name: 'Name',
  alsoKnownAs: 'Other names',
  pronoun: 'Pronoun',
  kind: 'Kind',
  visibility: 'Who sees it',
};

/** An entry edit's value in words: a list of other names is written as a JSON array. */
function entryEditValueInWords(field: EntryEditRecord['field'], value: string): string {
  if (field === 'alsoKnownAs') {
    try {
      const names: unknown = JSON.parse(value);
      if (Array.isArray(names)) return quotedNamesInWords(names.map(String));
    } catch {
      return quotedValueInWords(value);
    }
    return quotedValueInWords(value);
  }
  if (field === 'visibility') return quotedValueInWords(value === 'author-only' ? 'author only' : 'open');
  return quotedValueInWords(value);
}

/** Every change the author made to one entry, oldest first, in words. */
export function entryHistoryInWords(entryId: Id, snapshot: RunSnapshot): EarlierValue[] {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return snapshot.entryEdits
    .filter((edit) => edit.entryId === entryId)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((edit) => ({
      label: ENTRY_FIELD_LABELS[edit.field],
      earlier: entryEditValueInWords(edit.field, edit.earlierValue),
      later: entryEditValueInWords(edit.field, edit.laterValue),
      changedAfterSceneNumber: edit.afterSceneId === null ? null : sceneNumbers.get(edit.afterSceneId) ?? null,
    }));
}

/**
 * Other names as typed in their box: one per line, trimmed, each once whatever its case. A comma
 * does not split, since a name may hold one ("Odo, the miller").
 */
export function namesOnePerLine(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const name = line.trim();
    if (name === '' || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/**
 * How many rows a box typed one item per line needs to show every line and one more to type on,
 * never fewer than two: a box shorter than what it holds hides lines with no sign they are there.
 */
export function rowsForLinesOf(text: string): number {
  return Math.max(2, text.split('\n').length + 1);
}

/** A new entry as the add form holds it. Other names are typed one per line. */
export interface NewEntryForm {
  name: string;
  kind: EntryKind;
  alsoKnownAsText: string;
  pronoun: string;
  visibility: Visibility;
}

export function newEntryToSend(runSlug: string, form: NewEntryForm): ToSend<RequestOf<'add_entry'>> {
  const name = typedTextOrReason(form.name, 'a name');
  if (!name.ok) return name;
  return {
    ok: true,
    input: {
      run: runSlug,
      name: name.input,
      kind: form.kind,
      alsoKnownAs: namesOnePerLine(form.alsoKnownAsText),
      pronoun: form.pronoun.trim(),
      visibility: form.visibility,
    },
  };
}

/** An entry's details as the edit form holds them. */
export interface EntryDetailsForm {
  kind: EntryKind;
  alsoKnownAsText: string;
  pronoun: string;
}

export function entryDetailsFormOf(entry: EntryRecord): EntryDetailsForm {
  return { kind: entry.kind, alsoKnownAsText: entry.alsoKnownAs.join('\n'), pronoun: entry.pronoun };
}

/** The `edit_entry` input for what the form changed, and only that, or why nothing is sent. */
export function entryEditToSend(entry: EntryRecord, form: EntryDetailsForm): ToSend<RequestOf<'edit_entry'>> {
  const input: RequestOf<'edit_entry'> = { entry: entry.id };
  if (form.kind !== entry.kind) input.kind = form.kind;
  const alsoKnownAs = namesOnePerLine(form.alsoKnownAsText);
  if (JSON.stringify(alsoKnownAs) !== JSON.stringify(entry.alsoKnownAs)) input.alsoKnownAs = alsoKnownAs;
  const pronoun = form.pronoun.trim();
  if (pronoun !== entry.pronoun) input.pronoun = pronoun;
  if (Object.keys(input).length === 1) return { ok: false, reason: 'Nothing here differs from what the entry holds.' };
  return { ok: true, input };
}

/** The `rename_entry` input, or why it is not sent. */
export function renameToSend(entry: EntryRecord, typedName: string): ToSend<RequestOf<'rename_entry'>> {
  const name = typedTextOrReason(typedName, 'the new name');
  if (!name.ok) return name;
  if (name.input === entry.name) return { ok: false, reason: `It is called ${entry.name} already.` };
  return { ok: true, input: { entry: entry.id, name: name.input } };
}

/** A fact the author states, as the form on an entry holds it. */
export interface FactForm {
  property: string;
  value: string;
  /** The id of the entry it points at, or '' for none. */
  aboutEntryId: string;
  visibility: Visibility;
  note: string;
}

export const EMPTY_FACT_FORM: FactForm = { property: '', value: '', aboutEntryId: '', visibility: 'open', note: '' };

/** The `state_fact` input, naming the entry and what it points at by id, or why it is not sent. */
export function factToSend(runSlug: string, entryId: Id, form: FactForm): ToSend<RequestOf<'state_fact'>> {
  const property = typedTextOrReason(form.property, 'what is being said (the property)');
  if (!property.ok) return property;
  const value = typedTextOrReason(form.value, 'what is so (the value)');
  if (!value.ok) return value;
  const input: RequestOf<'state_fact'> = {
    run: runSlug, entryId, property: property.input, value: value.input, visibility: form.visibility, note: form.note.trim(),
  };
  if (form.aboutEntryId !== '') input.aboutEntryId = form.aboutEntryId;
  return { ok: true, input };
}

/** The properties an entry has been given, so the fact form can offer them. */
export function propertiesOfEntry(entryId: Id, snapshot: RunSnapshot): string[] {
  return [...new Set(snapshot.facts.filter((fact) => fact.entryId === entryId).map((fact) => fact.property))];
}

/** Entries by name, for a choice of which one a fact or a thread points at. */
export function entriesByName(entries: EntryRecord[]): EntryRecord[] {
  return [...entries].sort((first, second) => first.name.localeCompare(second.name) || first.createdAt.localeCompare(second.createdAt));
}

/**
 * The entries a thread may be about, by name. A thread is told to a story, so only an open entry is
 * offered; the store refuses an author-only one.
 */
export function entriesAThreadMayBeAbout(entries: EntryRecord[]): EntryRecord[] {
  return entriesByName(entries.filter((entry) => entry.visibility === 'open'));
}

// Rulings

/**
 * An entry a ruling may name. A ruling is told to a story and names its entries by name, so only
 * an open entry may be named; one whose name another open entry shares is offered but marked, since
 * the server cannot tell which is meant and refuses it.
 */
export interface EntryARulingMayName {
  entry: EntryRecord;
  sharesItsName: boolean;
}

export function entriesARulingMayName(snapshot: RunSnapshot): EntryARulingMayName[] {
  const open = entriesByName(snapshot.entries.filter((entry) => entry.visibility === 'open'));
  const answering = new Map<string, number>();
  for (const entry of open) {
    for (const name of [entry.name, ...entry.alsoKnownAs]) {
      const key = name.trim().toLowerCase();
      answering.set(key, (answering.get(key) ?? 0) + 1);
    }
  }
  return open.map((entry) => ({ entry, sharesItsName: (answering.get(entry.name.trim().toLowerCase()) ?? 0) > 1 }));
}

/** A ruling as the form holds it. Topics are typed one per line or between commas. */
export interface RulingForm {
  text: string;
  scope: RulingScope;
  topicsText: string;
  /** The ids of the open entries it is about. */
  aboutEntryIds: Id[];
}

/**
 * The `record_ruling` input, or why it is not sent. The words are sent exactly as typed, since a
 * ruling is kept word for word; only words that are nothing but spaces are refused.
 */
export function rulingToSend(runSlug: string, form: RulingForm, snapshot: RunSnapshot): ToSend<RequestOf<'record_ruling'>> {
  if (form.text.trim() === '') return { ok: false, reason: 'Write the ruling first.' };
  const namesById = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  return {
    ok: true,
    input: {
      run: runSlug,
      text: form.text,
      statedByAuthor: true,
      scope: form.scope,
      topics: upcomingNamesFromText(form.topicsText),
      about: form.aboutEntryIds.flatMap((id) => {
        const name = namesById.get(id);
        return name === undefined ? [] : [name];
      }),
    },
  };
}

/** Rulings still in force, and those withdrawn, each in the order given. */
export function rulingsSplitByWithdrawal(rulings: RulingRecord[]): { inForce: RulingRecord[]; withdrawn: RulingRecord[] } {
  const byNumber = [...rulings].sort((first, second) => first.number - second.number);
  return {
    inForce: byNumber.filter((ruling) => ruling.withdrawnInSceneId === null),
    withdrawn: byNumber.filter((ruling) => ruling.withdrawnInSceneId !== null),
  };
}

// What each lasting act says before it is made

/** The one line a lasting act says before it is made: what it does, and that nothing is deleted. */
export function lastingActInWords(act: 'end-fact' | 'withdraw-ruling' | 'withdraw-waypoint' | 'close-thread' | 'turn-author-only' | 'turn-open', snapshot: RunSnapshot): string {
  const when = asOfNowInWords(snapshot);
  switch (act) {
    case 'end-fact':
      return `This fact stops holding ${when}, with nothing in its place. Nothing is deleted: it stays in the history.`;
    case 'withdraw-ruling':
      return `A story is no longer told this ruling, ${when}. Nothing is deleted: it is kept word for word and shown here as withdrawn.`;
    case 'withdraw-waypoint':
      return `A story is no longer told to steer towards this, ${when}. Nothing is deleted: it is kept and shown here as withdrawn.`;
    case 'close-thread':
      return `The thread closes ${when} with the words given. Nothing is deleted: it is kept and shown as closed.`;
    case 'turn-author-only':
      return 'A story stops being told of this entry, its facts and its trail at once. Nothing is deleted: turning it open again puts them all back.';
    case 'turn-open':
      return 'A story is told of this entry again, with its facts and its trail. Nothing else changes.';
  }
}
