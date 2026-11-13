/**
 * The briefing package: pure readers over a run's snapshot, and the briefing built from them.
 * No database, no files, no clock and no chance: the same snapshot always reads the same way.
 */
export { buildBriefing, FACTS_BEFORE_THE_TRAIL, REGISTER_SHARE_OF_BUDGET, TRAIL_NOTES_PER_ENTRY } from './briefing.ts';
export type { BriefingRequest } from './briefing.ts';
export {
  factsHoldingFor, findInRun, lookUpEntry, lookUpEntryById, resolveEntryByName, rulingsBearingOn, sceneInFull, standingScenesOf,
  threadsOpenFor,
} from './readers.ts';
export { CUT_MARKER, MIDDLE_LEFT_OUT_MARKER, byteLengthOf, cutToFit, onOneLine, openingAndEndingOf } from './text-fitting.ts';
export { PEOPLE_BESIDE_THE_MAIN_CHARACTER, mainCharactersOf } from './main-characters.ts';
