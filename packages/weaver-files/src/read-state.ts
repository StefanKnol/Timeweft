/**
 * Reads state.md: the clocks, where things stand, the standing rulings, the threads, the
 * waypoints and the canon the run coined. Each "## " section is read by what its heading says.
 */
import type { ImportedRuling, ImportedRun } from '@timeweft/contract';
import type { NameFinder } from './names-in-text.ts';
import {
  bulletsOf, firstParentheticalSceneNumber, lastSceneNumberOfReference,
  leadingParenthetical, linesOf, presentOf, saysTheAuthorGaveIt, type NumberedLine,
} from './text-helpers.ts';

/** A clock read out of the Clock section, with what it takes to read it off a scene's When line. */
export interface ClockDefinition {
  name: string;
  countsFrom: string;
  /**
   * `named`: read as "<prefix> Day N", such as "Mill Day 12" for a clock labelled "Mill clock".
   * `relative`: read as "day +N", days counted after an event.
   */
  form: 'named' | 'relative';
  /** The words in front of "Day N" or "day +N". */
  prefixWords: string[];
}

export interface RunStateLine {
  label: string;
  text: string;
  lineNumber: number;
}

export interface StateRead {
  clocks: ClockDefinition[];
  /** The present, read from the Clock section and Current situation, for the last scene. */
  situation: string;
  register: string;
  rulings: ImportedRuling[];
  threads: ImportedRun['threads'];
  waypoints: ImportedRun['waypoints'];
  /** "- Label: text" lines of the run-specific state, for the caller to file under entries. */
  runStateLines: RunStateLine[];
  stackedHistoryBytes: number;
  /** Where the stacked history was cut, as line numbers, for the one sentence that reports it. */
  stackedHistoryLines: number[];
  unplaced: string[];
}

interface Section {
  heading: string;
  headingLineNumber: number;
  lines: NumberedLine[];
}

function sectionsOf(text: string): { sections: Section[]; before: NumberedLine[] } {
  const sections: Section[] = [];
  const before: NumberedLine[] = [];
  for (const line of linesOf(text)) {
    const match = /^##\s+(.*)$/.exec(line.text);
    if (match) {
      sections.push({ heading: (match[1] ?? '').trim(), headingLineNumber: line.lineNumber, lines: [] });
      continue;
    }
    const last = sections[sections.length - 1];
    if (last) last.lines.push(line);
    else before.push(line);
  }
  return { sections, before };
}

/**
 * Topics come from plain keywords, so the same ruling always gets the same topics:
 * - narration: narrat-, prose, tense, register, wording, on the page
 * - point of view: point of view, POV, head-hopping, first person, third person
 * - time: clock, time, timeline, day +N, days, hours, seasons
 * - naming: name, names, named, naming, called
 * A ruling matching none has no topics.
 */
export function topicsOf(text: string): string[] {
  const topics: string[] = [];
  if (/\bnarrat|\bprose\b|\btense\b|\bregister\b|\bwording\b|\bon the page\b/i.test(text)) topics.push('narration');
  if (/\bpoint of view\b|\bpov\b|\bhead-?hop|\bfirst person\b|\bthird person\b/i.test(text)) topics.push('point of view');
  if (/\bclocks?\b|\btime\b|\btimeline\b|\bday\s*\+\s*\d|\bdays?\b|\bhours?\b|\bseasons?\b/i.test(text)) topics.push('time');
  if (/\bnam(?:e|es|ed|ing)\b|\bcalled\b/i.test(text)) topics.push('naming');
  return topics;
}

/**
 * The scene a standing ruling was given at, from its leading parenthetical: "(Scene 12, ...)" and
 * "(After Scene 12, ...)" give 12, a range its last scene. "(Before Scene 12, ...)" gives none,
 * since which scene came just before is not said.
 */
export function sceneOfRulingPrefix(prefix: string): number | null {
  const trimmed = prefix.trim();
  if (/^before\b/i.test(trimmed)) return null;
  if (!/^(?:after\s+)?scenes?\s+\d/i.test(trimmed)) return null;
  return lastSceneNumberOfReference(trimmed);
}

