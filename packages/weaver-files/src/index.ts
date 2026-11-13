/**
 * Reads the five Markdown files a story run kept by hand into one ImportedRun.
 *
 * Pure: text in, value out. It never throws on odd input. What it cannot place is said in
 * `unplaced`, one sentence per thing, naming the file, the line and the reason, so nothing is
 * dropped in silence.
 */
import type { ImportedEntry, ImportedRun, RunStatus, WeaverFiles } from '@timeweft/contract';
import { nameFinderFor } from './names-in-text.ts';
import { readCast, readItems, readPlaces, factsOfLabelledBullet, LAST_SEEN_PROPERTY, type EntriesRead } from './read-entries.ts';
import { readLog } from './read-log.ts';
import { readState, type ClockDefinition, type StateRead } from './read-state.ts';
import { escapeForRegularExpression } from './text-helpers.ts';

export interface ReadWeaverFilesOptions {
  slug: string;
  title?: string;
  setting?: string;
  status?: RunStatus;
}

/** A failure inside one file's reader is reported against that file and the rest still read. */
export function safely<Result>(fileName: string, read: () => Result, empty: Result, unplaced: string[]): Result {
  try {
    return read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    unplaced.push(`${fileName}: the reader could not read this file and carried nothing from it (${reason}).`);
    return empty;
  }
}

const NO_ENTRIES: EntriesRead = { entries: [], legs: [], unplaced: [] };

export function readWeaverFiles(files: WeaverFiles, options: ReadWeaverFilesOptions): ImportedRun {
  const unplaced: string[] = [];
  const cast = safely('cast.md', () => readCast(files.cast ?? ''), NO_ENTRIES, unplaced);
  const items = safely('items.md', () => readItems(files.items ?? ''), NO_ENTRIES, unplaced);
  const places = safely('places.md', () => readPlaces(files.places ?? ''), NO_ENTRIES, unplaced);
  const entries: ImportedEntry[] = [...cast.entries, ...items.entries, ...places.entries];
  const allNames = entries.flatMap((entry) => [entry.name, ...entry.alsoKnownAs]);
  const names = nameFinderFor(allNames);

  const emptyState: StateRead = {
    clocks: [], situation: '', clockNoteRulings: [], register: '', rulings: [], threads: [], waypoints: [],
    runStateLines: [], stackedHistoryBytes: 0, stackedHistoryLines: [], unplaced: [],
  };
  const state = safely('state.md', () => readState(files.state ?? '', names), emptyState, unplaced);
  const placeNames = places.entries.flatMap((entry) => [entry.name, ...entry.alsoKnownAs]);
  const log = safely('log.md', () => readLog(files.log ?? '', state.clocks, placeNames), { title: '', scenes: [], unplaced: [] }, unplaced);

  fileRunStateUnderEntries(state, entries, unplaced);
  const clockNoteRulings = clockNotesOnScenesTheLogHas(state.clockNoteRulings, log.scenes, unplaced);
  bringLastSeenUpToTheNewestScene(entries, log.scenes, unplaced);
  dateThreadsByTheClockCountsTheyName(state.threads, state.clocks, log.scenes);
  keepTouchesOnScenesTheLogHas(state.threads, log.scenes);

  const lastScene = log.scenes[log.scenes.length - 1];
  if (state.situation !== '') {
    if (lastScene) lastScene.situationAfter = state.situation;
    else unplaced.push('state.md: the present situation was read but the log has no scene to carry it.');
  }
  if (state.stackedHistoryBytes > 0) {
    unplaced.push(`state.md lines ${state.stackedHistoryLines.join(', ')}: ${state.stackedHistoryBytes} bytes of stacked history after the present ("Before that", "Earlier") were not carried into the situation, since every earlier state is already told by the scenes.`);
  }

  return {
    slug: options.slug,
    title: options.title ?? (log.title !== '' ? log.title : options.slug),
    setting: options.setting ?? '',
    status: options.status ?? 'binding',
    register: state.register,
    clocks: state.clocks.map((clock) => ({ name: clock.name, countsFrom: clock.countsFrom })),
    scenes: log.scenes,
    entries,
    rulings: [...state.rulings, ...clockNoteRulings],
    threads: state.threads,
    waypoints: state.waypoints,
    legs: places.legs,
    unplaced: [...log.unplaced, ...state.unplaced, ...cast.unplaced, ...items.unplaced, ...places.unplaced, ...unplaced],
  };
}

/**
 * The author's notes from the Clock section, after the standing rulings so their numbering holds.
 * Each keeps the scene it names where the log has that scene; where it does not, the note is kept
 * with no scene and that is said once.
 */
function clockNotesOnScenesTheLogHas(rulings: ImportedRun['rulings'], scenes: ImportedRun['scenes'], unplaced: string[]): ImportedRun['rulings'] {
  const sceneNumbers = new Set(scenes.map((scene) => scene.number));
  return rulings.map((ruling) => {
    if (ruling.scene === null || sceneNumbers.has(ruling.scene)) return ruling;
    unplaced.push(`state.md: a note by the author in the Clock section names scene ${ruling.scene}, which the log does not have, so it was kept as a ruling with no scene.`);
    return { ...ruling, scene: null };
  });
}

/**
 * A run-specific state line ("- Name: how they stand in this run") is a fact about the entry it
 * names, under the property "run state", its stacked history split as any fact's is. Where no
 * entry has that name and the label reads as a name (one to three capitalised words), a person
 * entry is made for it; anything else is unplaced.
 */
