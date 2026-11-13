/**
 * The briefing: the present of a run, sized to fit a chat.
 *
 * A story kept by hand grew a file a fresh chat had to read first that ran to half a megabyte,
 * because every field kept its whole history in place. A resume must be a page. So the briefing
 * serves only what holds now, in a fixed order of what matters most, and never more bytes than it
 * was asked for. What it leaves out it says, with the operation that fetches it.
 *
 * How the room is shared: each section is given a share of the budget. A section that served all it
 * had passes what it did not use on to the sections after it. A section that left something out
 * keeps its unused room back instead, because a later, lesser section must not be filled with room a
 * more important one could still use; whatever is kept back or left at the end goes to the sections
 * that were cut, most important first. The first three sections have a floor, so that the run, its
 * clocks and where things stand are always on the page. Before anything is laid out the first
 * ruling's bytes are reserved, taken from the later sections and then from the first three down to
 * their floors, since a ruling is never cut and a share smaller than one ruling would serve none
 * while old scene summaries were served.
 */
import { Refusal } from '@timeweft/contract';
import type {
  Briefing, BriefingSection, EntryRecord, FactRecord, Id, JourneyLegRecord, RulingRecord, RunSnapshot, SceneRecord,
} from '@timeweft/contract';
import { resolveEntryInIndex } from './readers.ts';
import {
  compareText, entryNameOf, holdingFactsOf, indexRun, newestStandingScene, rulingsInForce, sceneNumberOf, servableThreads,
  trailNewestFirstOf, wasEstablishedInAStruckScene,
} from './run-index.ts';
import type { RunIndex } from './run-index.ts';
import { CUT_MARKER, SMALLEST_USEFUL_CUT_BYTES, byteLengthOf, cutToFit, onOneLine } from './text-fitting.ts';

export interface BriefingRequest {
  /** Names the next scene is likely to involve. */
  upcoming: string[];
  budgetBytes: number;
}

const BRIEFING_HEADER = '# Resume briefing\n\n';
const LEFT_OUT_HEADING = '## Left out, and how to fetch it\n';
const NOTHING_LEFT_OUT_LINE = '- Nothing was left out.\n';

/** The register is read whole on every resume, unless it alone would take more than this share. */
export const REGISTER_SHARE_OF_BUDGET = 0.15;
/** How many of an entry's latest trail notes the briefing serves. */
export const TRAIL_NOTES_PER_ENTRY = 3;
/**
 * How many of an entry's holding facts are ranked ahead of its trail notes. The rest of its facts
 * come after the trail, so an entry with hundreds of facts still shows what last happened to it.
 */
export const FACTS_BEFORE_THE_TRAIL = 3;
/** How many of the newest scenes outrank older starred ones. */
const NEWEST_SCENES_ALWAYS_FIRST = 3;
/** One fact is one line, and no line is allowed to be a page of its own. */
const LONGEST_FACT_LINE_BYTES = 600;

/**
 * The sections, their share of the room, and for the first three the least they are given. The
 * journeys' small share was taken from the last scenes, which list_scenes serves in full anyway.
 * The rulings hold about a fifth of the budget, taken from the page and the last scenes, because the
 * author's standing instructions about how a run is told were being left out of long runs.
 */
const SECTION_SHARES = [0.2, 0.07, 0.2, 0.05, 0.15, 0.2, 0.06, 0.03, 0.04] as const;
/** Stands in the back pass's order for the first item of each section that takes room for it. */
const FIRST_ITEM_OF_A_SECTION_THAT_TAKES_ROOM = -1;
/**
 * The order the back pass gives room in: the first three, then the first ruling, then every section
 * in the order it is drawn. A ruling is never cut, so without this a ruling left out for want of a
 * few bytes would watch that room go to the page's extras and to old scene summaries.
 */
const BACK_PASS_ORDER = [0, 1, 2, FIRST_ITEM_OF_A_SECTION_THAT_TAKES_ROOM, 3, 4, 5, 6, 7, 8] as const;
/**
 * When no upcoming names are given, the newest standing scenes are read for who is about, the
 * newest weighing most. A long run's every scene is not about the next one, but its last ten are.
 */
export const SCENES_READ_FOR_WHO_IS_ABOUT = 10;
/**
 * At most this many entries are chosen when no names are given. The room caps it lower; this bounds
 * which entries the rulings and threads count as upcoming, so that forty small things coined in the
 * newest scene do not make every ruling about them read as one that bears.
 */
export const MOST_ENTRIES_CHOSEN_BY_DEFAULT = 12;
/**
 * When entries are served whole, one after another, an entry's facts up to this many come before
 * the next entry is started; the rest wait until every chosen entry has been served. One entry with
 * three hundred facts must not keep the next one off the page.
 */
export const FACTS_BEFORE_THE_NEXT_ENTRY = 12;
/** Trail notes an entry served whole always carries before the next entry is started. */
export const TRAIL_NOTES_BEFORE_THE_NEXT_ENTRY = 2;
/** A clock's description is cut to about this many bytes; its reading never is. */
export const CLOCK_DESCRIPTION_BYTES = 200;
/** A scene summary longer than this is served as its first sentences, so more scenes fit. */
export const SCENE_SUMMARY_BYTES = 400;
const SECTION_FLOORS = [300, 180, 340, 0, 0, 0, 0, 0, 0] as const;
const ALWAYS_PRESENT_SECTIONS = 3;

