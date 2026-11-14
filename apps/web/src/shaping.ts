/**
 * Every bit of data shaping the pages need, as small pure functions.
 *
 * The pages only draw what these hand them. Keeping the shaping here, away from React and the
 * browser, is what lets `node --test` hold it: a rule about which fact holds or which take is
 * struck is tested once, not looked at in a screenshot.
 */
import {
  ENTRY_KINDS, OPERATION_ROUTE_PREFIX, OPERATIONS, RUN_EXPORT_TABLE_IN_WORDS, RUN_EXPORT_TABLE_NAMES, Refusal, backupFileName, isRunAlreadyExistsSentence,
  readRunExportDocument, runExportDocumentAsText,
} from '@timeweft/contract';
import type {
  ClockReading, ClockRecord, CollisionRecord, EntryKind, EntryNoteRecord, EntryRecord, FactRecord,
  EntryEditRecord, Id, ImportedRunReport, RestoredRunReport, RunExportDocument, RunExportRowCounts, RunExportTableName, JourneyLegRecord, RequestOf, RulingRecord, RulingScope, RunEditRecord, RunOutline, RunStatus, SceneEditOutline, SceneOutline, SceneSearchMatch, SearchedSceneField, ThreadRecord, Visibility, WaypointRecord, WireAnswer,
} from '@timeweft/contract';

// ---------------------------------------------------------------------------------------------
// Scenes

/** One scene number, with the take that stands and every take struck at that number. */
export interface SceneSlot {
  number: number;
  /** Null where every take at this number was struck. */
  standing: SceneOutline | null;
  /** Oldest first, so the order reads as the order they were written. */
  struck: SceneOutline[];
}

