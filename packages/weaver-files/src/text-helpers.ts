/**
 * Small readers shared by the five file readers: lines, bullets, parentheses and scene numbers.
 * Each is forgiving on purpose: the files were kept by hand for hundreds of scenes, and an odd
 * line is reported by the caller rather than thrown.
 */

export interface NumberedLine {
  /** One-based, as an editor shows it, so an "unplaced" sentence can point at it. */
  lineNumber: number;
  text: string;
}

export function linesOf(text: string): NumberedLine[] {
  if (text === '') return [];
  return text.split(/\r?\n/).map((line, index) => ({ lineNumber: index + 1, text: line }));
}

export function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function escapeForRegularExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A bullet and the lines that continue it. A line that is neither a bullet nor blank, and that
 * follows a bullet, is read as a continuation of that bullet: the files wrap a long bullet onto an
 * indented line now and then.
 */
export interface Bullet {
  lineNumber: number;
  /** The bullet's text without its leading "- ", continuation lines joined with a newline. */
  text: string;
}

export interface BulletsAndStrays {
  bullets: Bullet[];
  /** Non-blank lines that are not bullets and follow no bullet. */
  strays: NumberedLine[];
}

export function bulletsOf(lines: NumberedLine[]): BulletsAndStrays {
  const bullets: Bullet[] = [];
  const strays: NumberedLine[] = [];
  let current: Bullet | null = null;
  for (const line of lines) {
    const bulletMatch = /^\s{0,3}[-*]\s+(.*)$/.exec(line.text);
    if (bulletMatch) {
      current = { lineNumber: line.lineNumber, text: (bulletMatch[1] ?? '').trimEnd() };
      bullets.push(current);
      continue;
    }
    if (line.text.trim() === '') {
      current = null;
      continue;
    }
    if (current !== null) {
      current.text += '\n' + line.text.trim();
    } else {
      strays.push(line);
    }
  }
  return { bullets, strays };
}

/**
 * Reads a parenthetical at the start of a text, counting depth so that a parenthesis inside it
 * does not end it early. Answers null where the text does not open with one or never closes it.
 */
export function leadingParenthetical(text: string): { inner: string; rest: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('(')) return null;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return { inner: trimmed.slice(1, index), rest: trimmed.slice(index + 1) };
    }
  }
  return null;
}

/** Every top-level parenthetical in a text, and the text with them taken out. */
export function topLevelParentheticals(text: string): { inners: string[]; without: string } {
  const inners: string[] = [];
  let without = '';
  let depth = 0;
  let inner = '';
  for (const character of text) {
    if (character === '(') {
      if (depth > 0) inner += character;
      depth += 1;
      continue;
    }
    if (character === ')' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        inners.push(inner);
        inner = '';
      } else {
        inner += character;
      }
      continue;
    }
    if (depth > 0) inner += character;
    else without += character;
  }
  // An unclosed parenthesis keeps its text rather than losing it.
  if (depth > 0) without += '(' + inner;
  return { inners, without: without.replace(/\s{2,}/g, ' ').trim() };
}

/**
 * The scene a reference names. A range or a list names its last scene, since that is where the
 * stated thing was last true: "(Scenes 4-6)" and "(Scenes 4, 6)" both answer 6.
 */
const sceneReferencePattern = /\bScenes?\s+(\d+)((?:\s*(?:[-–]|to|,|and)\s*\d+)*)/i;

export function lastSceneNumberOfReference(text: string): number | null {
  const match = sceneReferencePattern.exec(text);
  if (!match) return null;
  const numbers = [match[1] ?? '', ...((match[2] ?? '').match(/\d+/g) ?? [])].map(Number);
  const last = numbers[numbers.length - 1];
  return last === undefined || !Number.isFinite(last) ? null : last;
}

export function containsSceneReference(text: string): boolean {
  return sceneReferencePattern.test(text);
}

/** The first parenthetical in a text that names a scene, read for its last scene number. */
export function firstParentheticalSceneNumber(text: string): number | null {
  for (const inner of topLevelParentheticals(text).inners) {
    const number = lastSceneNumberOfReference(inner);
    if (number !== null) return number;
  }
  return null;
}

/**
 * The scene a segment of stacked history is dated to: a parenthetical naming a scene at its very
 * end, or a segment opening on "Scene N". A scene named in the middle of a segment is cited by
 * it, not the scene it became true at, so it is not read.
 */
export function sceneEndingSegment(segment: string): number | null {
  const trimmed = segment.trim().replace(/[.;,\s]+$/, '');
  if (trimmed.endsWith(')')) {
    let depth = 0;
    for (let index = trimmed.length - 1; index >= 0; index -= 1) {
      const character = trimmed[index];
      if (character === ')') depth += 1;
      if (character === '(') {
        depth -= 1;
        if (depth === 0) {
          const number = lastSceneNumberOfReference(trimmed.slice(index + 1, trimmed.length - 1));
          if (number !== null) return number;
          break;
        }
      }
    }
  }
  if (/^Scenes?\s+\d/i.test(trimmed)) return lastSceneNumberOfReference(trimmed);
  return sceneOfLeadingPhrase(trimmed);
}

/**
 * The scene a segment's leading phrase is dated to, in the common shape "At the mill (Scene 7):
 * grinding". The leading phrase is the text before the first colon outside any parenthesis, at most
 * eighty characters and holding no sentence end of its own; it counts only where a parenthetical
 * naming a scene is the last thing in it. Read only where nothing at the segment's end dates it.
 */