interface Piece {
  /** The text, ending with a newline. */
  text: string;
  bytes: number;
  /** Lower is chosen first when room is short. */
  priority: number;
  /** Lower is drawn first on the page. */
  position: number;
  /** Whether it may be served cut at a sentence or a word. A ruling never is. */
  cuttable: boolean;
  /** Whether it counts as one of the section's items in served and leftOut. */
  isItem: boolean;
  /** Already cut before any room was shared, because it was too long to be one line or one field. */
  alreadyCut: boolean;
  /** A piece that must be served first: a fact line means nothing without its entry's heading. */
  requires: number | null;
  /**
   * The bytes of its label, such as `**Setting:** `. A cut that keeps only the label says nothing.
   * Each section passes it explicitly, since no pattern can tell a label from a colon in a title.
   */
  labelBytes: number;
}

interface SectionPlan {
  name: string;
  /** Its heading and any fixed lede, ending with a newline. */
  heading: string;
  pieces: Piece[];
  /** Drawn even when nothing else in it fits. */
  alwaysPresent: boolean;
  /** The sentence naming the operation that fetches what was left out. */
  fetchWith: string;
  /**
   * Stop at the first piece that does not fit, rather than trying smaller ones after it. Where the
   * priority order is itself a promise (a starred scene before an unstarred one), a small piece
   * further down must not slip in ahead of a larger one that was preferred.
   */
  stopAtFirstMiss?: boolean;
  /**
   * Have the room for its first item whole reserved before anything is laid out, and given first in
   * the back pass. Only the rulings ask for it: a ruling is never cut, so a share smaller than one
   * ruling would serve none at all.
   */
  takesRoomForItsFirstItem?: boolean;
}

interface RenderedSection {
  text: string;
  bytes: number;
  served: number;
  leftOut: number;
  cut: number;
}

/**
 * One piece, written as its label and what follows it. The label is given apart, never found by a
 * pattern, so that a colon inside a title cannot end it early and let a cut keep half the title.
 */
function makePiece(
  label: string,
  body: string,
  fields: Partial<Omit<Piece, 'text' | 'bytes' | 'labelBytes'>> & { priority: number },
): Piece {
  const text = label + body;
  const withNewline = text.endsWith('\n') ? text : `${text}\n`;
  return {
    labelBytes: byteLengthOf(label),
    text: withNewline,
    bytes: byteLengthOf(withNewline),
    priority: fields.priority,
    position: fields.position ?? fields.priority,
    cuttable: fields.cuttable ?? true,
    isItem: fields.isItem ?? true,
    alreadyCut: fields.alreadyCut ?? false,
    requires: fields.requires ?? null,
  };
}

/** Cuts what follows a label where the whole is too long to be one line, and says whether it had to. */
function capped(label: string, body: string, maximumBytes: number): { body: string; cut: boolean } {
  const fitted = cutToFit(label + body, maximumBytes);
  if (fitted === null || fitted === label + body || !fitted.startsWith(label)) return { body, cut: false };
  return { body: fitted.slice(label.length), cut: true };
}

/** Draws one section into at most `allowance` bytes, choosing pieces by priority. */
function renderSection(plan: SectionPlan, allowance: number): RenderedSection {
  const totalItems = plan.pieces.filter((piece) => piece.isItem).length;
  const nothing: RenderedSection = { text: '', bytes: 0, served: 0, leftOut: totalItems, cut: 0 };
  const headingBytes = byteLengthOf(plan.heading);
  if (allowance < headingBytes) return nothing;
  const order = plan.pieces.map((_, pieceIndex) => pieceIndex)
    .sort((left, right) => (plan.pieces[left]?.priority ?? 0) - (plan.pieces[right]?.priority ?? 0) || left - right);
  const chosenText = new Map<number, string>();
  let used = headingBytes;
  let served = 0;
  let cut = 0;
  for (const pieceIndex of order) {
    const piece = plan.pieces[pieceIndex];
    if (!piece) continue;
    if (piece.requires !== null && !chosenText.has(piece.requires)) continue;
    const room = allowance - used;
    let text: string | null = null;
    let wasCutHere = false;
    if (piece.bytes <= room) {
      text = piece.text;
    } else if (piece.cuttable) {
      const fitted = cutToFit(piece.text.slice(0, -1), room - 1);
      const keptBeyondTheLabel = fitted === null ? 0 : byteLengthOf(fitted) - byteLengthOf(CUT_MARKER) - piece.labelBytes;
      if (fitted !== null && keptBeyondTheLabel >= SMALLEST_USEFUL_CUT_BYTES) {
        text = `${fitted}\n`;
        wasCutHere = true;
      }
    }
    if (text === null) {
      if (plan.stopAtFirstMiss) break;
      continue;
    }
    chosenText.set(pieceIndex, text);
    used += byteLengthOf(text);
    if (piece.isItem) served += 1;
    if (wasCutHere || piece.alreadyCut) cut += 1;
  }
  if (chosenText.size === 0 && !plan.alwaysPresent) return nothing;
  const drawn = [...chosenText.keys()]
    .sort((left, right) => (plan.pieces[left]?.position ?? 0) - (plan.pieces[right]?.position ?? 0) || left - right)
    .map((pieceIndex) => chosenText.get(pieceIndex) ?? '');
  const text = plan.heading + drawn.join('');
  return { text, bytes: byteLengthOf(text), served, leftOut: totalItems - served, cut };
}

