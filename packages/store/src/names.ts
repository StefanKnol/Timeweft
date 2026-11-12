/**
 * Finding an entry by what somebody called it. A name is not a key: it is matched case-blind and
 * trimmed against an entry's name and every other name it goes by, within one run. Where two
 * entries answer, the caller is told both, since guessing would attach a fact to the wrong one.
 */
import { Refusal } from '@timeweft/contract';

export interface NameableEntry {
  id: string;
  name: string;
  alsoKnownAs: string[];
}

export function normaliseName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export class NameIndex<Entry extends NameableEntry> {
  private readonly entriesByName = new Map<string, Entry[]>();

  constructor(entries: Iterable<Entry> = []) {
    for (const entry of entries) this.add(entry);
  }

  add(entry: Entry): void {
    const names = new Set([entry.name, ...entry.alsoKnownAs].map(normaliseName).filter((name) => name !== ''));
    for (const name of names) {
      const holders = this.entriesByName.get(name) ?? [];
      if (!holders.some((holder) => holder.id === entry.id)) holders.push(entry);
      this.entriesByName.set(name, holders);
    }
  }

  /** Every entry answering to the name. */
  find(name: string): Entry[] {
    return this.entriesByName.get(normaliseName(name)) ?? [];
  }

  /** The one entry answering to the name. `where` says where it was named, for the refusal. */
  resolve(name: string, where: string): Entry {
    const holders = this.find(name);
    const [only] = holders;
    if (only === undefined) {
      throw new Refusal(`Nothing in this run is called "${name.trim()}" (named ${where}). Introduce it in the scene's entries, or use a name it already goes by.`);
    }
    if (holders.length > 1) throw new Refusal(twoAnswerTo(name, holders, where));
    return only;
  }

  /** Like resolve, but nothing answering is an answer of its own rather than a refusal. */
  resolveIfAny(name: string, where: string): Entry | null {
    const holders = this.find(name);
    if (holders.length > 1) throw new Refusal(twoAnswerTo(name, holders, where));
    return holders[0] ?? null;
  }
}

function twoAnswerTo(name: string, holders: NameableEntry[], where: string): string {
  const described = holders.map((holder) => `"${holder.name}" (id ${holder.id})`).join(' and ');
  return `More than one entry answers to "${name.trim()}" (named ${where}): ${described}. Use a name only one of them goes by.`;
}