/** Scenes by number, with struck takes kept under their number rather than mixed into the list. */
export function scenesByNumber(scenes: SceneOutline[]): SceneSlot[] {
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

// ---------------------------------------------------------------------------------------------
// The scene list: its order, its search and its filters

/** The two orders a long list may be drawn in. */
export const LIST_ORDERS = ['newest-first', 'oldest-first'] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

/** The browser storage key a section's chosen order is kept under. */
export function orderStorageKey(section: RunSection): string {
  return `timeweft.order.${section}`;
}

/** An order read back from the browser's storage. Anything not understood is newest first. */
export function listOrderFromStored(stored: string | null): ListOrder {
  return stored === 'oldest-first' ? 'oldest-first' : 'newest-first';
}

/** What a long list draws in the order chosen, and where "Show older" goes. */
export interface OrderedForDrawing<Item> {
  /** The items to draw, in the order they are drawn. */
  shown: Item[];
  /** How many older items are not drawn. */
  olderNotShown: number;
  /** How many one press of "Show older" would add. */
  showOlderWouldAdd: number;
  /**
   * Where the "Show older" button goes: at the foot when the newest come first, at the top when the
   * oldest come first, so it sits where the older items will appear.
   */
  showOlderAt: 'foot' | 'top';
}

/**
 * The newest `shownCount` items of a list, drawn newest first or oldest first. Either way the
 * newest are the ones drawn; only the order of drawing changes.
 */
export function orderedForDrawing<Item>(oldestFirst: readonly Item[], order: ListOrder, shownCount: number, step: number): OrderedForDrawing<Item> {
  const newest = newestShown(oldestFirst, shownCount, step);
  return {
    shown: order === 'newest-first' ? [...newest.shown].reverse() : newest.shown,
    olderNotShown: newest.olderNotShown,
    showOlderWouldAdd: newest.showOlderWouldAdd,
    showOlderAt: order === 'newest-first' ? 'foot' : 'top',
  };
}

/**
 * Text made ready for matching: lower case, accents taken off, runs of space made one. "Café" and
 * "CAFE" match each other.
 */
export function normaliseForMatching(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The words of one take the list's own search looks in, without its prose. */
function searchableWordsOfScene(scene: SceneOutline): string {
  return normaliseForMatching([scene.title, scene.summary, scene.whenTyped, scene.steer, scene.situationAfter].join('\n'));
}

/** Whether one take matches typed text, by its number or by its words. */
function sceneMatchesText(scene: SceneOutline, typed: string): boolean {
  if (/^\d+$/.test(typed) && scene.number === Number(typed)) return true;
  return searchableWordsOfScene(scene).includes(typed);
}

/**
 * The scene numbers whose takes match typed text: the number itself, or the title, summary, when,
 * steer or where things stood after, case- and accent-blind. A struck take counts for its number.
 * Empty text matches every scene.
 */
export function scenesMatching(slots: readonly SceneSlot[], typedText: string): SceneSlot[] {
  const typed = normaliseForMatching(typedText);
  if (typed === '') return [...slots];
  return slots.filter((slot) => takesOfSlot(slot).some((scene) => sceneMatchesText(scene, typed)));
}

/** Every take at one number: the standing one first, where there is one. */
export function takesOfSlot(slot: SceneSlot): SceneOutline[] {
  return slot.standing === null ? slot.struck : [slot.standing, ...slot.struck];
}

/** Why a scene is with an entry: it is set there, it first named it, or a note or fact of it is about it. */
export type SceneWithEntryReason = 'place' | 'introduced' | 'note' | 'fact';

/**
 * For every entry, the scenes it is in, with why: the scenes set at it, the one that first named
 * it, and the scenes whose notes or facts are about it (a fact about it, or one pointing at it).
 * Built once for a run, so a filter by entry costs a lookup.
 */
export function scenesInvolvingEntry(snapshot: RunOutline): Map<Id, Map<Id, Set<SceneWithEntryReason>>> {
  const index = new Map<Id, Map<Id, Set<SceneWithEntryReason>>>();
  const add = (entryId: Id | null, sceneId: Id | null, reason: SceneWithEntryReason) => {
    if (entryId === null || sceneId === null) return;
    let scenes = index.get(entryId);
    if (scenes === undefined) {
      scenes = new Map();
      index.set(entryId, scenes);
    }
    let reasons = scenes.get(sceneId);
    if (reasons === undefined) {
      reasons = new Set();
      scenes.set(sceneId, reasons);
    }
    reasons.add(reason);
  };
  for (const scene of snapshot.scenes) add(scene.placeEntryId, scene.id, 'place');
  for (const entry of snapshot.entries) add(entry.id, entry.introducedInSceneId, 'introduced');
  for (const note of snapshot.notes) add(note.entryId, note.sceneId, 'note');
  for (const fact of snapshot.facts) {
    add(fact.entryId, fact.fromSceneId, 'fact');
    add(fact.aboutEntryId, fact.fromSceneId, 'fact');
  }
  return index;
}

/** What the scene list is narrowed by. */
export interface SceneListFilters {
  /** Typed into the search box, as it was when the search was last applied. */
  searchText: string;
  starredOnly: boolean;
  withStruckTakesOnly: boolean;
  /** Entries every scene shown must be with. */
  withEntryIds: Id[];
}

export const NO_SCENE_LIST_FILTERS: SceneListFilters = { searchText: '', starredOnly: false, withStruckTakesOnly: false, withEntryIds: [] };

/** Whether anything narrows the list. */
export function sceneListIsNarrowed(filters: SceneListFilters): boolean {
  return normaliseForMatching(filters.searchText) !== '' || filters.starredOnly || filters.withStruckTakesOnly || filters.withEntryIds.length > 0;
}

/**
 * The scene numbers left after every filter, oldest first. `foundInTextSceneIds` are the takes
 * the store's search of the scenes' text found for the same words; a number matches the search if
 * its own words match or any of its takes was found there.
 */
export function sceneSlotsMatchingFilters(
  slots: readonly SceneSlot[],
  filters: SceneListFilters,
  entryIndex: Map<Id, Map<Id, Set<SceneWithEntryReason>>>,
  foundInTextSceneIds: ReadonlySet<Id> = new Set(),
): SceneSlot[] {
  const typed = normaliseForMatching(filters.searchText);
  return slots.filter((slot) => {
    const takes = takesOfSlot(slot);
    if (typed !== '' && !takes.some((scene) => sceneMatchesText(scene, typed) || foundInTextSceneIds.has(scene.id))) return false;
    if (filters.starredOnly && slot.standing?.starred !== true) return false;
    if (filters.withStruckTakesOnly && slot.struck.length === 0) return false;
    for (const entryId of filters.withEntryIds) {
      const scenesOfEntry = entryIndex.get(entryId);
      if (scenesOfEntry === undefined || !takes.some((scene) => scenesOfEntry.has(scene.id))) return false;
    }
    return true;
  });
}

/** How many scenes each chip would show: starred standing takes, and numbers with struck takes. */
export function sceneChipCounts(slots: readonly SceneSlot[]): { starred: number; withStruckTakes: number } {
  return {
    starred: slots.filter((slot) => slot.standing?.starred === true).length,
    withStruckTakes: slots.filter((slot) => slot.struck.length > 0).length,
  };
}

/** "420 scenes", "The newest 50 of 420 scenes", "12 of 420 scenes match", "1 of 420 scenes matches". */
export function sceneCountInWords(totalCount: number, matchingCount: number, drawnCount: number, narrowed: boolean): string {
  const scenesWord = totalCount === 1 ? 'scene' : 'scenes';
  if (narrowed) return `${matchingCount} of ${totalCount} ${scenesWord} ${matchingCount === 1 ? 'matches' : 'match'}`;
  if (drawnCount >= totalCount) return `${totalCount} ${scenesWord}`;
  return `The newest ${drawnCount} of ${totalCount} ${scenesWord}`;
}

/**
 * The part of a scene's address after `scenes/`: the standing take by its number, a struck take by
 * its id, since a struck take has no number of its own.
 */
export function sceneItemIdOf(scene: SceneOutline): string {
  return scene.status === 'standing' ? String(scene.number) : scene.id;
}

/** The address of one take of a scene. */
export function hashOfScene(runSlug: string, scene: SceneOutline): string {
  return hashOfRoute({ page: 'run', slug: runSlug, section: 'scenes', itemId: sceneItemIdOf(scene) });
}

/** What a scene address names, read against the run. */
export type SceneOfItemId =
  | { found: 'take'; scene: SceneOutline }
  | { found: 'every-take-struck'; number: number; struck: SceneOutline[] }
  | { found: 'no-such-number'; number: number }
  | { found: 'no-such-id' };

/** Reads `scenes/420` as the standing take at 420, and `scenes/<id>` as that take, struck or not. */
export function sceneFromItemId(scenes: readonly SceneOutline[], itemId: string): SceneOfItemId {
  if (/^\d+$/.test(itemId)) {
    const number = Number(itemId);
    const atNumber = scenes.filter((scene) => scene.number === number);
    const standing = atNumber.filter((scene) => scene.status === 'standing').sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0];
    if (standing !== undefined) return { found: 'take', scene: standing };
    if (atNumber.length > 0) {
      return { found: 'every-take-struck', number, struck: [...atNumber].sort((first, second) => first.createdAt.localeCompare(second.createdAt)) };
    }
    return { found: 'no-such-number', number };
  }
  const scene = scenes.find((candidate) => candidate.id === itemId);
  return scene === undefined ? { found: 'no-such-id' } : { found: 'take', scene };
}

/** The sentence for a scene address that names no take that can be shown. */
export function sceneNotFoundInWords(found: Exclude<SceneOfItemId, { found: 'take' }>): string {
  if (found.found === 'every-take-struck') return `Every take of scene ${found.number} was struck.`;
  if (found.found === 'no-such-number') return `This run has no scene ${found.number}.`;
  return 'This run holds no scene with that id.';
}

/** The browser storage key the last scene read in a run is kept under. */
export function lastReadStorageKey(runSlug: string): string {
  return `timeweft.lastRead.${runSlug}`;
}

/** A scene number typed into "Go to scene": a whole number from 1, or why not. */
export function sceneNumberFromText(text: string): { ok: true; number: number } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'Type a scene number.' };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) return { ok: false, reason: 'A scene number is a whole number, from 1.' };
  return { ok: true, number: Number(trimmed) };
}