/** How much each section is first given out of `contentBytes`. */
function initialAllowances(contentBytes: number): number[] {
  const firstThree = SECTION_SHARES.slice(0, ALWAYS_PRESENT_SECTIONS)
    .map((share, sectionIndex) => Math.max(Math.floor(contentBytes * share), SECTION_FLOORS[sectionIndex] ?? 0));
  const firstThreeTotal = firstThree.reduce((sum, bytes) => sum + bytes, 0);
  if (firstThreeTotal >= contentBytes) {
    const scaled = firstThree.map((bytes) => Math.floor((bytes * Math.max(0, contentBytes)) / firstThreeTotal));
    return [...scaled, ...SECTION_SHARES.slice(ALWAYS_PRESENT_SECTIONS).map(() => 0)];
  }
  const remaining = contentBytes - firstThreeTotal;
  const laterShares = SECTION_SHARES.slice(ALWAYS_PRESENT_SECTIONS);
  const laterShareTotal = laterShares.reduce((sum, share) => sum + share, 0);
  return [...firstThree, ...laterShares.map((share) => Math.floor((remaining * share) / laterShareTotal))];
}

/**
 * Reserves room for one section, taking it from the least important later sections first and then
 * from the first three down to their floors. Nothing is taken where the whole could not be found,
 * so that nobody gives room for a ruling that would not fit in any case.
 */
function reserveRoom(allowances: number[], sectionIndex: number, needed: number): void {
  let shortfall = needed - (allowances[sectionIndex] ?? 0);
  if (shortfall <= 0) return;
  const givers: Array<{ index: number; spare: number }> = [];
  for (let laterIndex = allowances.length - 1; laterIndex > sectionIndex; laterIndex -= 1) {
    givers.push({ index: laterIndex, spare: allowances[laterIndex] ?? 0 });
  }
  for (let earlierIndex = sectionIndex - 1; earlierIndex >= 0; earlierIndex -= 1) {
    const floor = earlierIndex < ALWAYS_PRESENT_SECTIONS ? (SECTION_FLOORS[earlierIndex] ?? 0) : 0;
    givers.push({ index: earlierIndex, spare: Math.max(0, (allowances[earlierIndex] ?? 0) - floor) });
  }
  if (givers.reduce((sum, giver) => sum + giver.spare, 0) < shortfall) return;
  for (const giver of givers) {
    if (shortfall <= 0) break;
    const taken = Math.min(giver.spare, shortfall);
    allowances[giver.index] = (allowances[giver.index] ?? 0) - taken;
    allowances[sectionIndex] = (allowances[sectionIndex] ?? 0) + taken;
    shortfall -= taken;
  }
}

/** The bytes a section needs to serve its heading and its first item by priority, whole. */
function bytesForTheFirstItem(plan: SectionPlan): number | null {
  const first = plan.pieces
    .map((piece, pieceIndex) => ({ piece, pieceIndex }))
    .filter(({ piece }) => piece.isItem)
    .sort((left, right) => left.piece.priority - right.piece.priority || left.pieceIndex - right.pieceIndex)[0];
  return first === undefined ? null : byteLengthOf(plan.heading) + first.piece.bytes;
}

/**
 * Shares the room out. Forward first: a section that served everything passes its unused room on,
 * and one that left something out keeps it back. Then back: everything kept back or still unused
 * goes to the sections that were cut, in order of importance.
 */
function layOutSections(plans: SectionPlan[], contentBytes: number): RenderedSection[] {
  const allowances = initialAllowances(contentBytes);
  // The first ruling's bytes are set aside before anything is laid out. Checking only when the
  // rulings' turn came counted no more than the later sections' first shares, and the room given
  // back at the end then went to old scene summaries while no ruling was served.
  plans.forEach((plan, sectionIndex) => {
    const needed = plan.takesRoomForItsFirstItem ? bytesForTheFirstItem(plan) : null;
    if (needed !== null) reserveRoom(allowances, sectionIndex, needed);
  });
  const rendered: RenderedSection[] = [];
  let passedForward = 0;
  let keptBack = 0;
  plans.forEach((plan, sectionIndex) => {
    const allowance = (allowances[sectionIndex] ?? 0) + passedForward;
    const section = renderSection(plan, allowance);
    rendered.push(section);
    const unused = allowance - section.bytes;
    if (section.leftOut > 0 || section.cut > 0) {
      keptBack += unused;
      passedForward = 0;
    } else {
      passedForward = unused;
    }
  });
  let unused = keptBack + passedForward;
  const giveBack = (sectionIndex: number, firstItemOnly: boolean): void => {
    const plan = plans[sectionIndex];
    const before = rendered[sectionIndex];
    if (!plan || !before || unused <= 0 || (before.leftOut === 0 && before.cut === 0)) return;
    let allowance = before.bytes + unused;
    if (firstItemOnly) {
      // Only what the first item needs, and only where it can be met whole: the rest of the room
      // still goes to the sections in the order they are drawn.
      const needed = bytesForTheFirstItem(plan);
      if (before.served > 0 || needed === null || needed > allowance) return;
      allowance = needed;
    }
    const after = renderSection(plan, allowance);
    if (after.bytes < before.bytes) return;
    rendered[sectionIndex] = after;
    unused -= after.bytes - before.bytes;
  };
  for (const step of BACK_PASS_ORDER) {
    if (step === FIRST_ITEM_OF_A_SECTION_THAT_TAKES_ROOM) {
      plans.forEach((plan, sectionIndex) => { if (plan.takesRoomForItsFirstItem) giveBack(sectionIndex, true); });
    } else if (step < plans.length) {
      giveBack(step, false);
    }
  }
  return rendered;
}

function countPhrase(section: RenderedSection): string {
  const parts: string[] = [];
  if (section.leftOut > 0) parts.push(`${section.leftOut} left out`);
  if (section.cut > 0) parts.push(`${section.cut} cut short`);
  return parts.join(' and ');
}

