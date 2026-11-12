/**
 * Reads cast.md, items.md and places.md: one "## Name (pronoun) (aside)" heading per entry, with
 * "- **Label:** text" facts and "- Scene N: text" trail notes under it. places.md may also hold a
 * section of journeys, one leg per bullet or per table row.
 */
import type { EntryKind, ImportedEntry, ImportedRun, Source } from '@timeweft/contract';
import {
  bulletsOf, containsSceneReference, firstParentheticalSceneNumber, lastSceneNumberOfReference,
  leadingParenthetical, linesOf, sceneEndingSegment, saysTheAuthorGaveIt, splitStackedHistory,
  topLevelParentheticals, type NumberedLine,
} from './text-helpers.ts';

type ImportedFact = ImportedEntry['facts'][number];
type ImportedLeg = ImportedRun['legs'][number];

export interface EntriesRead {
  entries: ImportedEntry[];
  legs: ImportedLeg[];
  unplaced: string[];
}

const PRONOUN_PATTERN = /^(she|he|they|it|xe|ze|her|him|them)(\s*\/\s*(she|he|they|it|her|him|them|hers|his|theirs))*$/i;

/**
 * A cast heading names a group only where it plainly does: a collective noun (which covers "the people
 * of"), or
 * a name opening on "The" whose last word is a plural. Everything else in the cast is a person.
 */
const COLLECTIVE_WORDS = /\b(people|folk|family|clan|household|crew|guild|council|villagers|townsfolk|kin|band|company|order|tribe)\b/i;

export function castHeadingNamesAGroup(name: string): boolean {
  if (COLLECTIVE_WORDS.test(name)) return true;
  if (/^the\s/i.test(name)) {
    const lastWord = name.trim().split(/\s+/).pop() ?? '';
    return /[a-z]s$/.test(lastWord) && !/(ss|us|is)$/.test(lastWord);
  }
  return false;
}

/**
 * A parenthetical in a fact's label is a stamp when it dates the fact (a scene, a day, a part of
 * the day) or says who gave it. A stamp goes to the fact's note; anything else stays part of the
 * property, so "Who (as the miller knows her)" stays apart from "Who".
 */
export function parentheticalIsAStamp(inner: string): boolean {
  return containsSceneReference(inner)
    || /\bdays?\s*\+?\s*\d|\bday\s+\d|\b(dawn|dusk|morning|afternoon|evening|night|midday|noon|later|earlier|grey|light)\b/i.test(inner)
    || /\bauthor\b/i.test(inner);
}

interface HeadingRead {
  name: string;
  pronoun: string;
  alsoKnownAs: string[];
  asides: string[];
}

export function readEntryHeading(headingText: string): HeadingRead {
  const { inners, without } = topLevelParentheticals(headingText);
  let pronoun = '';
  const alsoKnownAs: string[] = [];
  const asides: string[] = [];
  for (const inner of inners) {
    const trimmed = inner.trim();
    const laterMatch = /^(?:later|now|also|born|formerly|once)\s+(.+)$/i.exec(trimmed);
    if (pronoun === '' && PRONOUN_PATTERN.test(trimmed)) pronoun = trimmed;
    else if (laterMatch) alsoKnownAs.push((laterMatch[1] ?? '').trim());
    else if (trimmed !== '') asides.push(trimmed);
  }
  return { name: without.trim(), pronoun, alsoKnownAs, asides };
}

/** Facts out of one labelled bullet, oldest first, history stacked in it split apart. */
export function factsOfLabelledBullet(label: string, text: string): ImportedFact[] {
  const { inners, without } = topLevelParentheticals(label);
  const stampParts: string[] = [];
  const propertyParts: string[] = [];
  for (const inner of inners) (parentheticalIsAStamp(inner) ? stampParts : propertyParts).push(inner);
  const property = [without, ...propertyParts.map((part) => `(${part})`)].join(' ').trim().toLowerCase() || 'note';
  const source: Source = stampParts.some((part) => saysTheAuthorGaveIt(part)) ? 'author' : 'story';
  const stampNote = stampParts.join('; ');
  const labelScene = stampParts.map((part) => lastSceneNumberOfReference(part)).find((number) => number !== null) ?? null;

  const segmentsNewestFirst = splitStackedHistory(text);
  const facts: ImportedFact[] = segmentsNewestFirst.map((segment, index) => {
    const value = index === 0 ? segment.replace(/^now\s*:\s*/i, '') : segment;
    const ownScene = sceneEndingSegment(value);
    // The label's stamp dates the present, the newest segment, and nothing older.
    const fromScene = ownScene ?? (index === 0 ? labelScene : null);
    return { property, value, fromScene, source, note: index === 0 ? stampNote : '' };
  });
  return facts.reverse();
}

interface FileShape {
  fileName: string;
  kindFor(name: string): EntryKind;
  allowsLegs: boolean;
}