/** What the scene list keeps for the tab, in session storage. */
export interface SceneListState extends SceneListFilters {
  /** How many of the newest are drawn. */
  shownCount: number;
  /** The scene numbers whose struck takes the author opened. */
  openStruckNumbers: number[];
  /** The text the store's search of the scenes' text was last asked, and what it found. */
  textSearch: { text: string; matches: SceneSearchMatch[]; total: number; scenesMatched: number } | null;
  /** The scene number last opened from the list, whose row is brought back into view on return. */
  returnToNumber: number | null;
}

export const FRESH_SCENE_LIST_STATE: SceneListState = {
  ...NO_SCENE_LIST_FILTERS,
  shownCount: SCENES_SHOWN_AT_A_TIME,
  openStruckNumbers: [],
  textSearch: null,
  returnToNumber: null,
};

/**
 * The scene list's state read back from session storage. Anything missing or of the wrong shape
 * is taken from a fresh list, so an older or damaged value never breaks the page.
 */
export function sceneListStateFromStored(value: unknown): SceneListState {
  if (typeof value !== 'object' || value === null) return FRESH_SCENE_LIST_STATE;
  const stored = value as Record<string, unknown>;
  const isStringList = (list: unknown): list is string[] => Array.isArray(list) && list.every((item) => typeof item === 'string');
  const isNumberList = (list: unknown): list is number[] => Array.isArray(list) && list.every((item) => Number.isInteger(item));
  const textSearch = stored.textSearch;
  const textSearchIsWellFormed = typeof textSearch === 'object' && textSearch !== null
    && typeof (textSearch as Record<string, unknown>).text === 'string'
    && Array.isArray((textSearch as Record<string, unknown>).matches)
    && typeof (textSearch as Record<string, unknown>).total === 'number'
    && typeof (textSearch as Record<string, unknown>).scenesMatched === 'number';
  return {
    searchText: typeof stored.searchText === 'string' ? stored.searchText : '',
    starredOnly: stored.starredOnly === true,
    withStruckTakesOnly: stored.withStruckTakesOnly === true,
    withEntryIds: isStringList(stored.withEntryIds) ? stored.withEntryIds : [],
    shownCount: typeof stored.shownCount === 'number' && stored.shownCount >= SCENES_SHOWN_AT_A_TIME ? Math.floor(stored.shownCount) : SCENES_SHOWN_AT_A_TIME,
    openStruckNumbers: isNumberList(stored.openStruckNumbers) ? stored.openStruckNumbers : [],
    textSearch: textSearchIsWellFormed ? (textSearch as SceneListState['textSearch']) : null,
    returnToNumber: typeof stored.returnToNumber === 'number' && Number.isInteger(stored.returnToNumber) ? stored.returnToNumber : null,
  };
}

/** The store's text-search finds, by take, where they are for the words now searched. */
export function textSearchFindsFor(state: Pick<SceneListState, 'searchText' | 'textSearch'>): Map<Id, SceneSearchMatch> {
  if (!textSearchAppliesTo(state)) return new Map();
  return new Map((state.textSearch?.matches ?? []).map((match) => [match.sceneId, match]));
}

/** Whether the store's search of the scenes' text was asked the words now in the search box. */
export function textSearchAppliesTo(state: Pick<SceneListState, 'searchText' | 'textSearch'>): boolean {
  return state.textSearch !== null && normaliseForMatching(state.textSearch.text) === normaliseForMatching(state.searchText);
}

/** An excerpt cut into the words before the match, the match and the words after, for drawing. */
export function excerptAroundMatch(match: Pick<SceneSearchMatch, 'excerpt' | 'matchStart' | 'matchLength'>): { before: string; matched: string; after: string } {
  const start = Math.max(0, Math.min(match.excerpt.length, match.matchStart));
  const end = Math.max(start, Math.min(match.excerpt.length, start + match.matchLength));
  return { before: match.excerpt.slice(0, start), matched: match.excerpt.slice(start, end), after: match.excerpt.slice(end) };
}

