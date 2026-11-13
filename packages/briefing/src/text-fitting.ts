/**
 * Measuring and cutting text by its size in UTF-8 bytes.
 *
 * A briefing promises a size in bytes, not in characters, because what a chat pays for is bytes on
 * the wire. So every measure here is `Buffer.byteLength`, and a cut never splits a character.
 */
import { Buffer } from 'node:buffer';

/** What a cut field ends with, so the model reading it knows it did not see the whole. */
export const CUT_MARKER = ' … [cut]';

/** Below this much kept text a cut says nothing useful, so the field is left out instead. */
export const SMALLEST_USEFUL_CUT_BYTES = 12;

export function byteLengthOf(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Folds every run of white space into one space, so a field fits on one line of a list. */
export function onOneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The longest start of `text` that is at most `maximumBytes` long in UTF-8, ending on a whole
 * character. Only the start of the text is encoded, since a field may be half a megabyte.
 */
function startWithinBytes(text: string, maximumBytes: number): string {
  // Each UTF-16 unit is at least one byte, so this many units hold at least maximumBytes bytes.
  let candidate = text.slice(0, maximumBytes + 2);
  const lastUnit = candidate.charCodeAt(candidate.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) candidate = candidate.slice(0, -1);
  const encoded = Buffer.from(candidate, 'utf8');
  if (encoded.length <= maximumBytes) return candidate;
  let end = maximumBytes;
  // A byte of the form 10xxxxxx continues a character; stepping back off it keeps characters whole.
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return encoded.subarray(0, end).toString('utf8');
}

/**
 * Cuts `text` so that, with the cut marker, it is at most `maximumBytes` long. It cuts at the end
 * of a sentence where one falls in the latter half of what fits, else at a space, and only inside
 * a single word where the kept text has no space at all. Answers the text unchanged where it
 * already fits, and null where too little would be left to be worth serving.
 */
export function cutToFit(text: string, maximumBytes: number): string | null {
  if (byteLengthOf(text) <= maximumBytes) return text;
  const room = maximumBytes - byteLengthOf(CUT_MARKER);
  if (room < SMALLEST_USEFUL_CUT_BYTES) return null;
  const start = startWithinBytes(text, room);
  let kept = start;
  let lastSentenceEnd = -1;
  for (const match of start.matchAll(/[.!?]["')\]]*(?=\s)/g)) {
    lastSentenceEnd = match.index + match[0].length;
  }
  if (lastSentenceEnd >= start.length / 2) {
    kept = start.slice(0, lastSentenceEnd);
  } else {
    const lastSpace = Math.max(start.lastIndexOf(' '), start.lastIndexOf('\n'), start.lastIndexOf('\t'));
    if (lastSpace > 0) kept = start.slice(0, lastSpace);
  }
  kept = kept.trimEnd();
  if (byteLengthOf(kept) < SMALLEST_USEFUL_CUT_BYTES) return null;
  return kept + CUT_MARKER;
}

/** What stands between the opening and the ending of a text shown by its two ends. */
export const MIDDLE_LEFT_OUT_MARKER = ' … [middle left out] … ';

/**
 * A long text by its two ends: how it opens and how it now ends, with the middle left out and
 * said so. A text that grew by being added to says what it is about at its start and where it
 * stands at its end, so cutting only the tail would keep the oldest part and lose the newest.
 * The ending gets the larger share. Both ends break at a space. A text that fits is returned whole.
 */
export function openingAndEndingOf(text: string, maximumBytes: number): string {
  if (byteLengthOf(text) <= maximumBytes) return text;
  const room = maximumBytes - byteLengthOf(MIDDLE_LEFT_OUT_MARKER);
  if (room < 2) return cutToFit(text, maximumBytes) ?? '';
  const openingRoom = Math.floor(room * 0.4);
  const endingRoom = room - openingRoom;
  const characters = [...text];
  let opening = '';
  for (const character of characters) {
    if (byteLengthOf(opening + character) > openingRoom) break;
    opening += character;
  }
  const lastSpaceOfOpening = opening.lastIndexOf(' ');
  if (lastSpaceOfOpening > 0) opening = opening.slice(0, lastSpaceOfOpening);
  let ending = '';
  for (let position = characters.length - 1; position >= 0; position -= 1) {
    const character = characters[position] ?? '';
    if (byteLengthOf(character + ending) > endingRoom) break;
    ending = character + ending;
  }
  const firstSpaceOfEnding = ending.indexOf(' ');
  if (firstSpaceOfEnding >= 0 && firstSpaceOfEnding < ending.length - 1) ending = ending.slice(firstSpaceOfEnding + 1);
  return `${opening.trimEnd()}${MIDDLE_LEFT_OUT_MARKER}${ending.trimStart()}`;
}