function leftOutList(plans: SectionPlan[], rendered: RenderedSection[]): string {
  const lines = plans.flatMap((plan, sectionIndex) => {
    const section = rendered[sectionIndex];
    if (!section || (section.leftOut === 0 && section.cut === 0)) return [];
    return [`- ${plan.name}: ${countPhrase(section)}. ${plan.fetchWith}\n`];
  });
  return LEFT_OUT_HEADING + (lines.length > 0 ? lines.join('') : NOTHING_LEFT_OUT_LINE);
}

function assemble(rendered: RenderedSection[], tail: string): string {
  const drawn = rendered.filter((section) => section.bytes > 0).map((section) => section.text);
  return `${BRIEFING_HEADER}${[...drawn, tail].join('\n')}`;
}

/* ---------------------------------------------------------------- the nine sections */

function theRunSection(index: RunIndex, budgetBytes: number): SectionPlan {
  const run = index.snapshot.run;
  const statusMeaning = run.status === 'binding'
    ? 'what it establishes is canon at once'
    : 'what it establishes stays inside the run';
  const pieces: Piece[] = [
    makePiece('**Title:** ', onOneLine(run.title), { priority: 0, position: 0 }),
    makePiece('**Status:** ', `${run.status}: ${statusMeaning}.`, { priority: 1, position: 1 }),
  ];
  if (run.register.trim().length > 0) {
    const registerLabel = '**Register:**\n';
    const register = capped(registerLabel, run.register.trim(), Math.floor(budgetBytes * REGISTER_SHARE_OF_BUDGET));
    pieces.push(makePiece(registerLabel, register.body, { priority: 2, position: 3, alreadyCut: register.cut }));
  }
  if (run.setting.trim().length > 0) {
    pieces.push(makePiece('**Setting:** ', run.setting.trim(), { priority: 3, position: 2 }));
  }
  return {
    name: 'The run', heading: '## The run\n', pieces, alwaysPresent: true,
    // Not "a larger budget": a register may be larger than any budget a resume allows, and is then
    // cut at every size. list_runs answers each run's record whole, register included.
    fetchWith: 'list_runs carries every run\'s title, setting and register whole.',
  };
}

function theClocksSection(index: RunIndex): SectionPlan {
  const pieces: Piece[] = [];
  const clocks = index.snapshot.clocks;
  clocks.forEach((clock, clockIndex) => {
    let reading: { count: string; partOfDay: string; sceneNumber: number } | null = null;
    for (let sceneIndex = index.standingScenes.length - 1; sceneIndex >= 0 && reading === null; sceneIndex -= 1) {
      const scene = index.standingScenes[sceneIndex];
      const found = scene?.readings.find((candidate) => candidate.clockId === clock.id);
      if (scene && found) reading = { count: found.count, partOfDay: found.partOfDay, sceneNumber: scene.number };
    }
    const readingText = reading === null
      ? 'no reading yet.'
      : `${reading.count}${reading.partOfDay.trim().length > 0 ? `, ${onOneLine(reading.partOfDay)}` : ''}, at scene ${reading.sceneNumber}.`;
    // The reading is part of the label, so a cut can only ever take the description after it. The
    // description is cut to its first sentences up front: a clock whose description had stacked
    // up its whole history in one field took the clocks' whole share and left the others out.
    const description = onOneLine(clock.countsFrom);
    const shortened = description.length === 0 ? '' : (cutToFit(description, CLOCK_DESCRIPTION_BYTES) ?? '');
    const descriptionWasCut = shortened !== description;
    const body = shortened.length > 0 ? ` Counts from: ${shortened}` : '';
    pieces.push(makePiece(`- ${onOneLine(clock.name)}: ${readingText}`, body, { priority: clockIndex, alreadyCut: descriptionWasCut }));
  });
  if (clocks.length === 0) pieces.push(makePiece('', 'No clocks are kept.', { priority: 0, isItem: false }));
  return {
    name: 'The clocks', heading: '## The clocks\n', pieces, alwaysPresent: true,
    fetchWith: 'resume_run with a larger budgetBytes lists every clock, and list_scenes gives the readings; a clock\'s description is cut to its first sentences at every size, never its reading.',
  };
}

function whereThingsStandSection(index: RunIndex): SectionPlan {
  const newest = newestStandingScene(index);
  const pieces: Piece[] = [];
  if (newest === null) {
    pieces.push(makePiece('', 'No scene has been saved yet: the story begins at scene 1.', { priority: 0, isItem: false }));
  } else {
    pieces.push(makePiece(`Scene ${newest.number}, "${onOneLine(newest.title)}", `, `${onOneLine(newest.whenTyped)}.`, { priority: 0 }));
    pieces.push(makePiece('**Situation after it:**\n', newest.situationAfter.trim(), { priority: 1 }));
  }
  return {
    name: 'Where things stand', heading: '## Where things stand\n', pieces, alwaysPresent: true,
    fetchWith: newest === null ? '' : `read_scene ${newest.number} gives the whole of that scene, its situation included.`,
  };
}

function waypointsSection(index: RunIndex): SectionPlan {
  const waypoints = index.snapshot.waypoints.filter((waypoint) => waypoint.reachedInSceneId === null);
  const pieces = waypoints.map((waypoint, waypointIndex) =>
    makePiece(`- Waypoint ${waypoint.id}: `, onOneLine(waypoint.text), { priority: waypointIndex }));
  if (pieces.length === 0) pieces.push(makePiece('', 'None.', { priority: 0, isItem: false }));
  return {
    name: 'Waypoints not yet reached', heading: '## Waypoints not yet reached\n', pieces, alwaysPresent: false,
    fetchWith: 'resume_run with a larger budgetBytes lists every waypoint.',
  };
}

