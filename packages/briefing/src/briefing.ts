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
 * clocks and where things stand are always on the page. The rulings may take room from the
 * sections after them to serve their first ruling whole, since a share smaller than one ruling
 * would otherwise serve none while old scene summaries were served.
 */
import { Refusal } from '@timeweft/contract';
import type { Briefing, BriefingSection, EntryRecord, Id, JourneyLegRecord, RunSnapshot, SceneRecord } from '@timeweft/contract';
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
 */
const SECTION_SHARES = [0.2, 0.07, 0.2, 0.05, 0.22, 0.12, 0.06, 0.03, 0.05] as const;
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
   * Take room from the sections after this one, where its own share is too small, to serve its
   * first item whole. Only the rulings ask for it: a ruling is never cut, so a share smaller than
   * one ruling would serve none at all.
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
  const rendered: RenderedSection[] = [];
  let passedForward = 0;
  let keptBack = 0;
  plans.forEach((plan, sectionIndex) => {
    let allowance = (allowances[sectionIndex] ?? 0) + passedForward;
    const needed = plan.takesRoomForItsFirstItem ? bytesForTheFirstItem(plan) : null;
    if (needed !== null && allowance < needed) {
      // Only taken where the room kept back and the later sections' shares can cover it all, so
      // that nothing is taken from anybody for a ruling that would not fit in any case.
      const laterTotal = allowances.slice(sectionIndex + 1).reduce((sum, bytes) => sum + bytes, 0);
      if (allowance + keptBack + laterTotal >= needed) {
        let shortfall = needed - allowance;
        const fromKeptBack = Math.min(keptBack, shortfall);
        keptBack -= fromKeptBack;
        shortfall -= fromKeptBack;
        // The least important sections give first.
        for (let laterIndex = plans.length - 1; laterIndex > sectionIndex && shortfall > 0; laterIndex -= 1) {
          const taken = Math.min(allowances[laterIndex] ?? 0, shortfall);
          allowances[laterIndex] = (allowances[laterIndex] ?? 0) - taken;
          shortfall -= taken;
        }
        allowance = needed;
      }
    }
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
  plans.forEach((plan, sectionIndex) => {
    const before = rendered[sectionIndex];
    if (!before || unused <= 0 || (before.leftOut === 0 && before.cut === 0)) return;
    const allowance = before.bytes + unused;
    const after = renderSection(plan, allowance);
    if (after.bytes < before.bytes) return;
    rendered[sectionIndex] = after;
    unused = allowance - after.bytes;
  });
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
    const countsFrom = clock.countsFrom.trim().length > 0 ? ` (${onOneLine(clock.countsFrom)})` : '';
    const readingText = reading === null
      ? 'no reading yet.'
      : `${reading.count}${reading.partOfDay.trim().length > 0 ? `, ${onOneLine(reading.partOfDay)}` : ''}, at scene ${reading.sceneNumber}.`;
    pieces.push(makePiece(`- ${onOneLine(clock.name)}${countsFrom}: `, readingText, { priority: clockIndex }));
  });
  if (clocks.length === 0) pieces.push(makePiece('', 'No clocks are kept.', { priority: 0, isItem: false }));
  return {
    name: 'The clocks', heading: '## The clocks\n', pieces, alwaysPresent: true,
    fetchWith: 'resume_run with a larger budgetBytes lists every clock, and list_scenes gives the readings.',
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

/** One name asked for, and what it means in the store. */
type UpcomingName =
  | { kind: 'entry'; entry: EntryRecord }
  | { kind: 'new'; name: string }
  | { kind: 'ambiguous'; name: string; refusal: string };

/** The names asked for, or where none were, everyone the newest scene touched. */
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
  if (upcoming.length > 0) return answer;
  const newest = newestStandingScene(index);
  if (newest === null) return answer;
  const byCreation = (left: { createdAt: string; id: Id }, right: { createdAt: string; id: Id }): number =>
    (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (newest.placeEntryId !== null) addEntry(index.entryById.get(newest.placeEntryId));
  const factsOfTheScene = index.snapshot.facts.filter((fact) => fact.fromSceneId === newest.id).sort(byCreation);
  for (const fact of factsOfTheScene) {
    addEntry(index.entryById.get(fact.entryId));
    if (fact.aboutEntryId !== null) addEntry(index.entryById.get(fact.aboutEntryId));
  }
  const notesOfTheScene = index.snapshot.notes.filter((note) => note.sceneId === newest.id).sort(byCreation);
  for (const note of notesOfTheScene) addEntry(index.entryById.get(note.entryId));
  return answer;
}

function onThePageNextSection(index: RunIndex, names: UpcomingName[]): SectionPlan {
  const pieces: Piece[] = [];
  const nameCount = Math.max(1, names.length);
  // Each name's pieces are ranked in steps: its heading, then its first few facts, then its newest
  // trail notes, then the rest of its facts. The steps are taken in turn across the names, so one
  // entry with three hundred facts can neither crowd every other name off the page nor bury its
  // own latest trail under facts that come later in reading order.
  const priorityAt = (step: number, nameIndex: number): number => step * nameCount + nameIndex;
  names.forEach((upcoming, nameIndex) => {
    const blockStart = nameIndex * 10_000_000;
    if (upcoming.kind === 'new') {
      pieces.push(makePiece(`### ${upcoming.name}\n`, 'Not in the store: it would be new.', { priority: priorityAt(0, nameIndex), position: blockStart }));
      return;
    }
    if (upcoming.kind === 'ambiguous') {
      pieces.push(makePiece(`### ${upcoming.name}\n`, upcoming.refusal, { priority: priorityAt(0, nameIndex), position: blockStart }));
      return;
    }
    const entry = upcoming.entry;
    const pronoun = entry.pronoun.trim().length > 0 ? `, ${onOneLine(entry.pronoun)}` : '';
    const otherNames = entry.alsoKnownAs.length > 0 ? `, also ${entry.alsoKnownAs.map(onOneLine).join(', ')}` : '';
    const headingIndex = pieces.length;
    pieces.push(makePiece(`### ${onOneLine(entry.name)} (${entry.kind}${pronoun})`, otherNames, { priority: priorityAt(0, nameIndex), position: blockStart }));
    const trail = trailNewestFirstOf(index, entry.id).slice(0, TRAIL_NOTES_PER_ENTRY);
    const holding = holdingFactsOf(index, entry.id);
    holding.forEach((fact, factIndex) => {
      const pointedAt = fact.aboutEntryId === null ? '' : ` (${entryNameOf(index, fact.aboutEntryId) ?? 'an entry not served here'})`;
      const label = `- ${onOneLine(fact.property)}: `;
      const line = capped(label, `${onOneLine(fact.value)}${pointedAt}`, LONGEST_FACT_LINE_BYTES);
      const step = factIndex < FACTS_BEFORE_THE_TRAIL ? 1 + factIndex : 1 + factIndex + trail.length;
      pieces.push(makePiece(label, line.body, {
        priority: priorityAt(step, nameIndex), position: blockStart + 1 + factIndex,
        requires: headingIndex, alreadyCut: line.cut,
      }));
    });
    const factsAheadOfTheTrail = Math.min(FACTS_BEFORE_THE_TRAIL, holding.length);
    trail.forEach((note, noteIndex) => {
      const sceneNumber = index.sceneById.get(note.sceneId)?.number ?? '?';
      const label = `- Trail, scene ${sceneNumber}: `;
      const line = capped(label, onOneLine(note.text), LONGEST_FACT_LINE_BYTES);
      pieces.push(makePiece(label, line.body, {
        priority: priorityAt(1 + factsAheadOfTheTrail + noteIndex, nameIndex), position: blockStart + 5_000_000 + noteIndex,
        requires: headingIndex, alreadyCut: line.cut,
      }));
    });
  });
  if (pieces.length === 0) pieces.push(makePiece('', 'Nobody and nothing was named.', { priority: 0, isItem: false }));
  return {
    name: 'On the page next',
    heading: '## On the page next\nWhat holds now for each, and the latest of their trail.\n',
    pieces, alwaysPresent: false,
    fetchWith: 'look_up fetches each name in full, with its whole trail.',
  };
}

function aboutNames(index: RunIndex, entryIds: Id[]): string {
  return entryIds.map((entryId) => entryNameOf(index, entryId)).filter((name): name is string => name !== null).join(', ');
}

function rulingsSection(index: RunIndex, upcomingEntryIds: ReadonlySet<Id>): SectionPlan {
  const newestFirst = [...rulingsInForce(index)].reverse();
  const aboutUpcoming = newestFirst.filter((ruling) => ruling.aboutEntryIds.some((entryId) => upcomingEntryIds.has(entryId)));
  const taken = new Set(aboutUpcoming.map((ruling) => ruling.id));
  const narration = newestFirst.filter((ruling) =>
    !taken.has(ruling.id) && ruling.topics.some((topic) => topic.trim().toLowerCase() === 'narration'));
  for (const ruling of narration) taken.add(ruling.id);
  const others = newestFirst.filter((ruling) => !taken.has(ruling.id));
  const pieces = [...aboutUpcoming, ...narration, ...others].map((ruling, rulingIndex) => {
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
    fetchWith: 'read_scene opens the scene a journey was first travelled in, with its legs.',
  };
}

function lastScenesSection(index: RunIndex): SectionPlan {
  const newestFirst: SceneRecord[] = [...index.standingScenes].reverse();
  const newest = newestFirst.slice(0, NEWEST_SCENES_ALWAYS_FIRST);
  const older = newestFirst.slice(NEWEST_SCENES_ALWAYS_FIRST);
  // When room runs short a starred scene further back outranks an unstarred one.
  const chosenOrder = [...newest, ...older.filter((scene) => scene.starred), ...older.filter((scene) => !scene.starred)];
  const priorityOf = new Map(chosenOrder.map((scene, rank) => [scene.id, rank]));
  const pieces = newestFirst.map((scene, position) =>
    makePiece(
      `- Scene ${scene.number}${scene.starred ? ' (starred)' : ''}, "${onOneLine(scene.title)}", ${onOneLine(scene.whenTyped)}: `,
      onOneLine(scene.summary),
      { priority: priorityOf.get(scene.id) ?? position, position },
    ));
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
    onThePageNextSection(index, names),
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
