/**
 * Finds the entries a piece of text mentions, by name. A ruling or a thread says what it is about
 * only in prose, so the reader looks for the names the entry files declare.
 */
import { escapeForRegularExpression } from './text-helpers.ts';

export interface NameFinder {
  /** Every known name the text mentions, as the entry files spell it, each once, in order of appearance. */
  namesMentionedIn(text: string): string[];
}

/**
 * Names are matched whole and case-sensitively, so a plain word that happens to be a name in
 * lower case is not read as one. A name opening on "The" also matches with a small "the", since
 * prose writes "by the Ford" for an entry headed "The Ford". Names shorter than three letters are
 * skipped: they match too much.
 */
export function nameFinderFor(names: string[]): NameFinder {
  const usable = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 3))]
    .sort((left, right) => right.length - left.length);
  const patterns = usable.map((name) => {
    const spellings = [escapeForRegularExpression(name)];
    if (/^The\s/.test(name)) spellings.push(escapeForRegularExpression('the' + name.slice(3)));
    return { name, pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${spellings.join('|')})(?![\\p{L}\\p{N}])`, 'u') };
  });
  return {
    namesMentionedIn(text: string): string[] {
      const found: Array<{ name: string; index: number }> = [];
      for (const { name, pattern } of patterns) {
        const match = pattern.exec(text);
        if (match) found.push({ name, index: match.index });
      }
      found.sort((left, right) => left.index - right.index);
      return found.map((item) => item.name);
    },
  };
}

/**
 * The place a scene's "Where" line names: the known place mentioned first, case-blind, the longer
 * name winning a tie. Null where it names none of them.
 */
export function placeNamedIn(whereText: string, placeNames: string[]): string | null {
  let best: { name: string; index: number } | null = null;
  for (const name of placeNames) {
    if (name.trim().length < 3) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeForRegularExpression(name.trim())}(?![\\p{L}\\p{N}])`, 'iu');
    const match = pattern.exec(whereText);
    if (!match) continue;
    if (best === null || match.index < best.index || (match.index === best.index && name.length > best.name.length)) {
      best = { name, index: match.index };
    }
  }
  return best === null ? null : best.name;
}