const SEARCHED_FIELD_IN_WORDS: Record<SearchedSceneField, string> = {
  title: 'the title',
  summary: 'the summary',
  record: 'the scene',
  steer: 'the steer',
  situationAfter: 'where things stood after it',
};

/** Where in a scene the store's search found the words, read after "In": "In the steer". */
export function searchedFieldInWords(field: SearchedSceneField): string {
  return SEARCHED_FIELD_IN_WORDS[field];
}

/**
 * What the count line adds once the store has searched the scenes' text for the words typed. The
 * store answers one match per take, so a scene redone can be found twice; the sentence counts
 * scenes, by number, and so does its note on the limit.
 */
export function textSearchInWords(textSearch: { matches: readonly SceneSearchMatch[]; total: number; scenesMatched: number }): string {
  const scenesFound = textSearch.scenesMatched;
  const found = scenesFound === 0
    ? 'The scenes’ text was searched too; no scene holds the words.'
    : `The scenes’ text was searched too: ${scenesFound === 1 ? '1 scene holds' : `${scenesFound} scenes hold`} the words.`;
  if (textSearch.total <= textSearch.matches.length) return found;
  const scenesListed = new Set(textSearch.matches.map((match) => match.number)).size;
  return `${found} Only the newest ${scenesListed === 1 ? '1 of them is' : `${scenesListed} of them are`} counted here.`;
}

/**
 * Which version of a take's record the page holds: the id of the newest change the author made to
 * that take's record, or the empty string where it was never changed. The record is fetched one
 * take at a time and kept for the visit, so it is kept under this as well as the take's id: an edit
 * to the record changes it, and the text is then fetched again.
 */
export function recordVersionOf(sceneId: Id, sceneEdits: readonly Pick<SceneEditOutline, 'id' | 'sceneId' | 'field'>[]): string {
  let newest = '';
  for (const edit of sceneEdits) if (edit.sceneId === sceneId && edit.field === 'record') newest = edit.id;
  return newest;
}

// ---------------------------------------------------------------------------------------------
// Picking entries by id

/** One entry the picker offers. */
export interface EntryPickerOption {
  entryId: Id;
  name: string;
  /** The other name typed text matched, where it matched that rather than the name. */
  matchedOtherName: string | null;
  /** What it is and when it was first named, which tells two of one name apart. */
  toldApart: string;
  isAuthorOnly: boolean;
}

/** What the picker offers for typed text. */
export interface EntryPickerOffer {
  options: EntryPickerOption[];
  /** How many entries match, offered or not. */
  matchingCount: number;
  /** How many more match than are offered; typing more narrows them. */
  moreNotOffered: number;
  /** How many author-only entries the picker leaves out, where it leaves them out. */
  authorOnlyLeftOut: number;
}

/** How many options the picker lists at once. */
export const ENTRY_PICKER_OPTIONS_AT_A_TIME = 30;

/**
 * The entries to offer for typed text, chosen by id: those whose name or other names hold the
 * text, case- and accent-blind, the names that begin with it first. Already picked ones are not
 * offered again. Two entries of one name are two options, each saying what it is and when it was
 * first named.
 */
export function entryPickerOptions(
  entries: readonly EntryRecord[],
  typedText: string,
  sceneNumbers: Map<Id, number>,
  settings: { pickedIds?: readonly Id[]; leaveOutAuthorOnly?: boolean; limit?: number } = {},
): EntryPickerOffer {
  const typed = normaliseForMatching(typedText);
  const picked = new Set(settings.pickedIds ?? []);
  const limit = settings.limit ?? ENTRY_PICKER_OPTIONS_AT_A_TIME;
  const authorOnlyLeftOut = settings.leaveOutAuthorOnly === true ? entries.filter((entry) => entry.visibility === 'author-only').length : 0;
  const offered = settings.leaveOutAuthorOnly === true ? entries.filter((entry) => entry.visibility !== 'author-only') : entries;
  const ranked: Array<{ option: EntryPickerOption; rank: number; firstNamedAt: number; createdAt: string }> = [];
  for (const entry of offered) {
    if (picked.has(entry.id)) continue;
    const name = normaliseForMatching(entry.name);
    let rank: number | null = null;
    let matchedOtherName: string | null = null;
    if (typed === '' || name.startsWith(typed)) rank = 0;
    else if (name.includes(typed)) rank = 1;
    else {
      const other = entry.alsoKnownAs.find((otherName) => normaliseForMatching(otherName).includes(typed));
      if (other !== undefined) {
        rank = 2;
        matchedOtherName = other;
      }
    }
    if (rank === null) continue;
    const firstNamedAt = entry.introducedInSceneId === null ? 0 : sceneNumbers.get(entry.introducedInSceneId) ?? 0;
    ranked.push({
      rank,
      firstNamedAt,
      createdAt: entry.createdAt,
      option: { entryId: entry.id, name: entry.name, matchedOtherName, toldApart: entryToldApartInWords(entry, sceneNumbers), isAuthorOnly: entry.visibility === 'author-only' },
    });
  }
  // Two of one name: the one named first comes first.
  ranked.sort((first, second) => first.rank - second.rank || first.option.name.localeCompare(second.option.name)
    || first.firstNamedAt - second.firstNamedAt || first.createdAt.localeCompare(second.createdAt));
  return {
    options: ranked.slice(0, limit).map((each) => each.option),
    matchingCount: ranked.length,
    moreNotOffered: Math.max(0, ranked.length - limit),
    authorOnlyLeftOut,
  };
}

