/**
 * The people a chat may attach from a run: the main character first, as the briefing decides it,
 * then the people with the longest trails. Pure, like everything in this package: the same
 * snapshot always answers the same list.
 */
import type { EntryRecord, RunSnapshot } from '@timeweft/contract';
import { compareText, indexRun, mainCharacterInIndex, trailCountOf, writtenPositionsOfEntries } from './run-index.ts';

/** How many people are listed beside the main character. */
export const PEOPLE_BESIDE_THE_MAIN_CHARACTER = 10;

/**
 * The main character, where they are a person, and then up to `peopleBeside` other people, the
 * longest standing trail first, ties going to the name that sorts first and then to the one
 * written first, never to an id. A person with no trail is listed after every person with one.
 * Only people are listed, since what is attached is a person's page; a main character who is a
 * place or a thing is left out rather than listed under people.
 */
export function mainCharactersOf(snapshot: RunSnapshot, peopleBeside: number = PEOPLE_BESIDE_THE_MAIN_CHARACTER): EntryRecord[] {
  const index = indexRun(snapshot);
  const writtenPosition = writtenPositionsOfEntries(index);
  const mainCharacter = mainCharacterInIndex(index);
  const leading = mainCharacter !== undefined && mainCharacter.kind === 'person' ? [mainCharacter] : [];
  const others = snapshot.entries
    .filter((entry) => entry.kind === 'person' && entry.id !== mainCharacter?.id)
    .sort((left, right) => trailCountOf(index, right.id) - trailCountOf(index, left.id)
      || compareText(left.name, right.name)
      || (writtenPosition.get(left.id) ?? 0) - (writtenPosition.get(right.id) ?? 0))
    .slice(0, Math.max(0, Math.floor(peopleBeside)));
  return [...leading, ...others];
}