/** Whether any name was given at all; blank ones say nothing. */
function namesWereGiven(upcoming: string[]): boolean {
  return upcoming.some((name) => onOneLine(name).length > 0);
}

/** One name asked for, and what it means in the store. */
type UpcomingName =
  | { kind: 'entry'; entry: EntryRecord }
  | { kind: 'new'; name: string }
  | { kind: 'ambiguous'; name: string; refusal: string };

/** The names asked for, or where none were, who is about now (see entriesAboutNow). */
function upcomingNames(index: RunIndex, upcoming: string[]): UpcomingName[] {
  const answer: UpcomingName[] = [];
  const seenEntryIds = new Set<Id>();
  const seenTexts = new Set<string>();
  const addEntry = (entry: EntryRecord | undefined): void => {
    if (!entry || seenEntryIds.has(entry.id)) return;
    seenEntryIds.add(entry.id);
    answer.push({ kind: 'entry', entry });
  };
  for (const asked of upcoming) {
    const name = onOneLine(asked);
    const key = name.toLowerCase();
    if (name.length === 0 || seenTexts.has(key)) continue;
    seenTexts.add(key);
    try {
      const entry = resolveEntryInIndex(index, name);
      if (entry) addEntry(entry);
      else answer.push({ kind: 'new', name });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      answer.push({ kind: 'ambiguous', name, refusal: error.message });
    }
  }
  if (namesWereGiven(upcoming)) return answer;
  for (const entry of entriesAboutNow(index)) addEntry(entry);
  return answer;
}

/**
 * Who is about, when no names are given. Each entry is weighed by its presence over the newest
 * standing scenes: a trail note, a fact it began, or the scene being set there, the newest scene
 * weighing most and each older one a step less, to nothing past the last ten. Ties go to whoever
 * has the most trail notes in the run. The entry with the most trail notes in the whole run is
 * always first: in a long run that is the one the story is told through, present in every scene,
 * and reading only the newest scene's facts left them out behind forty small things it coined.
 */
function entriesAboutNow(index: RunIndex): EntryRecord[] {
  const recent = [...index.standingScenes].reverse().slice(0, SCENES_READ_FOR_WHO_IS_ABOUT);
  const presence = new Map<Id, number>();
  recent.forEach((scene, stepsBack) => {
    const weight = SCENES_READ_FOR_WHO_IS_ABOUT - stepsBack;
    const present = new Set<Id>();
    if (scene.placeEntryId !== null) present.add(scene.placeEntryId);
    for (const fact of index.snapshot.facts) if (fact.fromSceneId === scene.id) present.add(fact.entryId);
    for (const note of index.snapshot.notes) if (note.sceneId === scene.id) present.add(note.entryId);
    for (const entryId of present) presence.set(entryId, (presence.get(entryId) ?? 0) + weight);
  });
  const trailCountOf = (entryId: Id): number => index.servableNotesByEntry.get(entryId)?.length ?? 0;
  const byWeight = (left: EntryRecord, right: EntryRecord): number =>
    (presence.get(right.id) ?? 0) - (presence.get(left.id) ?? 0)
    || trailCountOf(right.id) - trailCountOf(left.id)
    || compareText(left.name, right.name) || compareText(left.id, right.id);
  const mostTrailed = [...index.snapshot.entries]
    .filter((entry) => trailCountOf(entry.id) > 0)
    .sort((left, right) => trailCountOf(right.id) - trailCountOf(left.id) || compareText(left.name, right.name) || compareText(left.id, right.id))[0];
  const present = index.snapshot.entries
    .filter((entry) => (presence.get(entry.id) ?? 0) > 0 && entry.id !== mostTrailed?.id)
    .sort(byWeight);
  return [...(mostTrailed ? [mostTrailed] : []), ...present].slice(0, MOST_ENTRIES_CHOSEN_BY_DEFAULT);
}

/** A fact's age, said beside it, so a fact written long ago is never read as just established. */
function sinceWhen(index: RunIndex, fact: FactRecord): string {
  if (fact.fromSceneId === null) return 'from the start';
  const number = sceneNumberOf(index, fact.fromSceneId);
  return number === null ? 'since a scene not in the run' : `since scene ${number}`;
}

/** An entry's holding facts, newest first, so what was established lately leads. */
function holdingFactsNewestFirst(index: RunIndex, entryId: Id): FactRecord[] {
  return [...holdingFactsOf(index, entryId)].sort((left, right) =>
    (sceneNumberOf(index, right.fromSceneId) ?? 0) - (sceneNumberOf(index, left.fromSceneId) ?? 0)
    || compareText(right.createdAt, left.createdAt) || compareText(right.id, left.id));
}