/** What the picker's status line says to a screen reader as text is typed. */
export function entryPickerCountInWords(offer: EntryPickerOffer): string {
  if (offer.matchingCount === 0) return 'No entry matches.';
  const matching = offer.matchingCount === 1 ? '1 entry matches.' : `${offer.matchingCount} entries match.`;
  const more = offer.moreNotOffered === 0 ? '' : ` The first ${offer.options.length} are listed; type more to narrow them.`;
  return `${matching}${more}`;
}

/** Scene ids to their numbers, so a fact can say which scene it held from. */
export function sceneNumbersById(scenes: SceneOutline[]): Map<Id, number> {
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

export function whatASceneEstablished(sceneId: Id, snapshot: RunOutline): SceneEstablished {
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
export function factsOfEntryByProperty(entryId: Id, snapshot: RunOutline): PropertyOfEntry[] {
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
export function trailOfEntry(entryId: Id, snapshot: RunOutline): Array<{ note: EntryNoteRecord; sceneNumber: number | null }> {
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

/** What the notice says after a waypoint moved, naming it and where it went. */
export function waypointMoveInWords(move: WaypointMove): string {
  if (move.kind === 'reached') return `Marked \u201c${move.text.trim()}\u201d reached at scene ${move.sceneNumber}. It is under Waypoints reached.`;
  return `${quotedSentence('Withdrew ', move.text)} It is kept among the waypoints withdrawn, with what it said.`;
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

export function threadsOpenFirst(threads: ThreadRecord[], scenes: SceneOutline[]): { open: ThreadAsDrawn[]; closed: ThreadAsDrawn[] } {
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
export function waypointsAheadFirst(snapshot: RunOutline): { ahead: WaypointAsDrawn[]; reached: WaypointAsDrawn[]; withdrawn: WaypointAsDrawn[] } {
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
  /** The day and time of day the words were changed, in words. */
  writtenAt: string;
}

/**
 * Every wording a waypoint had before its present one, oldest first. Each rewording keeps the
 * words it replaced, so the list is those, in the order they were replaced.
 */
export function earlierWordingsOfWaypoint(waypointId: Id, snapshot: RunOutline): EarlierWording[] {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return snapshot.waypointRewordings
    .filter((rewording) => rewording.waypointId === waypointId)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((rewording) => ({
      text: rewording.earlierText,
      changedAfterSceneNumber: rewording.afterSceneId === null ? null : sceneNumbers.get(rewording.afterSceneId) ?? null,
      writtenAt: writtenAtInWords(rewording.createdAt),
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
export function journeysInSceneOrder(snapshot: RunOutline): { travelled: JourneyAsDrawn[]; inStruckTakes: JourneyAsDrawn[] } {
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
export function collisionsWithBothSides(snapshot: RunOutline): { waiting: CollisionAsDrawn[]; settled: CollisionAsDrawn[] } {
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

export const RUN_SECTIONS = ['scenes', 'entries', 'rulings', 'threads', 'journeys', 'collisions', 'briefing', 'run'] as const;
export type RunSection = (typeof RUN_SECTIONS)[number];

/** Each section's name, as its tab and its heading say it. */
export const SECTION_TITLES: Record<RunSection, string> = {
  scenes: 'Scenes',
  entries: 'People, places and things',
  rulings: 'Rulings',
  threads: 'Threads',
  journeys: 'Waypoints and journeys',
  collisions: 'Collisions',
  briefing: 'The briefing',
  run: 'About this run',
};

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

/**
 * What the browser tab says for a route: the item open, then the section, then the run, most
 * particular first so a row of tabs still tells them apart. `snapshot` is null while the run is
 * being read, and then the run's handle stands in for its title.
 */
export function titleOfRoute(route: Route, snapshot: RunOutline | null): string {
  if (route.page === 'runs') return 'All runs · Timeweft';
  const runTitle = snapshot === null ? route.slug : snapshot.run.title;
  const sectionAndRun = `${SECTION_TITLES[route.section]} · ${runTitle}`;
  if (route.itemId === null || snapshot === null) return sectionAndRun;
  const itemWords = itemOfRouteInWords(route.section, route.itemId, snapshot);
  return itemWords === null ? sectionAndRun : `${itemWords} · ${sectionAndRun}`;
}

const LONGEST_ITEM_WORDS_IN_A_TITLE = 60;

function itemOfRouteInWords(section: RunSection, itemId: string, snapshot: RunOutline): string | null {
  switch (section) {
    case 'scenes': {
      // A scene may be named by its number (the standing take) or by its id (any take).
      const scene = /^\d+$/.test(itemId)
        ? snapshot.scenes.find((candidate) => candidate.number === Number(itemId) && candidate.status === 'standing')
        : snapshot.scenes.find((candidate) => candidate.id === itemId);
      if (scene === undefined) return null;
      const struckWords = scene.status === 'struck' ? ' (struck take)' : '';
      return `${scene.number}. ${scene.title}${struckWords}`;
    }
    case 'entries': {
      const entry = snapshot.entries.find((candidate) => candidate.id === itemId);
      return entry === undefined ? null : entry.name;
    }
    case 'rulings': {
      const ruling = snapshot.rulings.find((candidate) => candidate.id === itemId);
      return ruling === undefined ? null : `Ruling ${ruling.number}`;
    }
    case 'threads': {
      const thread = snapshot.threads.find((candidate) => candidate.id === itemId);
      return thread === undefined ? null : shortenedForATitle(thread.text);
    }
    default:
      return null;
  }
}

function shortenedForATitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= LONGEST_ITEM_WORDS_IN_A_TITLE) return oneLine;
  const cut = oneLine.slice(0, LONGEST_ITEM_WORDS_IN_A_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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
  // A whole figure is said whole ("200 MB"), and anything else to one place ("16.3 MB").
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
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
// Backing up a run and restoring one

/**
 * The largest body the server takes for `restore_run`: the figure of
 * `LARGEST_BODY_BYTES_BY_OPERATION.restore_run` in apps/server/src/http-server.ts, which the
 * contract does not hold. A backup is sent whole, so this is also the largest backup the page can
 * restore.
 */
export const LARGEST_RESTORE_BODY_BYTES = 200 * 1024 * 1024;

/**
 * What the download button saves: the file name the server's own backups use, made from the run's
 * slug and the moment the backup was taken, and the document written by the contract's one way of
 * writing a backup out, so a file saved here and one saved by `pnpm export-run` are the same, byte
 * for byte.
 */
export function backupDownloadOf(document: RunExportDocument, takenAt: Date): { fileName: string; text: string } {
  return { fileName: backupFileName(document.runSlug, takenAt), text: runExportDocumentAsText(document) };
}

/**
 * The largest backup file the page reads at all: twice what the server takes. A backup file is
 * written with two spaces of indentation, and is sent without it, which takes off a fifth to a
 * third of its size; no backup file shrinks to half. So a file under this may still fit once it
 * is measured as it would be sent, which `restoreToSend` does, and a file over it never can.
 */
export const LARGEST_BACKUP_FILE_BYTES_READ = 2 * LARGEST_RESTORE_BODY_BYTES;

/** The sentence under the download button, saying what the file holds. */
export const BACKUP_DOWNLOAD_HINT =
  'Saves everything this run holds, author-only material included, as one file. Keep it somewhere private: it holds what a story must never see. Restore it from the list of runs.';

/** The label of the box that replaces the run already in the store. */
export const REPLACE_ON_RESTORE_LABEL = 'Replace the run already here';

/** What ticking the box does, said beside it. */
export const REPLACE_ON_RESTORE_SENTENCE =
  "Removes the run with this backup's name or id, and everything it holds, and puts the backup in its place. If the restore is refused or fails, that run is left as it was.";

/** The restore button's text: plain, or saying it replaces the run already here. */
export function restoreButtonText(running: boolean, replacing: boolean): string {
  if (running) return replacing ? 'Replacing…' : 'Restoring…';
  return replacing ? 'Restore, replacing the run already here' : 'Restore';
}

/**
 * Why the picked backup file cannot be restored, asked before it is read, or null where it may be.
 * Only a file too large to fit even without its spacing is turned away here; a smaller one is
 * read and measured as it would be sent.
 */
export function whyBackupFileCannotStart(file: { name: string; size: number } | null): string | null {
  if (file === null) return 'Pick a backup file.';
  if (file.size === 0) return `The file ${file.name} is empty, so it is not a backup of a run.`;
  if (file.size > LARGEST_BACKUP_FILE_BYTES_READ) {
    return `The file comes to ${megabytesInWords(file.size)}. Sent without its spacing it would still be over ${megabytesInWords(LARGEST_RESTORE_BODY_BYTES)}, which is the most a restore takes.`;
  }
  return null;
}

/**
 * The `restore_run` input from the text of a backup file, or why it cannot be sent. The outside of
 * the document is checked here with the contract's own reader, so a file of another kind or an
 * unread version is refused in the same words the server would use, without sending it. The rows
 * are the store's to check. The body is measured as it will travel and held to the server's limit.
 */
export function restoreToSend(
  fileText: string,
  replace: boolean,
): { ok: true; input: RequestOf<'restore_run'>; runSlug: string } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { ok: false, reason: 'This file is not a Timeweft backup of a run: it is not readable as JSON. The file may have been cut short or edited. Nothing was sent.' };
  }
  let document: RunExportDocument;
  try {
    document = readRunExportDocument(parsed);
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: `${error.message} Nothing was sent.` };
    throw error;
  }
  const input: RequestOf<'restore_run'> = { document: document as unknown as RequestOf<'restore_run'>['document'], replace };
  const bodyBytes = bodyBytesOf(input);
  if (bodyBytes > LARGEST_RESTORE_BODY_BYTES) {
    return {
      ok: false,
      reason: `The backup comes to ${megabytesInWords(bodyBytes)} as it would be sent, and the server takes at most ${megabytesInWords(LARGEST_RESTORE_BODY_BYTES)}. Nothing was sent.`,
    };
  }
  return { ok: true, input, runSlug: document.runSlug };
}

/** Every count of rows, in words, in the order a restore writes them. Counts only, never content. */
export function runRowCountsInWords(counts: RunExportRowCounts): Array<{ label: string; count: number }> {
  return RUN_EXPORT_TABLE_NAMES.map((table) => ({ label: RUN_EXPORT_TABLE_IN_WORDS[table], count: counts[table] }));
}

/** The sentence saying what a restore did, naming the run replaced where there was one. */
export function restoredInWords(report: RestoredRunReport): string {
  if (report.replaced === null) return `Restored ${report.run.title} (${report.run.slug}).`;
  const replaced = report.replaced.run;
  return `Restored ${report.run.title} (${report.run.slug}), in place of ${replaced.title} (${replaced.slug}), which was removed with everything it held.`;
}

// ---------------------------------------------------------------------------------------------
// The author's hand: what the forms on a run's page send, and the history they leave

/**
 * The newest standing scene of the run, which is the scene every act the author makes outside a
 * scene is dated to (docs/decisions/0003). Null where the run has no standing scene yet.
 */
export function newestStandingScene(snapshot: RunOutline): SceneOutline | null {
  let newest: SceneOutline | null = null;
  for (const scene of snapshot.scenes) {
    if (scene.status !== 'standing') continue;
    if (newest === null || scene.number > newest.number) newest = scene;
  }
  return newest;
}

/** When an act made now takes effect, in words: "as of scene 3", or "before the scenes". */
export function asOfNowInWords(snapshot: RunOutline): string {
  const newest = newestStandingScene(snapshot);
  return newest === null ? 'before the scenes' : `as of scene ${newest.number}`;
}

/**
 * Why an act that has to stop at a scene cannot be made yet, or null where it can. Ending a fact,
 * withdrawing, closing and touching all stop at the newest standing scene, so they wait for one.
 */
export function whyAnActNeedsAScene(snapshot: RunOutline): string | null {
  return newestStandingScene(snapshot) === null
    ? 'The run has no scene yet, so there is nothing for this to stop at. It can be done once a scene is saved.'
    : null;
}

/** The numbers of the standing scenes, lowest first: the scenes a waypoint can be marked reached at. */
export function standingSceneNumbers(snapshot: RunOutline): number[] {
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

export function runDetailsFormOf(run: RunOutline['run']): RunDetailsForm {
  return { title: run.title, setting: run.setting, register: run.register, status: run.status };
}

/**
 * The `edit_run` input for what the form changed, and only that, or why nothing is sent. A title
 * is trimmed and may not be empty; the setting and the register are kept as typed, since line
 * breaks in them are the author's.
 */
export function runEditToSend(runSlug: string, run: RunOutline['run'], form: RunDetailsForm): ToSend<RequestOf<'edit_run'>> {
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
  /** The day and time of day it was written, in words; empty where the record carries none. */
  writtenAt: string;
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
export function runHistoryInWords(snapshot: RunOutline): EarlierValue[] {
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
        writtenAt: writtenAtInWords(edit.createdAt),
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
export function entryHistoryInWords(entryId: Id, snapshot: RunOutline): EarlierValue[] {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return snapshot.entryEdits
    .filter((edit) => edit.entryId === entryId)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
    .map((edit) => ({
      label: ENTRY_FIELD_LABELS[edit.field],
      earlier: entryEditValueInWords(edit.field, edit.earlierValue),
      later: entryEditValueInWords(edit.field, edit.laterValue),
      changedAfterSceneNumber: edit.afterSceneId === null ? null : sceneNumbers.get(edit.afterSceneId) ?? null,
      writtenAt: writtenAtInWords(edit.createdAt),
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
export function propertiesOfEntry(entryId: Id, snapshot: RunOutline): string[] {
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

export function entriesARulingMayName(snapshot: RunOutline): EntryARulingMayName[] {
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
export function rulingToSend(runSlug: string, form: RulingForm, snapshot: RunOutline): ToSend<RequestOf<'record_ruling'>> {
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
export function lastingActInWords(act: 'end-fact' | 'withdraw-ruling' | 'withdraw-waypoint' | 'close-thread' | 'turn-author-only' | 'turn-open', snapshot: RunOutline): string {
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

// ---------------------------------------------------------------------------------------------
// After an act: the one notice at the foot of the page, and a refusal beside its form

/** A link a notice holds, to where the item the act touched now is. */
export interface NoticeLink {
  href: string;
  words: string;
}

/** What the page says after an act the server took. */
export interface Notice {
  words: string;
  /** What the author should know besides, already in words. */
  cautions: string[];
  link: NoticeLink | null;
}

/** The notice on screen, numbered so a timer set for one never takes down the next. */
export type NoticeState = { notice: Notice; number: number; focusWhenShown: boolean } | null;

export type NoticeEvent =
  | { kind: 'act-done'; notice: Notice; focusWhenShown: boolean }
  | { kind: 'act-started' }
  | { kind: 'route-changed' }
  | { kind: 'time-passed'; number: number }
  | { kind: 'focus-moved' }
  | { kind: 'dismissed' };

/** How long a plain notice stays, unless it is hovered or holds focus. */
export const NOTICE_PLAIN_STAYS_MILLISECONDS = 6000;

/**
 * A notice holding a link, or something the author should know besides, stays until it is
 * dismissed or replaced. A plain one goes by itself.
 */
export function noticeStaysUntilDismissed(notice: Notice): boolean {
  return notice.link !== null || notice.cautions.length > 0;
}

/**
 * The notice after something happened. A new notice replaces the one before; a plain one goes at
 * the next act, on a route change, or when its time has passed; any goes when dismissed.
 */
export function noticeAfter(state: NoticeState, event: NoticeEvent): NoticeState {
  switch (event.kind) {
    case 'act-done':
      return { notice: event.notice, number: (state?.number ?? 0) + 1, focusWhenShown: event.focusWhenShown };
    case 'act-started':
    case 'route-changed':
      return state === null || noticeStaysUntilDismissed(state.notice) ? state : null;
    case 'time-passed':
      return state !== null && state.number === event.number && !noticeStaysUntilDismissed(state.notice) ? null : state;
    case 'focus-moved':
      return state === null || !state.focusWhenShown ? state : { ...state, focusWhenShown: false };
    case 'dismissed':
      return null;
  }
}

/** What a form says beside itself: nothing, that it is saving, or why the server said no. */
export type ActState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'refused'; message: string };

export type ActEvent =
  | { kind: 'started' }
  | { kind: 'taken' }
  | { kind: 'refused'; message: string }
  | { kind: 'not-sent' }
  | { kind: 'edited' };

/**
 * A form's state after something happened to it. A success is said in the notice, not here; a
 * refusal stays beside the form until the form is edited, since it answers what was typed.
 */
export function actStateAfter(state: ActState, event: ActEvent): ActState {
  switch (event.kind) {
    case 'started':
      return { state: 'running' };
    case 'taken':
    case 'not-sent':
      return { state: 'idle' };
    case 'refused':
      return { state: 'refused', message: event.message };
    case 'edited':
      return state.state === 'refused' ? { state: 'idle' } : state;
  }
}

/** Text that ends in its own full stop, question or exclamation mark wants no other after it. */
function endsInPunctuation(text: string): boolean {
  return /[.?!…]$/.test(text.trim());
}

/**
 * A sentence ending in a quotation: the words before, the quoted text in curly marks, and the
 * mark that ends the sentence, left out where the quoted text already ends in one. So it reads
 * "Closed “Will the ferry run?”", never "“Will the ferry run?”.".
 */
export function quotedSentence(before: string, quoted: string, endMark: '.' | '?' | '!' = '.'): string {
  const trimmed = quoted.trim();
  return `${before}“${trimmed}”${endsInPunctuation(trimmed) ? '' : endMark}`;
}

const KIND_IN_WORDS: Record<EntryKind, string> = {
  person: 'a person',
  group: 'a group',
  place: 'a place',
  item: 'a thing',
  other: 'an entry',
};

/**
 * An entry told apart from others of its name without its id: what it is and when it was first
 * named. "a person, first named at scene 12"; "a place, named before the scenes".
 */
export function entryToldApartInWords(entry: EntryRecord, sceneNumbers: Map<Id, number>): string {
  const sceneNumber = entry.introducedInSceneId === null ? null : sceneNumbers.get(entry.introducedInSceneId) ?? null;
  const when = sceneNumber === null ? 'named before the scenes' : `first named at scene ${sceneNumber}`;
  return `${KIND_IN_WORDS[entry.kind]}, ${when}`;
}

/**
 * A caution from the store in words the author reads. The store tells entries apart by id
 * ("\"Odo\" (id 3f…)"); the page says what each is and when it was first named instead, since an
 * id means nothing to the author. Straight quotation marks become curly ones.
 */
export function cautionInWords(caution: string, snapshot: RunOutline): string {
  const entriesById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  return caution
    .replace(/"([^"]*)" \(id ([^)\s]+)\)/g, (_whole, name: string, id: string) => {
      const entry = entriesById.get(id);
      return entry === undefined ? `“${name}” (another entry)` : `“${name}” (${entryToldApartInWords(entry, sceneNumbers)})`;
    })
    .replace(/"([^"]*)"/g, '“$1”');
}

const MONTHS_IN_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When something was written, as a day and a time of day: "14 Nov 11:20". Read in the browser's
 * own time zone unless one is named (the tests name one so they do not depend on the machine).
 */
export function writtenAtInWords(createdAt: string, timeZone?: string): string {
  const moment = new Date(createdAt);
  if (Number.isNaN(moment.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(moment);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  const monthName = MONTHS_IN_WORDS[Number(part('month')) - 1] ?? part('month');
  return `${Number(part('day'))} ${monthName} ${part('hour')}:${part('minute')}`;
}

/** Where and when a change was made: "after scene 45, 14 Nov 11:20". */
export function changedWhenAndAtInWords(changedAfterSceneNumber: number | null, writtenAt: string): string {
  const where = changedWhenInWords(changedAfterSceneNumber);
  return writtenAt === '' ? where : `${where}, ${writtenAt}`;
}

/**
 * The question settling a collision asks, naming both values: "Keep “sixty” and drop the story's
 * “about forty”?" or the other way round.
 */
export function settleCollisionQuestion(item: CollisionAsDrawn, take: 'author' | 'story'): string {
  const authors = item.authorsValue ?? 'the fact the store no longer holds';
  const authorsQuoted = item.authorsValue === null ? authors : `“${authors.trim()}”`;
  if (take === 'author') return quotedSentence(`Keep ${authorsQuoted} and drop the story's `, item.storysValue, '?');
  return item.authorsValue === null
    ? quotedSentence(`Drop ${authors} and take the story's `, item.storysValue, '?')
    : quotedSentence(`Take the story's “${item.storysValue.trim()}” and drop `, authors, '?');
}

/** The question marking a waypoint reached asks, naming the scene. */
export function markReachedQuestion(text: string, sceneNumber: number): string {
  return quotedSentence(`Mark it reached at scene ${sceneNumber}? A story stops steering towards `, text, '.');
}
