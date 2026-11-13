/**
 * Reads state.md: the clocks, where things stand, the standing rulings, the threads, the
 * waypoints and the canon the run coined. Each "## " section is read by what its heading says.
 */
import type { ImportedRuling, ImportedRun } from '@timeweft/contract';
import type { NameFinder } from './names-in-text.ts';
import {
  bulletsOf, firstParentheticalSceneNumber, lastSceneNumberOfReference,
  escapeForRegularExpression, leadingParenthetical, linesOf, presentOf, saysTheAuthorGaveIt, type NumberedLine,
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
  /**
   * The present for the last scene: the Current situation section, or the Clock section's
   * "Current:" bullet where there is no such section, after the Clock section's lines that are
   * not bullets, less their sentences that carry a count on a kept clock. The Clock section's
   * other bullets go to the setting, never here.
   */
  situation: string;
  /** Standing lines about the run's world, such as "Universe age: ...", for the run's setting. */
  settingLines: string[];
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
    clocks: [], situation: '', settingLines: [], register: '', rulings: [], threads: [], waypoints: [],
    runStateLines: [], stackedHistoryBytes: 0, stackedHistoryLines: [], unplaced: [],
  };
  const { sections, before } = sectionsOf(text);
  for (const line of before) {
    if (line.text.trim() !== '' && !/^#\s/.test(line.text)) {
      read.unplaced.push(`state.md line ${line.lineNumber}: a line before the first section, which belongs to none.`);
    }
  }
  let clockRead: ClockSectionRead = { current: null, situationLines: [] };
  let currentSituation = '';
  for (const section of sections) {
    const heading = section.heading.toLowerCase();
    if (/^clock/.test(heading)) clockRead = readClockSection(section, read);
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
  // Two hand-kept copies of the present drift apart, so one is kept: the section, which says more.
  let presentLine = currentSituation;
  if (clockRead.current !== null) {
    if (currentSituation === '') presentLine = `Current: ${clockRead.current.text}`;
    else {
      read.unplaced.push(`state.md line ${clockRead.current.lineNumber}: the Clock section's "Current:" line was not carried into the situation, since the Current situation section says the present and two copies of it drift apart.`);
    }
  }
  read.situation = [clockRead.situationLines.join('\n'), presentLine].filter((part) => part !== '').join('\n\n');
  return read;
}

interface ClockSectionRead {
  current: { text: string; lineNumber: number } | null;
  situationLines: string[];
}

/** Words a named clock's bullet may open on to say whether it runs, which describe no day. */
const CLOCK_STATUS_WORDS = /^(running|stopped|paused|started|frozen|ticking|halted|still)[.!]?$/i;

/** Sentences, split after a full stop, a question or an exclamation followed by a space. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=\S)/).map((sentence) => sentence.trim()).filter((sentence) => sentence !== '');
}

/** A sentence that describes the days-after reckoning rather than a named clock's own Day 1. */
function describesTheRelativeReckoning(sentence: string): boolean {
  return /\brelative to\b/i.test(sentence) && !/\bDay\s+1\s*=/i.test(sentence);
}

/**
 * Whether a sentence carries a count read off a kept clock: "day +N" with N above zero, or "<named
 * prefix> Day N" that is not a definition ("Mill Day 1 = ..."). Such a sentence was true when it
 * was written and is not true now; the scenes' readings carry the clocks.
 */
function carriesAClockCount(sentence: string, namedPrefixes: string[][]): boolean {
  if (/\bday\s*\+\s*0*[1-9]/i.test(sentence)) return true;
  return namedPrefixes.some((words) => new RegExp(`\\b${words.map(escapeForRegularExpression).join('\\s+')}\\s+Day\\s+\\d+(?!\\s*=)(?!\\d|\\.\\d)`, 'i').test(sentence));
}

/**
 * The Clock section holds four kinds of bullet, each read by what it says:
 *
 * - "Current:" is a copy of the present, kept for the situation only where no Current situation
 *   section says it.
 * - "<words> clock:" defines a named clock. Its description is its sentences from the one that
 *   defines Day 1, less a leading word saying whether it runs (a clock that is not running keeps
 *   "(stopped)" after its description) and less any sentence that describes the days-after
 *   reckoning, which goes to that clock's description instead.
 * - "Run began:" (or "Began:", "Run start:") is day +0 of the days-after reckoning: that clock
 *   counts from it. Where the section writes no "day +N" there is no such clock, and the line
 *   goes to the run's setting instead.
 * - A line that is not a bullet is part of the present, less its sentences that carry a count on
 *   a kept clock, which are left out and said once in `unplaced` as below.
 * - Any other bullet is a standing line about the run. Its sentences that carry a count on a kept
 *   clock ("seventy days since the eve, day +70") were true when written and are left out, said
 *   once in `unplaced`, since the scenes' readings carry the clocks and an old count beside them
 *   contradicts the present. The rest of it goes to the run's setting, where it does not age.
 */