export function readEntryFile(text: string, shape: FileShape): EntriesRead {
  const entries: ImportedEntry[] = [];
  const legs: ImportedLeg[] = [];
  const unplaced: string[] = [];
  const lines = linesOf(text);

  let currentEntry: ImportedEntry | null = null;
  let inLegs = false;
  let blockLines: NumberedLine[] = [];
  let sawTitle = false;

  const flushBlock = (): void => {
    if (inLegs) readLegLines(blockLines, shape.fileName, legs, unplaced);
    else if (currentEntry !== null) readEntryLines(blockLines, currentEntry, shape.fileName, unplaced);
    else {
      for (const line of blockLines) {
        if (line.text.trim() !== '') unplaced.push(`${shape.fileName} line ${line.lineNumber}: a line before the first entry heading, which belongs to no entry.`);
      }
    }
    blockLines = [];
  };

  for (const line of lines) {
    const titleMatch = /^#\s+(.*)$/.exec(line.text);
    if (titleMatch && !sawTitle && currentEntry === null && !inLegs) {
      sawTitle = true;
      continue;
    }
    const headingMatch = /^#{2,3}\s+(.*)$/.exec(line.text) ?? titleMatch;
    if (headingMatch) {
      flushBlock();
      const headingText = (headingMatch[1] ?? '').trim();
      if (shape.allowsLegs && /\b(journeys?|legs?)\b/i.test(headingText)) {
        inLegs = true;
        currentEntry = null;
        continue;
      }
      inLegs = false;
      const heading = readEntryHeading(headingText);
      if (heading.name === '') {
        unplaced.push(`${shape.fileName} line ${line.lineNumber}: a heading with no name, so its lines belong to no entry.`);
        currentEntry = null;
        continue;
      }
      currentEntry = {
        name: heading.name,
        kind: shape.kindFor(heading.name),
        alsoKnownAs: heading.alsoKnownAs,
        pronoun: heading.pronoun,
        introducedInScene: null,
        visibility: 'open',
        facts: heading.asides.length > 0
          ? [{ property: 'aside', value: heading.asides.join('; '), fromScene: null, source: 'story', note: 'From the heading.' }]
          : [],
        trail: [],
      };
      entries.push(currentEntry);
      continue;
    }
    blockLines.push(line);
  }
  flushBlock();

  for (const entry of entries) {
    const scenes = [...entry.trail.map((note) => note.scene), ...entry.facts.map((fact) => fact.fromScene)]
      .filter((number): number is number => number !== null);
    entry.introducedInScene = scenes.length > 0 ? Math.min(...scenes) : null;
  }
  return { entries, legs, unplaced };
}

function readEntryLines(lines: NumberedLine[], entry: ImportedEntry, fileName: string, unplaced: string[]): void {
  const { bullets, strays } = bulletsOf(lines);
  for (const stray of strays) {
    unplaced.push(`${fileName} line ${stray.lineNumber}: a line under ${'an entry'} that is not a bullet and follows none.`);
  }
  for (const bullet of bullets) {
    const boldMatch = /^\*\*(.+?)\*\*\s*:?\s*([\s\S]*)$/.exec(bullet.text);
    if (boldMatch) {
      const label = (boldMatch[1] ?? '').replace(/:\s*$/, '').trim();
      const rest = (boldMatch[2] ?? '').trim();
      if (/^Scenes?\s+\d/i.test(label)) {
        addTrailNote(entry, label, rest);
        continue;
      }
      entry.facts.push(...factsOfLabelledBullet(label, rest));
      continue;
    }
    const trailMatch = /^Scenes?\s+(\d+(?:\s*[-–]\s*\d+)?)\s*([\s\S]*)$/i.exec(bullet.text);
    if (trailMatch) {
      const reference = `Scene ${trailMatch[1] ?? ''}`;
      let rest = (trailMatch[2] ?? '').trim();
      let stamp = '';
      const parenthetical = leadingParenthetical(rest);
      if (parenthetical) {
        stamp = parenthetical.inner.trim();
        rest = parenthetical.rest.trim();
      }
      rest = rest.replace(/^[:.\-–]\s*/, '');
      addTrailNote(entry, reference, stamp === '' ? rest : `(${stamp}) ${rest}`);
      continue;
    }
    // A plain "- Label: text" bullet: a short label before the first colon, with no sentence in it.
    const plainMatch = /^([^:\n]{1,80}):\s*([\s\S]*)$/.exec(bullet.text);
    if (plainMatch && !/[.!?]\s/.test(plainMatch[1] ?? '') && !(plainMatch[1] ?? '').trim().startsWith('(')) {
      entry.facts.push(...factsOfLabelledBullet((plainMatch[1] ?? '').trim(), (plainMatch[2] ?? '').trim()));
      continue;
    }
    const scene = firstParentheticalSceneNumber(bullet.text) ?? lastSceneNumberOfReference(bullet.text);
    if (scene !== null) {
      entry.trail.push({ scene, text: bullet.text.trim() });
      continue;
    }
    unplaced.push(`${fileName} line ${bullet.lineNumber}: a bullet with neither a label nor a scene number, so it is neither a fact nor a trail note.`);
  }
}