/** A standing ruling is the author's where it is quoted, or where its label says the author gave it. */
export function sourceOfStandingRuling(bulletText: string): 'author' | 'story' {
  const trimmed = bulletText.trim();
  if (/^["“]/.test(trimmed)) return 'author';
  if (/^author ruling\b/i.test(trimmed)) return 'author';
  const prefix = leadingParenthetical(trimmed);
  if (prefix && saysTheAuthorGaveIt(prefix.inner)) return 'author';
  return 'story';
}

/**
 * A coined-canon bullet is the author's where its own label (the text before its first colon)
 * says so, as "AUTHOR RULING" or "(author, Scene 9)" do, and the story's otherwise: most are
 * marked "Invented". A label that only flags something "for the author" is the story's.
 */
export function sourceOfCoinedCanon(bulletText: string): 'author' | 'story' {
  const trimmed = bulletText.trim();
  if (/^["“]/.test(trimmed)) return 'author';
  const colonIndex = trimmed.indexOf(':');
  const label = colonIndex === -1 ? trimmed.slice(0, 80) : trimmed.slice(0, colonIndex);
  return saysTheAuthorGaveIt(label) ? 'author' : 'story';
}

export function readState(text: string, names: NameFinder): StateRead {
  const read: StateRead = {
    clocks: [], situation: '', register: '', rulings: [], threads: [], waypoints: [],
    runStateLines: [], stackedHistoryBytes: 0, stackedHistoryLines: [], unplaced: [],
  };
  const { sections, before } = sectionsOf(text);
  for (const line of before) {
    if (line.text.trim() !== '' && !/^#\s/.test(line.text)) {
      read.unplaced.push(`state.md line ${line.lineNumber}: a line before the first section, which belongs to none.`);
    }
  }
  let clockSituation = '';
  let currentSituation = '';
  for (const section of sections) {
    const heading = section.heading.toLowerCase();
    if (/^clock/.test(heading)) clockSituation = readClockSection(section, read);
    else if (/situation/.test(heading)) currentSituation = readSituationSection(section, read);
    else if (/ruling/.test(heading)) readRulingSection(section, read, names, 'run');
    else if (/canon/.test(heading)) readRulingSection(section, read, names, 'world');
    else if (/thread/.test(heading)) readThreadSection(section, read, names);
    else if (/waypoint/.test(heading)) readWaypointSection(section, read);
    else if (/run-specific|run specific/.test(heading)) readRunStateSection(section, read);
    else if (/register|narration/.test(heading)) read.register = section.lines.map((line) => line.text).join('\n').trim();
    else if (/^names used/.test(heading)) {
      const count = section.lines.filter((line) => line.text.trim() !== '').length;
      if (count > 0) {
        read.unplaced.push(`state.md lines ${section.headingLineNumber}-${section.headingLineNumber + section.lines.length}: the ${count} lines of the names list were not carried, since it is an aid for choosing names and every name that matters is an entry.`);
      }
    } else {
      for (const line of section.lines) {
        if (line.text.trim() !== '') read.unplaced.push(`state.md line ${line.lineNumber}: a line in a section whose heading the reader does not know.`);
      }
    }
  }
  read.situation = [clockSituation, currentSituation].filter((part) => part !== '').join('\n\n');
  return read;
}

function readClockSection(section: Section, read: StateRead): string {
  const { bullets, strays } = bulletsOf(section.lines);
  const situationLines: string[] = [];
  for (const stray of strays) situationLines.push(stray.text.trim());
  for (const bullet of bullets) {
    const match = /^\*{0,2}([^:\n]{1,60}?)\*{0,2}:\*{0,2}\s*([\s\S]*)$/.exec(bullet.text);
    const label = (match?.[1] ?? '').trim();
    const value = (match?.[2] ?? bullet.text).trim();
    if (/^current$/i.test(label)) {
      const { present, stackedBytes } = presentOf(value);
      if (stackedBytes > 0) {
        read.stackedHistoryBytes += stackedBytes;
        read.stackedHistoryLines.push(bullet.lineNumber);
      }
      situationLines.push(`Current: ${present}`);
      continue;
    }
    const namedClockMatch = /^(.+?)\s+clock$/i.exec(label);
    if (namedClockMatch) {
      read.clocks.push({
        name: label,
        countsFrom: value,
        form: 'named',
        prefixWords: (namedClockMatch[1] ?? '').trim().split(/\s+/),
      });
      continue;
    }
    situationLines.push(match ? `${label}: ${value}` : bullet.text.trim());
  }
  addRelativeClock(section, read);
  return situationLines.join('\n');
}

/**
 * A relative clock counts days after an event and is written "day +N". Its name is the words in
 * front of the first "day +N" written in a parenthesis or after an equals sign in the Clock
 * section, such as "(home day +4)" giving "home"; where none stand there, it is "days after".
 */
function addRelativeClock(section: Section, read: StateRead): void {
  const text = section.lines.map((line) => line.text).join('\n');
  if (!/\bday\s*\+\s*\d/i.test(text)) return;
  const prefixMatch = /[(=]\s*([A-Za-z][A-Za-z'’ ]{0,40}?)\s+day\s*\+\s*\d/i.exec(text);
  const prefixWords = prefixMatch ? (prefixMatch[1] ?? '').trim().split(/\s+/).filter((word) => !/^(the|a|an)$/i.test(word)) : [];
  const explaining = text.split(/(?<=[.;])\s+|\n/).filter((sentence) => /relative to|day\s*\+\s*\d/i.test(sentence) && !/^\s*-\s*current\b/i.test(sentence));
  read.clocks.push({
    name: prefixWords.length > 0 ? prefixWords.join(' ') : 'days after',
    countsFrom: explaining.map((sentence) => sentence.replace(/^\s*-\s*/, '').trim()).join(' ') || 'Days after an event, written "day +N".',
    form: 'relative',
    prefixWords,
  });
}

function readSituationSection(section: Section, read: StateRead): string {
  const text = section.lines.map((line) => line.text).join('\n').trim();
  if (text === '') return '';
  const { present, stackedBytes } = presentOf(text);
  if (stackedBytes > 0) {
    read.stackedHistoryBytes += stackedBytes;
    read.stackedHistoryLines.push(section.headingLineNumber);
  }
  return present;
}

function readRulingSection(section: Section, read: StateRead, names: NameFinder, scope: 'run' | 'world'): void {
  const { bullets, strays } = bulletsOf(section.lines);
  for (const stray of strays) {
    // A numbered list is how the description writes rulings; read "1. text" as a bullet.
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(stray.text);
    if (numbered) {
      bullets.push({ lineNumber: stray.lineNumber, text: (numbered[1] ?? '').trim() });
      continue;
    }
    read.unplaced.push(`state.md line ${stray.lineNumber}: a line among the rulings that is not a bullet.`);
  }
  bullets.sort((left, right) => left.lineNumber - right.lineNumber);
  for (const bullet of bullets) {
    const text = bullet.text.trim();
    if (text === '') continue;
    let scene: number | null;
    let source: 'author' | 'story';
    if (scope === 'run') {
      const prefix = leadingParenthetical(text);
      scene = prefix ? sceneOfRulingPrefix(prefix.inner) : null;
      source = sourceOfStandingRuling(text);
    } else {
      const colonIndex = text.indexOf(':');
      const label = colonIndex === -1 ? '' : text.slice(0, colonIndex);
      scene = firstParentheticalSceneNumber(label) ?? (label === '' ? null : lastSceneNumberOfReference(label));
      source = sourceOfCoinedCanon(text);
    }
    const topics = scope === 'world' ? ['coined', ...topicsOf(text)] : topicsOf(text);
    read.rulings.push({ text, source, scope, topics, about: names.namesMentionedIn(text), scene });
  }
}

function readThreadSection(section: Section, read: StateRead, names: NameFinder): void {
  const { bullets, strays } = bulletsOf(section.lines);
  for (const stray of strays) read.unplaced.push(`state.md line ${stray.lineNumber}: a line among the threads that is not a bullet.`);
  for (const bullet of bullets) {
    const text = bullet.text.trim();
    const closedMatch = /^(?:~~)?\s*(?:\*\*)?(closed|resolved|done)\b(?:\*\*)?\s*[:.\-–]?\s*([\s\S]*)$/i.exec(text);
    read.threads.push({
      text,
      about: names.namesMentionedIn(text),
      openedInScene: firstParentheticalSceneNumber(text),
      closed: closedMatch !== null,
      resolution: closedMatch ? (closedMatch[2] ?? '').replace(/~~/g, '').trim() : '',
    });
  }
}

function readWaypointSection(section: Section, read: StateRead): void {
  const { bullets, strays } = bulletsOf(section.lines);
  for (const stray of strays) read.unplaced.push(`state.md line ${stray.lineNumber}: a line among the waypoints that is not a bullet.`);
  for (const bullet of bullets) {
    const text = bullet.text.trim();
    // Reached only where the bullet says so at its start, or crosses itself out.
    const reached = /^(?:~~|\(?\s*reached\b|\(?\s*done\b)/i.test(text);
    read.waypoints.push({ text, reached });
  }
}

function readRunStateSection(section: Section, read: StateRead): void {
  const { bullets, strays } = bulletsOf(section.lines);
  for (const stray of strays) read.unplaced.push(`state.md line ${stray.lineNumber}: a line in the run-specific state that is not a bullet.`);
  for (const bullet of bullets) {
    const match = /^\*{0,2}([^:\n]{1,60}?)\*{0,2}:\*{0,2}\s*([\s\S]*)$/.exec(bullet.text.trim());
    if (!match) {
      read.unplaced.push(`state.md line ${bullet.lineNumber}: a line in the run-specific state with no "Name:" label, so it is about nobody the reader can name.`);
      continue;
    }
    read.runStateLines.push({ label: (match[1] ?? '').trim(), text: (match[2] ?? '').trim(), lineNumber: bullet.lineNumber });
  }
}