function onThePageNextSection(index: RunIndex, names: UpcomingName[], servedWhole: boolean): SectionPlan {
  const pieces: Piece[] = [];
  const nameCount = Math.max(1, names.length);
  // Named entries are ranked in steps: a heading, then its first few facts, then its newest trail
  // notes, then the rest of its facts, the steps taken in turn across the names, so one entry with
  // three hundred facts can neither crowd every other name off the page nor bury its own trail.
  const interleavedPriority = (step: number, nameIndex: number): number => step * nameCount + nameIndex;
  // Entries chosen for the writer, with no names given, are served whole one after another, in the
  // order they were weighed: fewer entries served properly rather than many cut short.
  const BLOCK = 1_000_000;
  const AFTER_EVERY_BLOCK = nameCount * BLOCK;
  let lastEssentialOfThePreviousEntry: number | null = null;
  names.forEach((upcoming, nameIndex) => {
    const blockStart = nameIndex * 10_000_000;
    if (upcoming.kind === 'new' || upcoming.kind === 'ambiguous') {
      const body = upcoming.kind === 'new' ? 'Not in the store: it would be new.' : upcoming.refusal;
      pieces.push(makePiece(`### ${upcoming.name}\n`, body, { priority: interleavedPriority(0, nameIndex), position: blockStart }));
      return;
    }
    const entry = upcoming.entry;
    const pronoun = entry.pronoun.trim().length > 0 ? `, ${onOneLine(entry.pronoun)}` : '';
    const otherNames = entry.alsoKnownAs.length > 0 ? `, also ${entry.alsoKnownAs.map(onOneLine).join(', ')}` : '';
    const headingIndex = pieces.length;
    const trail = trailNewestFirstOf(index, entry.id).slice(0, TRAIL_NOTES_PER_ENTRY);
    const holding = holdingFactsNewestFirst(index, entry.id);
    const factPiece = (factIndex: number): Piece | null => {
      const fact = holding[factIndex];
      if (!fact) return null;
      const pointedAt = fact.aboutEntryId === null ? '' : ` (${entryNameOf(index, fact.aboutEntryId) ?? 'an entry not served here'})`;
      // The age is in the label, so that a value cut short still says since when it held.
      const label = `- ${onOneLine(fact.property)} (${sinceWhen(index, fact)}): `;
      const line = capped(label, `${onOneLine(fact.value)}${pointedAt}`, LONGEST_FACT_LINE_BYTES);
      return makePiece(label, line.body, { priority: 0, position: blockStart + 1 + factIndex, alreadyCut: line.cut });
    };
    const trailPiece = (noteIndex: number): Piece | null => {
      const note = trail[noteIndex];
      if (!note) return null;
      const sceneNumber = index.sceneById.get(note.sceneId)?.number ?? '?';
      const label = `- Trail, scene ${sceneNumber}: `;
      const line = capped(label, onOneLine(note.text), LONGEST_FACT_LINE_BYTES);
      return makePiece(label, line.body, { priority: 0, position: blockStart + 5_000_000 + noteIndex, alreadyCut: line.cut });
    };
    const add = (piece: Piece | null, priority: number, requires: number | null): number | null => {
      if (piece === null) return null;
      pieces.push({ ...piece, priority, requires });
      return pieces.length - 1;
    };
    if (!servedWhole) {
      add(makePiece(`### ${onOneLine(entry.name)} (${entry.kind}${pronoun})`, otherNames, { priority: 0, position: blockStart }), interleavedPriority(0, nameIndex), null);
      const factsAheadOfTheTrail = Math.min(FACTS_BEFORE_THE_TRAIL, holding.length);
      holding.forEach((_, factIndex) => {
        const step = factIndex < FACTS_BEFORE_THE_TRAIL ? 1 + factIndex : 1 + factIndex + trail.length;
        add(factPiece(factIndex), interleavedPriority(step, nameIndex), headingIndex);
      });
      trail.forEach((_, noteIndex) => add(trailPiece(noteIndex), interleavedPriority(1 + factsAheadOfTheTrail + noteIndex, nameIndex), headingIndex));
      return;
    }
    // Served whole: each essential piece requires the one before it, so where one does not fit
    // nothing after it is served, the next entry included, and the page never starts an entry it
    // cannot give its heading, its facts and its two newest trail notes.
    let step = 0;
    let previous = add(makePiece(`### ${onOneLine(entry.name)} (${entry.kind}${pronoun})`, otherNames, { priority: 0, position: blockStart }),
      nameIndex * BLOCK, lastEssentialOfThePreviousEntry);
    const essentialTrail = Math.min(TRAIL_NOTES_BEFORE_THE_NEXT_ENTRY, trail.length);
    for (let noteIndex = 0; noteIndex < essentialTrail; noteIndex += 1) {
      step += 1;
      previous = add(trailPiece(noteIndex), nameIndex * BLOCK + step, previous);
    }
    const essentialFacts = Math.min(FACTS_BEFORE_THE_NEXT_ENTRY, holding.length);
    for (let factIndex = 0; factIndex < essentialFacts; factIndex += 1) {
      step += 1;
      previous = add(factPiece(factIndex), nameIndex * BLOCK + step, previous);
    }
    lastEssentialOfThePreviousEntry = previous;
    // What is beyond the essentials waits until every chosen entry has had its own.
    for (let noteIndex = essentialTrail; noteIndex < trail.length; noteIndex += 1) {
      add(trailPiece(noteIndex), AFTER_EVERY_BLOCK + nameIndex * BLOCK + noteIndex, headingIndex);
    }
    for (let factIndex = essentialFacts; factIndex < holding.length; factIndex += 1) {
      add(factPiece(factIndex), AFTER_EVERY_BLOCK + nameIndex * BLOCK + TRAIL_NOTES_PER_ENTRY + factIndex, headingIndex);
    }
  });
  if (pieces.length === 0) pieces.push(makePiece('', 'Nobody and nothing was named.', { priority: 0, isItem: false }));
  return {
    name: 'On the page next',
    heading: servedWhole
      ? '## On the page next\nWho is about now, the one with the longest trail first: what holds for each, with since when, and the latest of their trail.\n'
      : '## On the page next\nWhat holds now for each, with since when, and the latest of their trail.\n',
    pieces, alwaysPresent: false,
    fetchWith: 'look_up fetches each name in full, with its whole trail.',
  };
}

function aboutNames(index: RunIndex, entryIds: Id[]): string {
  return entryIds.map((entryId) => entryNameOf(index, entryId)).filter((name): name is string => name !== null).join(', ');
}