function addTrailNote(entry: ImportedEntry, reference: string, text: string): void {
  const scene = lastSceneNumberOfReference(reference);
  if (scene === null) return;
  // A range is kept in the text, since the note is filed under its last scene alone.
  const isRange = /\d\s*[-–]\s*\d/.test(reference);
  entry.trail.push({ scene, text: isRange ? `(${reference.trim()}) ${text}` : text });
}

const SPAN_PATTERN = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|several|few)\b[\w\s'-]{0,16}?\b(minutes?|hours?|days?|nights?|weeks?|months?|years?|seasons?|turns?|watches?)\b/i;

/**
 * The duration of a leg: the first part of its text (split on semicolons) that states a span, such
 * as "two days on foot". Where no part does, the first part. The whole text is kept as the note.
 */
export function durationOfLegText(text: string): string {
  const parts = text.split(';').map((part) => part.trim()).filter((part) => part !== '');
  return parts.find((part) => SPAN_PATTERN.test(part)) ?? parts[0] ?? '';
}

function readLegLines(lines: NumberedLine[], fileName: string, legs: ImportedLeg[], unplaced: string[]): void {
  const tableLines = lines.filter((line) => /^\s*\|/.test(line.text));
  for (const line of tableLines) {
    const cells = line.text.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) continue;
    if (/^leg$/i.test(cells[0] ?? '')) continue;
    const fromAndTo = splitFromAndTo(cells[0] ?? '');
    if (fromAndTo === null) {
      unplaced.push(`${fileName} line ${line.lineNumber}: a row of the legs table whose first cell does not read "From to To".`);
      continue;
    }
    legs.push({
      from: fromAndTo.from,
      to: fromAndTo.to,
      duration: cells[1] ?? '',
      note: [fromAndTo.means, cells[2] ?? ''].filter((part) => part !== '').join('; '),
      scene: lastSceneNumberOfReference(cells[3] ?? '') ?? (/^\d+$/.test(cells[3] ?? '') ? Number(cells[3]) : null),
    });
  }
  const { bullets, strays } = bulletsOf(lines.filter((line) => !/^\s*\|/.test(line.text)));
  for (const stray of strays) {
    unplaced.push(`${fileName} line ${stray.lineNumber}: a line among the legs that is neither a leg nor part of one.`);
  }
  for (const bullet of bullets) {
    const match = /^([^:\n]+?):\s*([\s\S]*)$/.exec(bullet.text);
    const label = (match?.[1] ?? '').trim();
    const { inners, without } = topLevelParentheticals(label);
    const fromAndTo = match ? splitFromAndTo(without) : null;
    if (!match || fromAndTo === null) {
      unplaced.push(`${fileName} line ${bullet.lineNumber}: a bullet among the legs that does not read "From to To: duration".`);
      continue;
    }
    const text = (match[2] ?? '').trim();
    const labelScene = inners.map((inner) => lastSceneNumberOfReference(inner)).find((number) => number !== null) ?? null;
    const labelAsides = inners.filter((inner) => !containsSceneReference(inner));
    legs.push({
      from: fromAndTo.from,
      to: fromAndTo.to,
      duration: durationOfLegText(text),
      note: [fromAndTo.means, ...labelAsides, text].filter((part) => part !== '').join('; '),
      scene: labelScene ?? firstParentheticalSceneNumber(text),
    });
  }
}

/** "The mill to the ford, on foot" reads as from "The mill", to "the ford", by "on foot". */
export function splitFromAndTo(label: string): { from: string; to: string; means: string } | null {
  const match = /^(.+?)\s+to\s+(.+)$/.exec(label.trim());
  if (!match) return null;
  const from = (match[1] ?? '').trim();
  const destination = (match[2] ?? '').trim();
  const commaIndex = destination.indexOf(',');
  const to = commaIndex === -1 ? destination : destination.slice(0, commaIndex).trim();
  const means = commaIndex === -1 ? '' : destination.slice(commaIndex + 1).trim();
  if (from === '' || to === '') return null;
  return { from, to, means };
}

export function readCast(text: string): EntriesRead {
  return readEntryFile(text, {
    fileName: 'cast.md',
    kindFor: (name) => (castHeadingNamesAGroup(name) ? 'group' : 'person'),
    allowsLegs: false,
  });
}

export function readItems(text: string): EntriesRead {
  return readEntryFile(text, { fileName: 'items.md', kindFor: () => 'item', allowsLegs: false });
}

export function readPlaces(text: string): EntriesRead {
  return readEntryFile(text, { fileName: 'places.md', kindFor: () => 'place', allowsLegs: true });
}