function readClockSection(section: Section, read: StateRead): ClockSectionRead {
  const { bullets, strays } = bulletsOf(section.lines);
  const sectionRead: ClockSectionRead = { current: null, situationLines: [] };
  const relativeSentences: string[] = [];
  let runBegan: { label: string; value: string } | null = null;
  const otherBullets: Array<{ label: string; value: string; lineNumber: number }> = [];
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
      sectionRead.current = { text: present, lineNumber: bullet.lineNumber };
      continue;
    }
    const namedClockMatch = /^(.+?)\s+clock$/i.exec(label);
    if (namedClockMatch) {
      const sentences = sentencesOf(value);
      let stopped = false;
      while (sentences.length > 0 && CLOCK_STATUS_WORDS.test(sentences[0] ?? '')) {
        if (!/^(running|started|ticking)/i.test(sentences[0] ?? '')) stopped = true;
        sentences.shift();
      }
      const own = sentences.filter((sentence) => !describesTheRelativeReckoning(sentence));
      relativeSentences.push(...sentences.filter(describesTheRelativeReckoning));
      const dayOne = own.findIndex((sentence) => /\bDay\s+1\s*=/i.test(sentence));
      const description = (dayOne === -1 ? own : own.slice(dayOne)).join(' ');
      read.clocks.push({
        name: label,
        countsFrom: [description, stopped ? '(stopped)' : ''].filter((part) => part !== '').join(' '),
        form: 'named',
        prefixWords: (namedClockMatch[1] ?? '').trim().split(/\s+/),
      });
      continue;
    }
    if (match && /^(?:run\s+)?(?:began|begins|start|started|starts)$/i.test(label)) {
      runBegan = { label, value: value.replace(/[.;]+$/, '').trim() };
      continue;
    }
    otherBullets.push({ label: match ? label : '', value: match ? value : bullet.text.trim(), lineNumber: bullet.lineNumber });
  }
  const namedPrefixes = read.clocks.filter((clock) => clock.form === 'named').map((clock) => clock.prefixWords);
  // A line that is not a bullet is read as part of the present, and like the other bullets it
  // loses its sentences that carry a count on a kept clock: a count written once is not the present.
  for (const stray of strays) {
    const sentences = sentencesOf(stray.text.trim());
    const kept = sentences.filter((sentence) => !carriesAClockCount(sentence, namedPrefixes));
    if (kept.length < sentences.length) {
      read.unplaced.push(`state.md line ${stray.lineNumber}: ${sentences.length - kept.length === 1 ? 'a sentence' : `${sentences.length - kept.length} sentences`} of a Clock section line that carry a count on a kept clock were left out of the present, since the scenes' readings carry the clocks and a count written once does not move with them.`);
    }
    if (kept.length > 0) sectionRead.situationLines.push(kept.join(' '));
  }
  for (const other of otherBullets) {
    const sentences = sentencesOf(other.value);
    const kept = sentences.filter((sentence) => !carriesAClockCount(sentence, namedPrefixes));
    if (kept.length < sentences.length) {
      read.unplaced.push(`state.md line ${other.lineNumber}: ${sentences.length - kept.length === 1 ? 'a sentence' : `${sentences.length - kept.length} sentences`} of the Clock section's ${other.label === '' ? 'line' : `"${other.label}" line`} that carry a count on a kept clock were left out of the run, since the scenes' readings carry the clocks and a count written once does not move with them.`);
    }
    if (kept.length === 0) continue;
    const keptText = kept.join(' ');
    read.settingLines.push(other.label === '' ? keptText : `${other.label}: ${keptText}`);
  }
  const relativeClockMade = addRelativeClock(section, read, runBegan?.value ?? null, relativeSentences);
  // With no "day +N" anywhere there is no days-after clock to count from the run's start, so the
  // start is kept as a standing line about the run rather than dropped.
  if (!relativeClockMade && runBegan !== null && runBegan.value !== '') read.settingLines.push(`${runBegan.label}: ${runBegan.value}`);
  return sectionRead;
}

