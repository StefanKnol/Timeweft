/**
 * Reads the five Markdown files a story run kept by hand into one ImportedRun.
 *
 * Pure: text in, value out. It never throws on odd input. What it cannot place is said in
 * `unplaced`, one sentence per thing, naming the file, the line and the reason, so nothing is
 * dropped in silence.
 */
import type { ImportedEntry, ImportedRun, RunStatus, WeaverFiles } from '@timeweft/contract';
import { nameFinderFor } from './names-in-text.ts';
import { readCast, readItems, readPlaces, factsOfLabelledBullet, type EntriesRead } from './read-entries.ts';
import { readLog } from './read-log.ts';
import { readState, type StateRead } from './read-state.ts';

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
    clocks: [], situation: '', register: '', rulings: [], threads: [], waypoints: [],
    runStateLines: [], stackedHistoryBytes: 0, stackedHistoryLines: [], unplaced: [],
  };
  const state = safely('state.md', () => readState(files.state ?? '', names), emptyState, unplaced);
  const placeNames = places.entries.flatMap((entry) => [entry.name, ...entry.alsoKnownAs]);
  const log = safely('log.md', () => readLog(files.log ?? '', state.clocks, placeNames), { title: '', scenes: [], unplaced: [] }, unplaced);

  fileRunStateUnderEntries(state, entries, unplaced);

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
    rulings: state.rulings,
    threads: state.threads,
    waypoints: state.waypoints,
    legs: places.legs,
    unplaced: [...log.unplaced, ...state.unplaced, ...cast.unplaced, ...items.unplaced, ...places.unplaced, ...unplaced],
  };
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

export type { WeaverFiles, ImportedRun };
