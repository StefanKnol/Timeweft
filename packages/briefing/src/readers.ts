/**
 * The small readers over a run, each the one home of its rule. The briefing is built from them,
 * and the server answers look_up, find, list_rulings, list_threads and read_scene with them.
 *
 * The snapshot has already been filtered for its audience by the store, so nothing here decides
 * what a reader may see. What is decided here is what is current: a fact still open, a scene
 * still standing, a ruling still in force.
 */
import { Refusal } from '@timeweft/contract';
import type {
  EntryLookup, EntryRecord, FactRecord, FoundItem, Id, RulingRecord, RunSnapshot, SceneInFull, SceneRecord,
  ThreadRecord,
} from '@timeweft/contract';
import {
  closedFactsOf, compareText, entryNameOf, holdingFactsOf, indexRun, rulingsInForce, sceneNumberOf,
  servableThreads, threadsLastTouchedFirst, trailNewestFirstOf, wasEstablishedInAStruckScene,
} from './run-index.ts';
import type { RunIndex } from './run-index.ts';
import { onOneLine } from './text-fitting.ts';

/** Standing scenes, oldest first. A struck take is never among them. */
export function standingScenesOf(snapshot: RunSnapshot): SceneRecord[] {
  return indexRun(snapshot).standingScenes;
}

/** What still holds for one entry: facts not yet closed, never one established by a struck scene. */
export function factsHoldingFor(snapshot: RunSnapshot, entryId: Id): FactRecord[] {
  return holdingFactsOf(indexRun(snapshot), entryId);
}

function normalisedName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveEntryInIndex(index: RunIndex, name: string): EntryRecord | null {
  const wanted = normalisedName(name);
  if (wanted.length === 0) return null;
  const answering = index.snapshot.entries
    .filter((entry) => [entry.name, ...entry.alsoKnownAs].some((candidate) => normalisedName(candidate) === wanted))
    .sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
  const [only, second] = answering;
  if (!only) return null;
  if (second) {
    const named = answering.map((entry) => `${entry.name} (${entry.kind})`);
    const list = named.length === 2 ? `${named[0]} and ${named[1]}` : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
    throw new Refusal(`${answering.length} entries answer to "${name.trim()}": ${list}. Name one by a name only it has.`);
  }
  return only;
}

/**
 * The entry a name means, by its name or any other name it goes by, case-blind and trimmed.
 * Null where nothing answers; a refusal naming every one where more than one does, since names are
 * not keys and guessing would put the wrong person on the page.
 */
export function resolveEntryByName(snapshot: RunSnapshot, name: string): EntryRecord | null {
  return resolveEntryInIndex(indexRun(snapshot), name);
}

function threadTouches(thread: ThreadRecord, entryIds: ReadonlySet<Id>): boolean {
  return thread.aboutEntryIds.some((entryId) => entryIds.has(entryId));
}

export function lookUpInIndex(index: RunIndex, name: string, options: { withHistory: boolean; trail: number }): EntryLookup {
  const entry = resolveEntryInIndex(index, name);
  if (!entry) throw new Refusal(`Nothing in this run is called "${name.trim()}". It would be new.`);
  return lookUpOneEntry(index, entry, options);
}

/**
 * What look_up answers for one entry, found by its id rather than by a name, since two entries
 * may share a name. Null where the snapshot holds no entry with that id, which is also the answer
 * for an entry the snapshot's audience may not see.
 */
export function lookUpEntryById(snapshot: RunSnapshot, entryId: Id, options: { withHistory: boolean; trail: number }): EntryLookup | null {
  const index = indexRun(snapshot);
  const entry = index.entryById.get(entryId);
  return entry === undefined ? null : lookUpOneEntry(index, entry, options);
}

function lookUpOneEntry(index: RunIndex, entry: EntryRecord, options: { withHistory: boolean; trail: number }): EntryLookup {
  const trailWanted = Math.max(0, Math.floor(options.trail));
  const wholeTrail = trailNewestFirstOf(index, entry.id);
  const shownTrail = wholeTrail.slice(0, trailWanted);
  const aboutThisEntry = new Set([entry.id]);
  return {
    entry,
    holding: holdingFactsOf(index, entry.id),
    history: options.withHistory ? closedFactsOf(index, entry.id) : [],
    trail: shownTrail.map((note) => ({ note, sceneNumber: sceneNumberOf(index, note.sceneId) ?? 0 })),
    trailLeftOut: wholeTrail.length - shownTrail.length,
    threads: servableThreads(index).filter((thread) => thread.closedInSceneId === null && threadTouches(thread, aboutThisEntry)),
    rulings: rulingsInForce(index).filter((ruling) => ruling.aboutEntryIds.includes(entry.id)),
  };
}

/** Everything a chat needs about one entry now, and, when asked, what was so before. */
export function lookUpEntry(snapshot: RunSnapshot, name: string, options: { withHistory: boolean; trail: number }): EntryLookup {
  return lookUpInIndex(indexRun(snapshot), name, options);
}

