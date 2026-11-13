import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Refusal } from '@timeweft/contract';
import { millerRun } from './demo-run.ts';
import {
  factsHoldingFor, findInRun, lookUpEntry, resolveEntryByName, rulingsBearingOn, sceneInFull, standingScenesOf,
  threadsOpenFor,
} from './readers.ts';

describe('standingScenesOf', () => {
  it('lists the standing scenes oldest first and never a struck take', () => {
    const scenes = standingScenesOf(millerRun());
    assert.deepEqual(scenes.map((scene) => scene.id), ['scene-1', 'scene-2', 'scene-3']);
  });

  it('orders by number whatever order the snapshot holds them in', () => {
    const snapshot = millerRun();
    snapshot.scenes.reverse();
    assert.deepEqual(standingScenesOf(snapshot).map((scene) => scene.number), [1, 2, 3]);
  });
});

describe('factsHoldingFor', () => {
  it('serves only facts that are still open', () => {
    const values = factsHoldingFor(millerRun(), 'entry-keeper').map((fact) => fact.value);
    assert.ok(!values.includes('at the ford'), 'a closed fact is not holding');
    assert.ok(values.includes('in the mill loft'));
    assert.ok(values.includes('grateful to the miller'));
  });

  it('never serves a fact established by a struck scene', () => {
    const values = factsHoldingFor(millerRun(), 'entry-keeper').map((fact) => fact.value);
    assert.ok(!values.includes('soaked through and shaking'));
  });

  it('answers nothing for an entry with no facts', () => {
    assert.deepEqual(factsHoldingFor(millerRun(), 'entry-ford'), []);
  });
});

describe('resolveEntryByName', () => {
  it('finds an entry by its name, case-blind and trimmed', () => {
    assert.equal(resolveEntryByName(millerRun(), '  wenna THE miller ')?.id, 'entry-miller');
  });

  it('finds an entry by a name it also goes by', () => {
    assert.equal(resolveEntryByName(millerRun(), 'The Ferry Keeper')?.id, 'entry-keeper');
  });

  it('answers null for a name nothing answers to', () => {
    assert.equal(resolveEntryByName(millerRun(), 'the baker'), null);
    assert.equal(resolveEntryByName(millerRun(), '   '), null);
  });

  it('refuses a name two entries answer to, naming both', () => {
    assert.throws(() => resolveEntryByName(millerRun(), 'the boat'), (error: unknown) => {
      assert.ok(error instanceof Refusal);
      assert.match(error.message, /Ferry \(item\)/);
      assert.match(error.message, /The old raft \(item\)/);
      return true;
    });
  });
});

describe('lookUpEntry', () => {
  it('answers what holds, the latest trail newest first, and how much trail was left out', () => {
    const lookup = lookUpEntry(millerRun(), 'Bram', { withHistory: false, trail: 2 });
    assert.equal(lookup.entry.id, 'entry-keeper');
    assert.deepEqual(lookup.holding.map((fact) => fact.id).sort(), ['fact-keeper-standing', 'fact-keeper-where-2']);
    assert.deepEqual(lookup.history, []);
    assert.deepEqual(lookup.trail.map((item) => [item.note.id, item.sceneNumber]), [['note-keeper-3', 3], ['note-keeper-2', 2]]);
    assert.equal(lookup.trailLeftOut, 1, 'the struck note is not counted, only the one older note');
  });

  it('answers the closed facts, newest first, when history is asked for', () => {
    const lookup = lookUpEntry(millerRun(), 'Bram', { withHistory: true, trail: 8 });
    assert.deepEqual(lookup.history.map((fact) => fact.id), ['fact-keeper-where-1']);
    assert.equal(lookup.trailLeftOut, 0);
  });

  it('answers the open threads and the rulings in force about the entry', () => {
    const lookup = lookUpEntry(millerRun(), 'the ferry keeper', { withHistory: false, trail: 8 });
    assert.deepEqual(lookup.threads.map((thread) => thread.id), ['thread-rope']);
    assert.deepEqual(lookup.rulings.map((ruling) => ruling.id), ['ruling-2']);
  });

  it('refuses a name nothing answers to', () => {
    assert.throws(() => lookUpEntry(millerRun(), 'the baker', { withHistory: false, trail: 8 }), Refusal);
  });
});

describe('findInRun', () => {
  it('finds entries, facts, notes, scenes, rulings and threads, in that order', () => {
    const found = findInRun(millerRun(), 'FERRY', 100);
    const kinds = found.map((item) => item.kind);
    assert.deepEqual([...new Set(kinds)], ['entry', 'note', 'scene', 'ruling', 'thread']);
    assert.ok(found.some((item) => item.kind === 'entry' && item.entryName === 'Ferry'));
    assert.ok(found.some((item) => item.kind === 'scene' && item.sceneNumber === 2));
  });

  it('never finds anything from a struck scene', () => {
    assert.deepEqual(findInRun(millerRun(), 'soaked through', 100), []);
    assert.deepEqual(findInRun(millerRun(), 'threw away', 100), []);
    assert.deepEqual(findInRun(millerRun(), 'Dropped the lantern', 100), []);
    assert.deepEqual(findInRun(millerRun(), 'lantern was lost', 100), []);
  });

  it('finds a closed fact and says it no longer holds', () => {
    const found = findInRun(millerRun(), 'at the ford', 100).filter((item) => item.kind === 'fact');
    assert.equal(found.length, 1);
    assert.match(found[0]?.text ?? '', /held until scene 3/);
  });

  it('stops at the limit', () => {
    assert.equal(findInRun(millerRun(), 'the', 3).length, 3);
  });

  it('refuses empty text', () => {
    assert.throws(() => findInRun(millerRun(), '  ', 10), Refusal);
  });
});