export function sceneOfLeadingPhrase(segment: string): number | null {
  const colonIndex = firstTopLevelColon(segment);
  if (colonIndex === -1 || colonIndex > 80) return null;
  const phrase = segment.slice(0, colonIndex).trim();
  if (!phrase.endsWith(')')) return null;
  const { inners, without } = topLevelParentheticals(phrase);
  if (/[.!?;]/.test(without)) return null;
  const last = inners[inners.length - 1];
  return last === undefined ? null : lastSceneNumberOfReference(last);
}

function firstTopLevelColon(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') depth += 1;
    else if (character === ')' && depth > 0) depth -= 1;
    else if (character === ':' && depth === 0) return index;
  }
  return -1;
}

/**
 * Splits text that stacks its own history, newest first, as "now... Before: ... Earlier: ...".
 * A marker counts only at the start of a sentence (after a full stop, a semicolon, a closing
 * bracket or quote), so "before" inside a sentence is left alone. Answers the segments newest
 * first, exactly as written.
 */
const stackedHistoryMarker = /(?<=[.;!?)"”’]\s+)(?:Before that|Before|Earlier|Previously)\s*[:,]\s*/g;

/**
 * Two rules keep a newer fact from being filed as older, because a hand-kept field does not always
 * stay newest first after its first marker:
 *
 * - An older segment ends at the next history marker or at the next labelled clause, a sentence
 *   opening on a short phrase dated by its closing parenthetical ("On the bank (Scene 12): ...")
 *   or on "Scene N:". The clause stands as an older segment of its own.
 * - A segment after a marker whose own scene is later than the present's is not older at all: it
 *   is kept with the present, appended in the order written, so nothing it says closes anything.
 *
 * The present's scene is the one its own text gives, or `presentSceneWhereUndated` where its text
 * gives none (a label's stamp, say). With neither, nothing can be compared and the order written
 * is trusted.
 */
export function splitStackedHistory(text: string, options: { presentSceneWhereUndated?: number | null } = {}): string[] {
  const split = splitStackedHistoryDated(text, options);
  return [[split.present, ...split.keptWithThePresent].join(' '), ...split.olderNewestFirst];
}

/** A field's stacked history, with the present's own scene kept apart from what is kept with it. */
export interface StackedHistory {
  /** The present as its own text, before the first history marker. */
  present: string;
  /**
   * The present's own scene: the one its text gives, or `presentSceneWhereUndated`. A segment kept
   * with the present never dates it, since that would date the present by something said later
   * and keep the value before it holding until then.
   */
  presentScene: number | null;
  /** Segments after a marker that date themselves after the present, in the order written. */
  keptWithThePresent: string[];
  olderNewestFirst: string[];
}

export function splitStackedHistoryDated(text: string, options: { presentSceneWhereUndated?: number | null } = {}): StackedHistory {
  const segments = text.split(stackedHistoryMarker).map((segment) => segment.trim()).filter((segment) => segment !== '');
  if (segments.length === 0) {
    const present = text.trim();
    return { present, presentScene: sceneEndingSegment(present) ?? options.presentSceneWhereUndated ?? null, keptWithThePresent: [], olderNewestFirst: [] };
  }
  const [present = '', ...olderParts] = segments;
  const older = olderParts.flatMap(splitAtLabelledClauses);
  const presentScene = sceneEndingSegment(present) ?? options.presentSceneWhereUndated ?? null;
  const keptWithThePresent: string[] = [];
  const olderNewestFirst: string[] = [];
  for (const segment of older) {
    const scene = sceneEndingSegment(segment);
    if (presentScene !== null && scene !== null && scene > presentScene) keptWithThePresent.push(segment);
    else olderNewestFirst.push(segment);
  }
  return { present, presentScene, keptWithThePresent, olderNewestFirst };
}

const sentenceStartPattern = /(?<=[.;!?)"”’]\s+)\S/g;

function splitAtLabelledClauses(segment: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  sentenceStartPattern.lastIndex = 0;
  for (const match of segment.matchAll(sentenceStartPattern)) {
    const rest = segment.slice(match.index);
    const opensALabelledClause = sceneOfLeadingPhrase(rest) !== null || /^Scenes?\s+\d[^:.;]{0,20}:/i.test(rest);
    if (!opensALabelledClause) continue;
    pieces.push(segment.slice(start, match.index).trim());
    start = match.index;
  }
  pieces.push(segment.slice(start).trim());
  return pieces.filter((piece) => piece !== '');
}

/** The present of a field that stacks its history, and the bytes of history after it. */
export function presentOf(text: string): { present: string; stackedBytes: number } {
  stackedHistoryMarker.lastIndex = 0;
  const match = stackedHistoryMarker.exec(text);
  stackedHistoryMarker.lastIndex = 0;
  if (!match) return { present: text.trim(), stackedBytes: 0 };
  return { present: text.slice(0, match.index).trim(), stackedBytes: byteLengthOf(text.slice(match.index)) };
}

/** Words the author used to mark something as theirs, as against something marked for them. */
export function saysTheAuthorGaveIt(text: string): boolean {
  if (/\bfor (?:the )?author\b/i.test(text)) return false;
  return /\bauthor\b/i.test(text);
}