/**
 * A relative clock counts days after an event and is written "day +N". Its name is the words in
 * front of the first "day +N" written in a parenthesis or after an equals sign in the Clock
 * section, such as "(home day +4)" giving "home"; where none stand there, it is "days after".
 *
 * Its description is what day +0 is (the "Run began:" line) and the sentences elsewhere that
 * describe the reckoning ("scenes are stamped relative to the flood"). It is never read from the
 * present, which stacks its own dated history, nor from a count written once, nor from a named
 * clock's own definition. The name looks at the clock-defining bullets first and at the present
 * only where they name nothing.
 */
function addRelativeClock(section: Section, read: StateRead, runBegan: string | null, describingSentences: string[]): boolean {
  const { bullets, strays } = bulletsOf(section.lines);
  const wholeText = section.lines.map((line) => line.text).join('\n');
  if (!/\bday\s*\+\s*\d/i.test(wholeText)) return false;
  const definingText = [
    ...strays.map((stray) => stray.text.trim()),
    ...bullets.filter((bullet) => !/^\*{0,2}current\*{0,2}\s*:/i.test(bullet.text.trim())).map((bullet) => bullet.text),
  ].join('\n');
  const prefixPattern = /[(=]\s*([A-Za-z][A-Za-z'’ ]{0,40}?)\s+day\s*\+\s*\d/i;
  const prefixMatch = prefixPattern.exec(definingText) ?? prefixPattern.exec(wholeText);
  const prefixWords = prefixMatch ? (prefixMatch[1] ?? '').trim().split(/\s+/).filter((word) => !/^(the|a|an)$/i.test(word)) : [];
  const description = [
    runBegan === null ? '' : `Days after ${runBegan}, written "day +N".`,
    ...describingSentences.map((sentence) => sentence.trim()),
  ].filter((part) => part !== '').join(' ');
  read.clocks.push({
    name: prefixWords.length > 0 ? prefixWords.join(' ') : 'days after',
    countsFrom: description || 'Days after an event, written "day +N".',
    form: 'relative',
    prefixWords,
  });
  return true;
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
    const closure = closureOfThread(text);
    read.threads.push({
      text,
      about: names.namesMentionedIn(text),
      openedInScene: openedSceneOfThread(text),
      closed: closure !== null,
      resolution: closure ?? '',
    });
  }
}

/**
 * A scene named where it says when a thread opened: at the head of the bullet ("Scene 12: ..."),
 * or after a word that says the thread began there ("raised in Scene 12", "since Scene 12"). A
 * scene named after any other word is not read, since "before Scene 12" or "by Scene 12" is a
 * deadline, which says nothing about where the thread opened.
 */
const SCENE_A_THREAD_OPENED_IN = /(?:^[\s*_]*|\b(?:raised|opened|begun|began|begins|started|starts|first\s+(?:named|raised|seen|said)|noticed|since|from)\b[\s:,]*(?:in\s+|at\s+)?)\(?\s*Scenes?\s+(\d+)/i;

/**
 * The scene a thread was opened in, where its text says it: the first parenthetical naming a
 * scene (its last scene, for a range), or else a scene named at the head of the bullet or after a
 * word saying the thread began there, read for its first scene. A scene named only as a deadline
 * ("before Scene 10") does not date the thread. A thread that says no such scene answers null
 * here; the caller may still date it by a clock count it names.
 */
export function openedSceneOfThread(text: string): number | null {
  const parenthetical = firstParentheticalSceneNumber(text);
  if (parenthetical !== null) return parenthetical;
  const match = SCENE_A_THREAD_OPENED_IN.exec(text);
  return match ? Number(match[1]) : null;
}

const CLOSING_MARKER = '(?:closed|resolved|done)';

/** A scene named after an ending marker: "(Scene 12)", ", Scene 12", "in Scene 12", "Scenes 4-6". */
const TRAILING_SCENE_NOTE = '(?:\\s*[,:\\-–\\u2014]?\\s*\\(?\\s*(?:in\\s+|at\\s+)?Scenes?\\s+\\d+(?:\\s*(?:[-–]|to|,|and)\\s*\\d+)*\\s*\\)?)?';

/** A parenthetical scene note that may stand between a marker after a label and its separator. */
const PARENTHETICAL_SCENE_NOTE = '(?:\\s*\\(\\s*(?:in\\s+|at\\s+)?Scenes?\\s+[^)]*\\))?';

/**
 * Bold, italics and strike-through, taken off so that a marker written "**Done**", "*Closed.*" or
 * "_Resolved_" reads as the marker. An underscore is taken off only at a word's edge, where it is
 * emphasis, never inside a word.
 */
function withoutEmphasis(text: string): string {
  return text
    .replace(/~~/g, '')
    .replace(/\*+/g, '')
    .replace(/(^|[\s(\[])_+/g, '$1')
    .replace(/_+(?=$|[\s.,;:!?)\]])/g, '')
    .trim();
}

/**
 * Whether a thread bullet says it is closed, and if so its resolution. Three shapes count, each
 * with bold, italics and strike-through stripped first:
 *
 * - the marker opens the bullet ("Closed: ...", "**Done** ...");
 * - the marker opens the text after a short leading label of at most sixty characters with no
 *   sentence in it ("The debt: resolved; ..."), the resolution being the text after the marker.
 *   It counts only where the marker is followed, past an optional "(Scene N)", by the end of the
 *   text or by a separator (a colon, a dash, a semicolon or a full stop): "The weir: closed sluices
 *   keep the pond full" is a thread about something closed, not a closed thread;
 * - the marker ends the bullet, after a sentence end, a dash, a comma, "(" or "[", optionally
 *   followed by a scene note ("... found in the reeds. Closed.", "... - resolved, Scene 12.",
 *   "... (closed)", "... [closed in Scene 12]"), the resolution being everything before it. A
 *   hyphen counts as a dash only with a space before it, so "half-done." is not a closing.
 *
 * A marker inside a sentence ("is not resolved.", "was all done.") is never read as closing,
 * because a negation or a passing remark reads exactly the same there.
 */
export function closureOfThread(bulletText: string): string | null {
  const plain = withoutEmphasis(bulletText);
  const leading = new RegExp(`^${CLOSING_MARKER}\\b\\s*[:.\\-–\\u2014;,]?\\s*([\\s\\S]*)$`, 'i').exec(plain);
  if (leading) return (leading[1] ?? '').trim();
  const afterLabel = new RegExp(
    `^([^:.;!?\\n]{1,60}):\\s*${CLOSING_MARKER}\\b(?=${PARENTHETICAL_SCENE_NOTE}\\s*(?:$|[:.\\-–\\u2014;]))\\s*[:.\\-–\\u2014;]?\\s*([\\s\\S]*)$`,
    'i',
  ).exec(plain);
  if (afterLabel) {
    const after = (afterLabel[2] ?? '').trim();
    return after === '' ? (afterLabel[1] ?? '').trim() : after;
  }
  const ending = new RegExp(
    `(^[(\\[]\\s*|[.;:!?)\\]]\\s+|(?:\\s+[-–\\u2014]|\\s*[–\\u2014]|,)\\s*|\\s+[(\\[]\\s*)${CLOSING_MARKER}${TRAILING_SCENE_NOTE}\\s*[.!]?\\s*[)\\]]?\\s*[.!]?\\s*$`,
    'i',
  ).exec(plain);
  if (ending) {
    // Everything before the marker, less the dash, comma or bracket that set the marker off.
    return plain.slice(0, ending.index + (ending[1] ?? '').length).replace(/[\s\-–\u2014,(\[]+$/, '').trim();
  }
  return null;
}

function readWaypointSection(section: Section, read: StateRead): void {
  const { bullets, strays } = bulletsOf(section.lines);
  for (const stray of strays) read.unplaced.push(`state.md line ${stray.lineNumber}: a line among the waypoints that is not a bullet.`);
  for (const bullet of bullets) {
    const text = bullet.text.trim();
    // Reached where the bullet says so at its start, crosses itself out, or says anywhere that it
    // was played, reached or done in a scene ("Played Scene 12", "(reached Scene 30)", "done in
    // Scene 40"). The scene number is what keeps "has played the fiddle before" from counting.
    const reached = /^(?:~~|\(?\s*reached\b|\(?\s*done\b)/i.test(text)
      || /\b(?:played|reached|done)\b[\s:,]*(?:in\s+|at\s+)?\(?\s*Scenes?\s+\d/i.test(text);
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

