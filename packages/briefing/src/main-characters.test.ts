/**
 * The people a chat may attach from a run: the main character first, as the briefing decides it,
 * then the people with the longest trails.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EntryNoteRecord, EntryRecord, RunSnapshot } from '@timeweft/contract';
import { buildBriefing } from './briefing.ts';
import { entry, generateLongRun, millerRun, note } from './demo-run.ts';
import { PEOPLE_BESIDE_THE_MAIN_CHARACTER, mainCharactersOf } from './main-characters.ts';
import { lookUpEntry, lookUpEntryById } from './readers.ts';

/** A run of the demo world whose entries and trail notes are given, on the miller run's scenes. */
function runWith(entries: EntryRecord[], notes: EntryNoteRecord[]): RunSnapshot {
  return { ...millerRun(), entries, notes, facts: [], rulings: [], threads: [] };
}

/** So many trail notes for one entry, each in a standing scene of the miller run. */
function trailOf(entryId: string, count: number): EntryNoteRecord[] {
  const standingScenes = ['scene-1', 'scene-2', 'scene-3'];
  return Array.from({ length: count }, (_, noteIndex) => note({
    id: `note-${entryId}-${noteIndex}`, entryId, sceneId: standingScenes[noteIndex % standingScenes.length]!, text: `Note ${noteIndex}.`,
  }));
}

function namesOf(entries: EntryRecord[]): string[] {
  return entries.map((item) => item.name);
}

describe('mainCharactersOf', () => {
  it('puts the main character first, then the people with the longest trails, places and things left out', () => {
    const entries = [
      entry({ id: 'entry-ford', name: 'The ford', kind: 'place' }),
      entry({ id: 'entry-baker', name: 'Hild the baker' }),
      entry({ id: 'entry-miller', name: 'Wenna the miller' }),
      entry({ id: 'entry-carter', name: 'Ansel the carter' }),
    ];
    const notes = [...trailOf('entry-ford', 2), ...trailOf('entry-baker', 5), ...trailOf('entry-miller', 3), ...trailOf('entry-carter', 1)];
    assert.deepEqual(namesOf(mainCharactersOf(runWith(entries, notes))), ['Hild the baker', 'Wenna the miller', 'Ansel the carter']);
  });

  it('leads with the same entry the briefing serves first when no names are given', () => {
    const run = generateLongRun({ seed: 417, scenes: 120 });
    const briefing = buildBriefing(run, { upcoming: [], budgetBytes: 20000 });
    const firstOnThePage = /## On the page next\n[^\n]*\n### ([^(\n]+) \(/.exec(briefing.text)?.[1]?.trim();
    const [leading] = mainCharactersOf(run);
    assert.ok(leading);
    assert.equal(leading.name, firstOnThePage);
  });

  it('lists ten people beside the main character, the people with no trail after every person with one', () => {
    const entries = Array.from({ length: 14 }, (_, position) => entry({ id: `entry-person-${position}`, name: `Person ${String(position).padStart(2, '0')}` }));
    const notes = entries.slice(0, 12).flatMap((person, position) => trailOf(person.id, 20 - position));
    const listed = mainCharactersOf(runWith(entries, notes));
    assert.equal(listed.length, 1 + PEOPLE_BESIDE_THE_MAIN_CHARACTER);
    assert.deepEqual(namesOf(listed), entries.slice(0, 11).map((person) => person.name));
    const fewTrails = mainCharactersOf(runWith(entries, trailOf('entry-person-5', 1)));
    assert.equal(fewTrails[0]?.name, 'Person 05');
    assert.deepEqual(namesOf(fewTrails).slice(1, 4), ['Person 00', 'Person 01', 'Person 02'], 'no trail ranks by name');
  });

  it('breaks a tie by name and then by the order written, never by id', () => {
    const entries = [
      entry({ id: 'entry-zz', name: 'Odo' }),
      entry({ id: 'entry-aa', name: 'Odo' }),
      entry({ id: 'entry-mm', name: 'Bran' }),
    ];
    const notes = [...trailOf('entry-zz', 2), ...trailOf('entry-aa', 2), ...trailOf('entry-mm', 2)];
    assert.deepEqual(mainCharactersOf(runWith(entries, notes)).map((item) => item.id), ['entry-mm', 'entry-zz', 'entry-aa']);
  });

  it('takes the main character written first where two share the longest trail and a name, never the lower id', () => {
    const entries = [entry({ id: 'entry-zz', name: 'Odo' }), entry({ id: 'entry-aa', name: 'Odo' })];
    const notes = [...trailOf('entry-zz', 3), ...trailOf('entry-aa', 3)];
    assert.equal(mainCharactersOf(runWith(entries, notes))[0]?.id, 'entry-zz');
  });

  it('counts only standing trail notes: a note in a struck take does not lengthen a trail', () => {
    const entries = [entry({ id: 'entry-baker', name: 'Hild the baker' }), entry({ id: 'entry-miller', name: 'Wenna the miller' })];
    const struck = Array.from({ length: 5 }, (_, noteIndex) => note({ id: `note-struck-${noteIndex}`, entryId: 'entry-baker', sceneId: 'scene-2-struck', text: 'Thrown away.' }));
    const listed = mainCharactersOf(runWith(entries, [...struck, ...trailOf('entry-baker', 1), ...trailOf('entry-miller', 2)]));
    assert.deepEqual(namesOf(listed), ['Wenna the miller', 'Hild the baker']);
  });

  it('leaves a main character who is not a person out of a list of people', () => {
    const entries = [entry({ id: 'entry-ford', name: 'The ford', kind: 'place' }), entry({ id: 'entry-baker', name: 'Hild the baker' })];
    assert.deepEqual(namesOf(mainCharactersOf(runWith(entries, [...trailOf('entry-ford', 4), ...trailOf('entry-baker', 1)]))), ['Hild the baker']);
  });
});

describe('lookUpEntryById', () => {
  it('answers what look_up answers by name, and tells apart two people who share a name', () => {
    const run = millerRun();
    assert.deepEqual(lookUpEntryById(run, 'entry-keeper', { withHistory: false, trail: 8 }), lookUpEntry(run, 'Bram', { withHistory: false, trail: 8 }));
    const twins = runWith([entry({ id: 'entry-first', name: 'Odo' }), entry({ id: 'entry-second', name: 'Odo' })], trailOf('entry-second', 1));
    assert.equal(lookUpEntryById(twins, 'entry-second', { withHistory: false, trail: 8 })?.trail.length, 1);
    assert.equal(lookUpEntryById(twins, 'entry-first', { withHistory: false, trail: 8 })?.trail.length, 0);
    assert.equal(lookUpEntryById(run, 'entry-not-in-the-run', { withHistory: false, trail: 8 }), null);
  });
});