function fileRunStateUnderEntries(state: StateRead, entries: ImportedEntry[], unplaced: string[]): void {
  for (const line of state.runStateLines) {
    const wanted = line.label.toLowerCase();
    let entry = entries.find((candidate) => candidate.name.toLowerCase() === wanted
      || candidate.alsoKnownAs.some((alias) => alias.toLowerCase() === wanted));
    if (!entry) {
      if (!/^\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2}$/u.test(line.label)) {
        unplaced.push(`state.md line ${line.lineNumber}: a run-specific state line whose label names no entry and does not read as a name.`);
        continue;
      }
      entry = {
        name: line.label, kind: 'person', alsoKnownAs: [], pronoun: '', introducedInScene: null,
        visibility: 'open', facts: [], trail: [],
      };
      entries.push(entry);
    }
    entry.facts.push(...factsOfLabelledBullet('run state', line.text));
  }
}

/**
 * "Last seen" never holds an older scene than the files know of. Where an entry carries a "last
 * seen" fact and a newer scene names it (a trail note of its own, or, for a place, a scene set
 * there) than any "last seen" fact says, a fact of that newest scene is added, "Scene N, <the
 * scene's place>", and the older hand-written value is closed history. Nothing is invented: the
 * scene and its place are the log's. An entry with no "last seen" fact gains none.
 */
function bringLastSeenUpToTheNewestScene(entries: ImportedEntry[], scenes: ImportedRun['scenes'], unplaced: string[]): void {
  const placeOfScene = new Map(scenes.map((scene) => [scene.number, scene.place]));
  let broughtUp = 0;
  for (const entry of entries) {
    const lastSeenFacts = entry.facts.filter((fact) => fact.property === LAST_SEEN_PROPERTY);
    if (lastSeenFacts.length === 0) continue;
    const namesOfEntry = [entry.name, ...entry.alsoKnownAs].map((name) => name.toLowerCase());
    const seenInScenes = [
      ...entry.trail.map((note) => note.scene),
      ...(entry.kind === 'place'
        ? scenes.filter((scene) => scene.place !== null && namesOfEntry.includes(scene.place.toLowerCase())).map((scene) => scene.number)
        : []),
    ].filter((number) => placeOfScene.has(number));
    if (seenInScenes.length === 0) continue;
    const newestSeen = Math.max(...seenInScenes);
    const newestSaid = Math.max(...lastSeenFacts.map((fact) => fact.fromScene ?? Number.NEGATIVE_INFINITY));
    if (newestSaid >= newestSeen) continue;
    const place = placeOfScene.get(newestSeen) ?? null;
    entry.facts.push({
      property: LAST_SEEN_PROPERTY,
      value: place === null || entry.kind === 'place' ? `Scene ${newestSeen}` : `Scene ${newestSeen}, ${place}`,
      fromScene: newestSeen,
      source: 'story',
      note: `From the newest scene that names it (scene ${newestSeen}); the hand-kept line was older.`,
    });
    broughtUp += 1;
  }
  if (broughtUp > 0) {
    unplaced.push(`cast.md, items.md, places.md: ${broughtUp} ${broughtUp === 1 ? 'entry\'s' : 'entries\''} "last seen" line was older than the newest scene naming ${broughtUp === 1 ? 'it' : 'them'}, so a "last seen" of that scene was added and the hand-kept line kept as closed history.`);
  }
}

/**
 * A thread's touches are kept only on scenes the log has, and after the scene it opened in, which
 * a clock count may have dated since its text was read. A scene the log lacks is a scene named in
 * passing, not one the run can point at, so it is left out rather than refusing the import.
 */
function keepTouchesOnScenesTheLogHas(threads: ImportedRun['threads'], scenes: ImportedRun['scenes']): void {
  const sceneNumbers = new Set(scenes.map((scene) => scene.number));
  for (const thread of threads) {
    thread.touchedInScenes = (thread.touchedInScenes ?? []).filter((number) =>
      sceneNumbers.has(number) && (thread.openedInScene === null || number > thread.openedInScene));
  }
}

/**
 * A thread that names no scene may still say when it opened by a clock count ("on day +3", "Mill
 * Day 4"). It is dated to the first scene whose reading of that clock is that count, the earliest
 * where it names several. A count no scene reads leaves it undated.
 */
function dateThreadsByTheClockCountsTheyName(threads: ImportedRun['threads'], clocks: ClockDefinition[], scenes: ImportedRun['scenes']): void {
  for (const thread of threads) {
    if (thread.openedInScene !== null) continue;
    const candidates: number[] = [];
    for (const clock of clocks) {
      const pattern = clock.form === 'named'
        ? (clock.prefixWords.length === 0 ? null : new RegExp(`\\b${clock.prefixWords.map(escapeForRegularExpression).join('\\s+')}\\s+Day\\s+(\\d+)(?!\\d|\\.\\d)`, 'gi'))
        : /\bday\s*\+\s*(\d+)(?!\d|\.\d)/gi;
      if (pattern === null) continue;
      for (const match of thread.text.matchAll(pattern)) {
        const count = String(Number(match[1]));
        const scene = scenes.find((candidate) => candidate.readings.some((reading) => reading.clock === clock.name && String(Number(reading.count)) === count));
        if (scene) candidates.push(scene.number);
      }
    }
    if (candidates.length > 0) thread.openedInScene = Math.min(...candidates);
  }
}

export type { WeaverFiles, ImportedRun };