/** Whether a ruling's topics say it is about how the run is told: its narration or point of view. */
function isAboutTheTelling(ruling: RulingRecord): boolean {
  return ruling.topics.some((topic) => {
    const folded = onOneLine(topic).toLowerCase().replace(/[-_]/g, ' ');
    return folded.includes('narrat') || folded.includes('point of view') || folded === 'pov' || folded === 'viewpoint';
  });
}

/**
 * The rulings in the order they are served. A long run's world rulings are mostly small facts the
 * story coined, recorded as rulings; served first, they crowded out the author's standing
 * instructions about how the run is told. So: (a) the author's run rulings about narration or point
 * of view; (b) other run rulings about the upcoming entries; (c) the author's other run rulings;
 * (d) world rulings about the upcoming entries; (e) the rest. Newest first within each.
 */
function rulingsInServingOrder(index: RunIndex, upcomingEntryIds: ReadonlySet<Id>): RulingRecord[] {
  const newestFirst = [...rulingsInForce(index)].reverse();
  const aboutUpcoming = (ruling: RulingRecord): boolean => ruling.aboutEntryIds.some((entryId) => upcomingEntryIds.has(entryId));
  const groups: Array<(ruling: RulingRecord) => boolean> = [
    (ruling) => ruling.scope === 'run' && ruling.source === 'author' && isAboutTheTelling(ruling),
    (ruling) => ruling.scope === 'run' && aboutUpcoming(ruling),
    (ruling) => ruling.scope === 'run' && ruling.source === 'author',
    (ruling) => ruling.scope === 'world' && aboutUpcoming(ruling),
    () => true,
  ];
  const taken = new Set<Id>();
  const ordered: RulingRecord[] = [];
  for (const belongs of groups) {
    for (const ruling of newestFirst) {
      if (taken.has(ruling.id) || !belongs(ruling)) continue;
      taken.add(ruling.id);
      ordered.push(ruling);
    }
  }
  return ordered;
}

function rulingsSection(index: RunIndex, upcomingEntryIds: ReadonlySet<Id>): SectionPlan {
  const pieces = rulingsInServingOrder(index, upcomingEntryIds).map((ruling, rulingIndex) => {
    const topics = ruling.topics.length > 0 ? ruling.topics.join(', ') : '';
    const about = aboutNames(index, ruling.aboutEntryIds);
    const label = [topics, about.length > 0 ? `about ${about}` : ''].filter((part) => part.length > 0).join('; ');
    // Word for word: the text is set down as given and the piece is served whole or not at all.
    return makePiece(`**Ruling ${ruling.number}**${label.length > 0 ? ` (${label})` : ''}:\n`, ruling.text, {
      priority: rulingIndex, cuttable: false,
    });
  });
  if (pieces.length === 0) pieces.push(makePiece('', 'None.', { priority: 0, isItem: false }));
  return {
    name: 'Rulings that bear', heading: '## Rulings that bear\n', pieces, alwaysPresent: false, takesRoomForItsFirstItem: true,
    fetchWith: 'list_rulings fetches them word for word, by topic or by name.',
  };
}

function threadsSection(index: RunIndex, upcomingEntryIds: ReadonlySet<Id>): SectionPlan {
  const openNewestFirst = servableThreads(index).filter((thread) => thread.closedInSceneId === null).reverse();
  const touching = openNewestFirst.filter((thread) => thread.aboutEntryIds.some((entryId) => upcomingEntryIds.has(entryId)));
  const others = openNewestFirst.filter((thread) => !thread.aboutEntryIds.some((entryId) => upcomingEntryIds.has(entryId)));
  const pieces = [...touching, ...others].map((thread, threadIndex) => {
    const about = aboutNames(index, thread.aboutEntryIds);
    // The id leads, so that a line cut short still carries what a save needs to close it.
    return makePiece(`- Thread ${thread.id}: `, `${onOneLine(thread.text)}${about.length > 0 ? ` (about ${about})` : ''}`, { priority: threadIndex });
  });
  if (pieces.length === 0) pieces.push(makePiece('', 'None.', { priority: 0, isItem: false }));
  return {
    name: 'Open threads', heading: '## Open threads\n', pieces, alwaysPresent: false,
    fetchWith: 'list_threads fetches every open thread.',
  };
}

/** The names asked for, and every other name each answers to, folded for a case-blind match. */
function upcomingPlaceNames(names: UpcomingName[]): Set<string> {
  const folded = new Set<string>();
  for (const upcoming of names) {
    const texts = upcoming.kind === 'entry' ? [upcoming.entry.name, ...upcoming.entry.alsoKnownAs] : [upcoming.name];
    for (const text of texts) {
      const key = onOneLine(text).toLowerCase();
      if (key.length > 0) folded.add(key);
    }
  }
  return folded;
}

/**
 * The journeys already travelled, so a story does not have the ford take a day in one scene and a
 * week in the next. Those touching an upcoming place come first, then the newest. A journey first
 * travelled in a struck take is never served.
 */
