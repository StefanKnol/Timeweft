/**
 * Every bit of data shaping the pages need, as small pure functions.
 *
 * The pages only draw what these hand them. Keeping the shaping here, away from React and the
 * browser, is what lets `node --test` hold it: a rule about which fact holds or which take is
 * struck is tested once, not looked at in a screenshot.
 */
import { ENTRY_KINDS, OPERATION_ROUTE_PREFIX } from '@timeweft/contract';
import type {
  ClockReading, ClockRecord, CollisionRecord, EntryKind, EntryNoteRecord, EntryRecord, FactRecord,
  Id, JourneyLegRecord, RulingRecord, RunSnapshot, SceneRecord, ThreadRecord, Visibility, WaypointRecord, WireAnswer,
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

/** A thread with the scene numbers it opened and closed at. */
export interface ThreadAsDrawn {
  thread: ThreadRecord;
  openedInSceneNumber: number | null;
  closedInSceneNumber: number | null;
}

/** Open threads first, each half in the order the threads opened. */
export function threadsOpenFirst(threads: ThreadRecord[], scenes: SceneRecord[]): { open: ThreadAsDrawn[]; closed: ThreadAsDrawn[] } {
  const sceneNumbers = sceneNumbersById(scenes);
  const drawn = threads
    .map((thread) => ({
      thread,
      openedInSceneNumber: thread.openedInSceneId === null ? null : sceneNumbers.get(thread.openedInSceneId) ?? null,
      closedInSceneNumber: thread.closedInSceneId === null ? null : sceneNumbers.get(thread.closedInSceneId) ?? null,
    }))
    .sort((first, second) => {
      const byOpening = (first.openedInSceneNumber ?? 0) - (second.openedInSceneNumber ?? 0);
      return byOpening !== 0 ? byOpening : first.thread.createdAt.localeCompare(second.thread.createdAt);
    });
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
}

/**
 * Waypoints still ahead first, in the order the author set them, then the reached in scene order.
 * A waypoint is reached only by a standing scene: one a struck take reached is still ahead, since
 * the story never reached it in any take that is served.
 */
export function waypointsAheadFirst(snapshot: RunSnapshot): { ahead: WaypointAsDrawn[]; reached: WaypointAsDrawn[] } {
  const standingNumbers = new Map(snapshot.scenes.filter((scene) => scene.status === 'standing').map((scene) => [scene.id, scene.number]));
  const drawn = [...snapshot.waypoints]
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((waypoint) => ({
      waypoint,
      reachedInSceneNumber: waypoint.reachedInSceneId === null ? null : standingNumbers.get(waypoint.reachedInSceneId) ?? null,
    }));
  return {
    ahead: drawn.filter((item) => item.reachedInSceneNumber === null),
    reached: drawn
      .filter((item) => item.reachedInSceneNumber !== null)
      .sort((first, second) => (first.reachedInSceneNumber ?? 0) - (second.reachedInSceneNumber ?? 0)),
  };
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