/** Room either side of a match when showing the line that holds it. */
const CONTEXT_AROUND_A_MATCH = 80;

/** A short piece of `text` around the first place it holds `needle`, or null where it does not. */
function excerptAround(text: string, needle: string): string | null {
  const flat = onOneLine(text);
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  const start = Math.max(0, at - CONTEXT_AROUND_A_MATCH);
  const end = Math.min(flat.length, at + needle.length + CONTEXT_AROUND_A_MATCH);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

function firstExcerpt(fields: string[], needle: string): string | null {
  for (const field of fields) {
    const excerpt = excerptAround(field, needle);
    if (excerpt !== null) return excerpt;
  }
  return null;
}

/**
 * Searches the run for a word or phrase, case-blind: names, facts, trail notes, standing scenes,
 * journeys, rulings in force and threads, in that order, at most `limit` of them. Nothing from a struck scene.
 */
export function findInRun(snapshot: RunSnapshot, text: string, limit: number): FoundItem[] {
  const needle = onOneLine(text).toLowerCase();
  if (needle.length === 0) throw new Refusal('Give some text to find.');
  const index = indexRun(snapshot);
  const most = Math.max(0, Math.floor(limit));
  const found: FoundItem[] = [];
  const add = (item: FoundItem): boolean => {
    if (found.length >= most) return false;
    found.push(item);
    return found.length < most;
  };
  const entries = [...snapshot.entries].sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
  for (const entry of entries) {
    const excerpt = firstExcerpt([entry.name, ...entry.alsoKnownAs], needle);
    if (excerpt !== null && !add({ kind: 'entry', text: `${entry.name} (${entry.kind}): ${excerpt}`, entryName: entry.name, sceneNumber: null })) return found;
  }
  for (const holdingNow of [true, false]) {
    for (const entry of entries) {
      const facts = holdingNow ? holdingFactsOf(index, entry.id) : closedFactsOf(index, entry.id);
      for (const fact of facts) {
        const excerpt = firstExcerpt([fact.property, fact.value, fact.note], needle);
        if (excerpt === null) continue;
        const status = holdingNow ? 'holds' : `held until scene ${sceneNumberOf(index, fact.untilSceneId) ?? '?'}`;
        const item: FoundItem = {
          kind: 'fact', text: `${entry.name}, ${fact.property} (${status}): ${excerpt}`,
          entryName: entry.name, sceneNumber: sceneNumberOf(index, fact.fromSceneId),
        };
        if (!add(item)) return found;
      }
    }
  }
  for (const entry of entries) {
    for (const note of trailNewestFirstOf(index, entry.id)) {
      const excerpt = excerptAround(note.text, needle);
      if (excerpt === null) continue;
      const sceneNumber = sceneNumberOf(index, note.sceneId);
      if (!add({ kind: 'note', text: `${entry.name}, scene ${sceneNumber ?? '?'}: ${excerpt}`, entryName: entry.name, sceneNumber })) return found;
    }
  }
  for (const scene of [...index.standingScenes].reverse()) {
    const excerpt = firstExcerpt([scene.title, scene.whenTyped, scene.summary, scene.situationAfter, scene.record, scene.steer], needle);
    if (excerpt !== null && !add({ kind: 'scene', text: `Scene ${scene.number}, "${scene.title}": ${excerpt}`, entryName: null, sceneNumber: scene.number })) return found;
  }
  // A journey has no kind of its own in FoundItem, and the contract is not this package's to change,
  // so it is answered as a note, its text saying it is a journey. Without this a journey tied to no
  // scene could be left out of a briefing with nothing anywhere that fetches it.
  const legs = snapshot.legs
    .filter((leg) => !wasEstablishedInAStruckScene(index, leg.sceneId))
    .sort((left, right) => compareText(left.createdAt, right.createdAt));
  for (const leg of legs) {
    if (firstExcerpt([leg.fromPlace, leg.toPlace, leg.duration, leg.note], needle) === null) continue;
    const legNote = leg.note.trim().length > 0 ? ` (${onOneLine(leg.note)})` : '';
    const legText = `Journey: ${onOneLine(leg.fromPlace)} to ${onOneLine(leg.toPlace)}: ${onOneLine(leg.duration)}${legNote}`;
    if (!add({ kind: 'note', text: legText, entryName: null, sceneNumber: sceneNumberOf(index, leg.sceneId) })) return found;
  }
  for (const ruling of rulingsInForce(index)) {
    const excerpt = firstExcerpt([ruling.text, ruling.topics.join(', ')], needle);
    if (excerpt !== null && !add({ kind: 'ruling', text: `Ruling ${ruling.number}: ${excerpt}`, entryName: null, sceneNumber: sceneNumberOf(index, ruling.sceneId) })) return found;
  }
  const threads = servableThreads(index);
  const threadsOpenFirst = [...threads.filter((thread) => thread.closedInSceneId === null), ...threads.filter((thread) => thread.closedInSceneId !== null)];
  for (const thread of threadsOpenFirst) {
    const excerpt = firstExcerpt([thread.text, thread.resolution], needle);
    if (excerpt === null) continue;
    const state = thread.closedInSceneId === null ? 'open' : 'closed';
    if (!add({ kind: 'thread', text: `Thread (${state}): ${excerpt}`, entryName: null, sceneNumber: sceneNumberOf(index, thread.openedInSceneId) })) return found;
  }
  return found;
}

function topicMatches(ruling: RulingRecord, topic: string): boolean {
  const wanted = topic.trim().toLowerCase();
  return ruling.topics.some((candidate) => candidate.trim().toLowerCase() === wanted);
}

/**
 * Rulings in force that bear on a topic or on the given entries, by their number. With neither
 * given, every ruling in force: a chat asking with no filter means everything.
 */
export function rulingsBearingOn(snapshot: RunSnapshot, filter: { topic?: string; aboutEntryIds: Id[] }): RulingRecord[] {
  const inForce = rulingsInForce(indexRun(snapshot));
  const topic = filter.topic?.trim() ?? '';
  if (topic.length === 0 && filter.aboutEntryIds.length === 0) return inForce;
  const about = new Set(filter.aboutEntryIds);
  return inForce.filter((ruling) =>
    (topic.length > 0 && topicMatches(ruling, topic)) || ruling.aboutEntryIds.some((entryId) => about.has(entryId)));
}

/**
 * Threads in the order a briefing ranks them: the one a scene moved last first, by the scene it was
 * last touched in, then the scene it opened in, then the latest written (threadsLastTouchedFirst).
 * Open ones only unless closed are asked for, and then every open one comes before every closed
 * one; only those about the given entries where any are given.
 */
export function threadsOpenFor(snapshot: RunSnapshot, filter: { aboutEntryIds: Id[]; includeClosed: boolean }): ThreadRecord[] {
  const index = indexRun(snapshot);
  const about = new Set(filter.aboutEntryIds);
  const wanted = servableThreads(index).filter((thread) => about.size === 0 || threadTouches(thread, about));
  const open = threadsLastTouchedFirst(index, wanted.filter((thread) => thread.closedInSceneId === null));
  if (!filter.includeClosed) return open;
  return [...open, ...threadsLastTouchedFirst(index, wanted.filter((thread) => thread.closedInSceneId !== null))];
}

/** One standing scene in full, with everything it established. Refuses a number with no standing scene. */
export function sceneInFull(snapshot: RunSnapshot, number: number): SceneInFull {
  const index = indexRun(snapshot);
  const scene = index.standingScenes.find((candidate) => candidate.number === number);
  if (!scene) throw new Refusal(`This run has no standing scene ${number}.`);
  const byEntryName = (left: { entryId: Id; createdAt: string; id: Id }, right: { entryId: Id; createdAt: string; id: Id }): number =>
    compareText(entryNameOf(index, left.entryId) ?? '', entryNameOf(index, right.entryId) ?? '')
    || compareText(left.createdAt, right.createdAt);
  // One save writes everything at one moment, so the moment alone cannot order what a scene wrote.
  // The snapshot lists each kind in the order it was written and a sort keeps equal things in the
  // order it met them, so nothing here breaks a tie on the id: an id is random, and two stores
  // given the same scene would then answer in two orders.
  const byCreation = (left: { createdAt: string }, right: { createdAt: string }): number =>
    compareText(left.createdAt, right.createdAt);
  return {
    scene,
    entriesIntroduced: snapshot.entries.filter((entry) => entry.introducedInSceneId === scene.id).sort(byCreation),
    factsEstablished: snapshot.facts.filter((fact) => fact.fromSceneId === scene.id).sort(byEntryName),
    notes: snapshot.notes.filter((note) => note.sceneId === scene.id).sort(byEntryName),
    // A ruling given here and withdrawn since is no longer told to a story, so the scene leaves it out.
    rulings: snapshot.rulings.filter((ruling) => ruling.sceneId === scene.id && ruling.withdrawnInSceneId === null).sort((left, right) => left.number - right.number || byCreation(left, right)),
    threadsOpened: snapshot.threads.filter((thread) => thread.openedInSceneId === scene.id).sort(byCreation),
    threadsClosed: snapshot.threads.filter((thread) => thread.closedInSceneId === scene.id).sort(byCreation),
    threadsTouched: snapshot.threads.filter((thread) => thread.closedInSceneId !== scene.id
      && thread.touches.some((touch) => touch.sceneId === scene.id)).sort(byCreation),
    legs: snapshot.legs.filter((leg) => leg.sceneId === scene.id).sort(byCreation),
  };
}