describe('rulingsBearingOn', () => {
  it('answers every ruling in force when given nothing to filter by', () => {
    assert.deepEqual(rulingsBearingOn(millerRun(), { aboutEntryIds: [] }).map((ruling) => ruling.id), ['ruling-1', 'ruling-2']);
  });

  it('never answers a withdrawn ruling or one given in a struck scene', () => {
    const ids = rulingsBearingOn(millerRun(), { topic: 'practice', aboutEntryIds: ['entry-lantern'] }).map((ruling) => ruling.id);
    assert.deepEqual(ids, ['ruling-2']);
  });

  it('matches a topic case-blind, or an entry the ruling is about', () => {
    assert.deepEqual(rulingsBearingOn(millerRun(), { topic: 'NARRATION', aboutEntryIds: [] }).map((ruling) => ruling.id), ['ruling-1']);
    assert.deepEqual(rulingsBearingOn(millerRun(), { aboutEntryIds: ['entry-keeper'] }).map((ruling) => ruling.id), ['ruling-2']);
  });
});

describe('threadsOpenFor', () => {
  it('answers open threads only, never one opened in a struck scene, the one moved last first', () => {
    assert.deepEqual(threadsOpenFor(millerRun(), { aboutEntryIds: [], includeClosed: false }).map((thread) => thread.id), ['thread-flour', 'thread-rope']);
  });

  it('answers closed ones too when asked', () => {
    const ids = threadsOpenFor(millerRun(), { aboutEntryIds: [], includeClosed: true }).map((thread) => thread.id);
    assert.ok(ids.includes('thread-lantern'));
    assert.ok(!ids.includes('thread-struck'));
  });

  it('answers only threads touching the named entries', () => {
    assert.deepEqual(threadsOpenFor(millerRun(), { aboutEntryIds: ['entry-miller'], includeClosed: false }).map((thread) => thread.id), ['thread-flour']);
  });
});

describe('what one save wrote at one moment', () => {
  it('is read back in the order it was written, never in the order of the ids', () => {
    const run = millerRun();
    const note = run.notes[0];
    assert.ok(note);
    run.notes.push(
      { ...note, id: 'zz-written-first', text: 'She barred the sluice first.' },
      { ...note, id: 'aa-written-second', text: 'Then she lit the lamp.' },
    );
    const entry = run.entries.find((each) => each.id === note.entryId);
    assert.ok(entry);
    const trail = lookUpEntry(run, entry.name, { withHistory: false, trail: 50 }).trail.map((each) => each.note.text);
    assert.ok(trail.indexOf('Then she lit the lamp.') < trail.indexOf('She barred the sluice first.'), 'the trail is newest first, so the later written note leads');
  });
});

describe('sceneInFull', () => {
  it('answers the standing take of a scene and what it established', () => {
    const full = sceneInFull(millerRun(), 3);
    assert.equal(full.scene.id, 'scene-3');
    assert.deepEqual(full.entriesIntroduced.map((entry) => entry.id), ['entry-mill']);
    assert.deepEqual(full.factsEstablished.map((fact) => fact.id).sort(), ['fact-keeper-where-2', 'fact-lantern-held']);
    assert.deepEqual(full.notes.map((item) => item.id), ['note-keeper-3']);
    assert.deepEqual(full.threadsClosed.map((thread) => thread.id), ['thread-lantern']);
    assert.deepEqual(full.legs.map((item) => item.id), ['leg-ford-mill'], 'the journeys first travelled in it');
  });

  it('keeps what one save wrote at one moment in the order it was written, never in the order of the ids', () => {
    // An id is random, so two stores given the same scene would answer in two orders if a tie on
    // the moment were broken by it. Here the ids sort the opposite way from the written order.
    const run = millerRun();
    const mill = run.entries.find((entry) => entry.id === 'entry-mill');
    assert.ok(mill);
    run.entries.push(
      { ...mill, id: 'zz-written-first', name: 'the weir' },
      { ...mill, id: 'aa-written-second', name: 'the baker' },
    );
    const full = sceneInFull(run, 3);
    assert.deepEqual(full.entriesIntroduced.map((entry) => entry.name).slice(-2), ['the weir', 'the baker']);
  });

  it('answers the standing take where a struck take shares the number', () => {
    const full = sceneInFull(millerRun(), 2);
    assert.equal(full.scene.id, 'scene-2');
    assert.deepEqual(full.legs.map((item) => item.id), ['leg-bank-market'], 'never the struck take\'s journey');
    assert.ok(!full.factsEstablished.some((fact) => fact.id === 'fact-keeper-struck'));
    assert.deepEqual(full.threadsOpened.map((thread) => thread.id), ['thread-flour']);
  });

  it('refuses a number with no standing scene', () => {
    assert.throws(() => sceneInFull(millerRun(), 9), Refusal);
  });
});
