/**
 * Reads log.md: "# Movement" headings group scenes; each scene is "## Scene N: Title", a When
 * line, prose, and optionally a block of "> - Label: text" lines.
 */
import type { ImportedScene } from '@timeweft/contract';
import type { ClockDefinition } from './read-state.ts';
import { placeNamedIn } from './names-in-text.ts';
import { escapeForRegularExpression, linesOf, type NumberedLine } from './text-helpers.ts';

export interface LogRead {
  title: string;
  scenes: ImportedScene[];
  unplaced: string[];
}

/**
 * The longest a summary may run before it is cut back to whole sentences. A late scene's first
 * paragraph runs long, and at 600 characters the summary read as a transcript of the scene; about
 * two or three sentences is what a summary is for. The whole prose stays in the record.
 */
export const SUMMARY_LIMIT_CHARACTERS = 320;

const STAR_PATTERN = /\s*[★⭐☆✦]+\s*$/;

/**
 * The summary is the first paragraph of the scene's prose (the lines before the first blank line
 * or the first "> " line). Where that paragraph runs past the limit it is cut back to the
 * whole sentences that fit; where even the first sentence does not fit, that sentence is cut at
 * the last word boundary before the limit and ended with "...". The whole prose is in the record.
 */
export function summaryOf(firstParagraph: string): string {
  const paragraph = firstParagraph.replace(/\s+/g, ' ').trim();
  if (paragraph.length <= SUMMARY_LIMIT_CHARACTERS) return paragraph;
  const sentences = paragraph.split(/(?<=[.!?]["”’']?)\s+(?=["“'‘(]?[A-Z0-9])/);
  let summary = '';
  for (const sentence of sentences) {
    const next = summary === '' ? sentence : `${summary} ${sentence}`;
    if (next.length > SUMMARY_LIMIT_CHARACTERS) break;
    summary = next;
  }
  if (summary !== '') return summary;
  const cut = paragraph.slice(0, SUMMARY_LIMIT_CHARACTERS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()} ...`;
}

/**
 * The readings a When line gives. Only its first part (before the first "·") is read, and only
 * where it names one moment: a span ("to", "into", a slash, "Days 4-6") gives no readings, since
 * no single count is right for it. A named clock is read as "<prefix> Day N", a relative clock as
 * "day +N", each only where it appears exactly once. Where nothing can be read exactly, the
 * readings are empty and the When line is kept whole regardless. What is left of the first part
 * once the counts are taken out, such as "night", is the part of the day.
 */
export function readingsOfWhen(whenTyped: string, clocks: ClockDefinition[]): ImportedScene['readings'] {
  const firstPart = (whenTyped.split('·')[0] ?? '').trim();
  if (firstPart === '') return [];
  if (/\b(to|into|until|through)\b|\/|\d\s*[-–]\s*\d|\bdays\s+\d/i.test(firstPart)) return [];
  const relativeClocks = clocks.filter((clock) => clock.form === 'relative');
  const counts: Array<{ clock: string; count: string }> = [];
  let remainder = firstPart;
  for (const clock of clocks) {
    let pattern: RegExp;
    if (clock.form === 'named') {
      if (clock.prefixWords.length === 0) continue;
      pattern = new RegExp(`\\b${clock.prefixWords.map(escapeForRegularExpression).join('\\s+')}\\s+Day\\s+(\\d+)(?![\\d.])`, 'gi');
    } else {
      // With one relative clock any "day +N" is its; with several, its own words must stand in front.
      const prefix = relativeClocks.length === 1
        ? `(?:(?:${clock.prefixWords.map(escapeForRegularExpression).join('|') || '(?!)'})\\s+)*`
        : `${clock.prefixWords.map(escapeForRegularExpression).join('\\s+')}\\s+`;
      pattern = new RegExp(`\\b${prefix}day\\s*\\+\\s*(\\d+)(?![\\d.])`, 'gi');
    }
    const matches = [...firstPart.matchAll(pattern)];
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (!match) continue;
    counts.push({ clock: clock.name, count: match[1] ?? '' });
    remainder = remainder.replace(match[0], ' ');
  }
  if (counts.length === 0) return [];
  const partOfDay = remainder.replace(/\(\s*\)/g, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
  return counts.map((count) => ({ ...count, partOfDay: partOfDay.length <= 40 ? partOfDay : '' }));
}

interface SceneUnderConstruction {
  headingLineNumber: number;
  number: number;
  title: string;
  starred: boolean;
  movement: string | null;
  bodyLines: NumberedLine[];
}

export function readLog(text: string, clocks: ClockDefinition[], placeNames: string[]): LogRead {
  const unplaced: string[] = [];
  const scenes: ImportedScene[] = [];
  let title = '';
  let movement: string | null = null;
  let movementAnnounced = true;
  let current: SceneUnderConstruction | null = null;
  const seenNumbers = new Set<number>();
  let sawTopHeading = false;

  const finish = (): void => {
    if (current === null) return;
    scenes.push(buildScene(current, clocks, placeNames));
    current = null;
  };

  for (const line of linesOf(text)) {
    const topHeading = /^#\s+(.*)$/.exec(line.text);
    if (topHeading) {
      const headingText = (topHeading[1] ?? '').trim();
      const looksLikeTitle = /\s[-–]\s*log$/i.test(headingText) || (!sawTopHeading && !/^(movement|act|part|book)\b/i.test(headingText));
      sawTopHeading = true;
      if (looksLikeTitle && title === '') {
        title = headingText.replace(/\s*[-–]\s*log$/i, '').trim();
      } else {
        finish();
        movement = headingText;
        movementAnnounced = false;
      }
      continue;
    }
    const sceneHeading = /^##\s+Scene\b(.*)$/i.exec(line.text);
    if (sceneHeading) {
      finish();
      const rest = (sceneHeading[1] ?? '').trim();
      const numberMatch = /^(\d+)\s*(?:[:.\-–\u2014]\s*([\s\S]*))?$/.exec(rest);
      let number: number;
      let headingTitle = '';
      if (numberMatch) {
        number = Number(numberMatch[1]);
        headingTitle = (numberMatch[2] ?? '').trim();
      } else {
        const previous = scenes[scenes.length - 1];
        number = previous ? previous.number + 1 : 1;
        unplaced.push(`log.md line ${line.lineNumber}: a scene heading with no number; it was numbered ${number}, one after the scene before it.`);
      }
      if (seenNumbers.has(number)) {
        unplaced.push(`log.md line ${line.lineNumber}: scene ${number} appears more than once; both takes were read, and which stands is the author's to say.`);
      }
      seenNumbers.add(number);
      current = {
        headingLineNumber: line.lineNumber,
        number,
        title: headingTitle,
        starred: false,
        movement: movementAnnounced ? null : movement,
        bodyLines: [],
      };
      movementAnnounced = true;
      continue;
    }
    if (current !== null) {
      (current as SceneUnderConstruction).bodyLines.push(line);
      continue;
    }
    if (line.text.trim() !== '') {
      unplaced.push(`log.md line ${line.lineNumber}: a line before the first scene, which belongs to none.`);
    }
  }
  finish();
  return { title, scenes, unplaced };
}