function journeysSection(index: RunIndex, names: UpcomingName[]): SectionPlan {
  const placeNames = upcomingPlaceNames(names);
  const touches = (leg: JourneyLegRecord): boolean =>
    placeNames.has(onOneLine(leg.fromPlace).toLowerCase()) || placeNames.has(onOneLine(leg.toPlace).toLowerCase());
  const newestFirst = index.snapshot.legs
    .filter((leg) => !wasEstablishedInAStruckScene(index, leg.sceneId))
    .sort((left, right) =>
      (sceneNumberOf(index, right.sceneId) ?? 0) - (sceneNumberOf(index, left.sceneId) ?? 0)
      || compareText(right.createdAt, left.createdAt) || compareText(right.id, left.id));
  const ordered = [...newestFirst.filter(touches), ...newestFirst.filter((leg) => !touches(leg))];
  const pieces = ordered.map((leg, legIndex) => {
    const note = leg.note.trim().length > 0 ? ` (${onOneLine(leg.note)})` : '';
    const label = `- ${onOneLine(leg.fromPlace)} to ${onOneLine(leg.toPlace)}: `;
    const line = capped(label, `${onOneLine(leg.duration)}${note}`, LONGEST_FACT_LINE_BYTES);
    return makePiece(label, line.body, { priority: legIndex, alreadyCut: line.cut });
  });
  if (pieces.length === 0) pieces.push(makePiece('', 'None.', { priority: 0, isItem: false }));
  return {
    name: 'Journeys already travelled', heading: '## Journeys already travelled\n', pieces, alwaysPresent: false,
    // A journey tied to no scene cannot be opened with read_scene, so find comes first: it searches
    // every journey by a place it touches.
    fetchWith: 'find fetches the journeys by a place they touch, and read_scene opens the scene one was first travelled in.',
  };
}

function lastScenesSection(index: RunIndex): SectionPlan {
  const newestFirst: SceneRecord[] = [...index.standingScenes].reverse();
  const newest = newestFirst.slice(0, NEWEST_SCENES_ALWAYS_FIRST);
  const older = newestFirst.slice(NEWEST_SCENES_ALWAYS_FIRST);
  // When room runs short a starred scene further back outranks an unstarred one.
  const chosenOrder = [...newest, ...older.filter((scene) => scene.starred), ...older.filter((scene) => !scene.starred)];
  const priorityOf = new Map(chosenOrder.map((scene, rank) => [scene.id, rank]));
  const pieces = newestFirst.map((scene, position) => {
    // A long summary is served as its first sentences, so that more scenes fit; list_scenes gives
    // the whole of it.
    const summary = onOneLine(scene.summary);
    const shortened = cutToFit(summary, SCENE_SUMMARY_BYTES) ?? summary;
    return makePiece(
      `- Scene ${scene.number}${scene.starred ? ' (starred)' : ''}, "${onOneLine(scene.title)}", ${onOneLine(scene.whenTyped)}: `,
      shortened,
      { priority: priorityOf.get(scene.id) ?? position, position, alreadyCut: shortened !== summary },
    );
  });
  if (pieces.length === 0) pieces.push(makePiece('', 'None yet.', { priority: 0, isItem: false }));
  return {
    name: 'The last scenes', heading: '## The last scenes\n', pieces, alwaysPresent: false, stopAtFirstMiss: true,
    fetchWith: 'list_scenes fetches the summaries, and read_scene opens one scene in full.',
  };
}

/* ---------------------------------------------------------------- the whole */

/** How many times the room for the closing list is grown before the last resort is used. */
const MOST_LAYOUT_ATTEMPTS = 16;

/**
 * The present of a run, never larger in UTF-8 bytes than `budgetBytes`. The same snapshot and
 * request always give the same bytes.
 */
export function buildBriefing(snapshot: RunSnapshot, request: BriefingRequest): Briefing {
  const budgetBytes = Math.max(0, Math.floor(request.budgetBytes));
  const index = indexRun(snapshot);
  const names = upcomingNames(index, request.upcoming);
  const upcomingEntryIds = new Set(names.flatMap((name) => (name.kind === 'entry' ? [name.entry.id] : [])));
  const plans = [
    theRunSection(index, budgetBytes),
    theClocksSection(index),
    whereThingsStandSection(index),
    waypointsSection(index),
    onThePageNextSection(index, names, !namesWereGiven(request.upcoming)),
    rulingsSection(index, upcomingEntryIds),
    threadsSection(index, upcomingEntryIds),
    journeysSection(index, names),
    lastScenesSection(index),
  ];
  // One newline is drawn between each two sections and before the closing list.
  const separatorBytes = plans.length;
  const fixedBytes = byteLengthOf(BRIEFING_HEADER) + separatorBytes;
  let roomForTheList = byteLengthOf(LEFT_OUT_HEADING + NOTHING_LEFT_OUT_LINE);
  let rendered: RenderedSection[] = [];
  let text = '';
  for (let attempt = 0; attempt < MOST_LAYOUT_ATTEMPTS; attempt += 1) {
    rendered = layOutSections(plans, budgetBytes - fixedBytes - roomForTheList);
    const list = leftOutList(plans, rendered);
    text = assemble(rendered, list);
    const overflow = byteLengthOf(text) - budgetBytes;
    if (overflow <= 0) break;
    // Once the room held back is at least the list's own size, the sections can no longer push the
    // whole past the budget, so this settles as soon as the list stops growing.
    roomForTheList = Math.max(roomForTheList + overflow, byteLengthOf(list));
  }
  if (byteLengthOf(text) > budgetBytes) {
    // Only a budget far smaller than any resume allows gets here; the promise on size still holds.
    text = cutToFit(text, budgetBytes) ?? '';
  }
  const sections: BriefingSection[] = plans.map((plan, sectionIndex) => {
    const section = rendered[sectionIndex] ?? { text: '', bytes: 0, served: 0, leftOut: 0, cut: 0 };
    const anythingMissing = section.leftOut > 0 || section.cut > 0;
    return {
      name: plan.name, bytes: section.bytes, served: section.served, leftOut: section.leftOut,
      fetchWith: anythingMissing ? plan.fetchWith : '',
    };
  });
  return { text, bytes: byteLengthOf(text), budgetBytes, sections };
}