function buildScene(scene: SceneUnderConstruction, clocks: ClockDefinition[], placeNames: string[]): ImportedScene {
  let title = scene.title;
  let lines = [...scene.bodyLines];
  // The title may stand on the line after the heading, as "N: Title".
  if (title === '') {
    const firstFilled = lines.findIndex((line) => line.text.trim() !== '');
    const titleLine = firstFilled === -1 ? undefined : lines[firstFilled];
    const titleMatch = titleLine ? /^\s*(\d+)\s*[:.\-–]\s*(.+)$/.exec(titleLine.text) : null;
    if (titleMatch && Number(titleMatch[1]) === scene.number) {
      title = (titleMatch[2] ?? '').trim();
      lines = lines.filter((_, index) => index !== firstFilled);
    }
  }
  const starred = STAR_PATTERN.test(title);
  title = title.replace(STAR_PATTERN, '').trim();
  if (title === '') title = `Scene ${scene.number}`;

  let whenTyped = '';
  const whenIndex = lines.findIndex((line) => /^\s*(?:\*\*When:?\*\*|When:)/i.test(line.text));
  if (whenIndex !== -1) {
    whenTyped = (lines[whenIndex]?.text ?? '').replace(/^\s*(?:\*\*When:?\*\*:?|When:)\s*/i, '').trim();
    lines = lines.filter((_, index) => index !== whenIndex);
  }

  const bodyText = lines.map((line) => line.text).join('\n').trim();
  const firstParagraphLines: string[] = [];
  for (const line of lines) {
    if (line.text.trim() === '') {
      if (firstParagraphLines.length > 0) break;
      continue;
    }
    if (/^\s*>/.test(line.text)) {
      if (firstParagraphLines.length > 0) break;
      continue;
    }
    firstParagraphLines.push(line.text.trim());
  }
  const whereLine = lines.find((line) => /^\s*>\s*-?\s*(?:\*\*)?Where(?:\*\*)?\s*:/i.test(line.text));
  const whereText = whereLine ? whereLine.text.replace(/^\s*>\s*-?\s*(?:\*\*)?Where(?:\*\*)?\s*:\s*/i, '') : '';
  const record = scene.movement !== null ? `Movement: ${scene.movement}\n\n${bodyText}` : bodyText;

  return {
    number: scene.number,
    title,
    starred,
    whenTyped,
    place: whereText === '' ? null : placeNamedIn(whereText, placeNames),
    summary: summaryOf(firstParagraphLines.join(' ')),
    record,
    steer: '',
    situationAfter: '',
    readings: readingsOfWhen(whenTyped, clocks),
  };
}
