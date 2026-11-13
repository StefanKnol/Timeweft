import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Refusal, type ImportedEntry, type ImportedRun, type ImportedScene, type Store } from '@timeweft/contract';
import { openStoreForTests } from './index.ts';
import { redoInput } from './demo-world.ts';

let store: Store;
let dispose: () => Promise<void>;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

function scene(number: number): ImportedScene {
  return { number, title: `Scene ${number}`, starred: false, whenTyped: `day ${number}`, place: null, summary: 'The river ran.', record: '', steer: '', situationAfter: '', readings: [] };
}

function entry(name: string, extra: Partial<ImportedEntry> = {}): ImportedEntry {
  return { name, kind: 'person', alsoKnownAs: [], pronoun: '', introducedInScene: null, visibility: 'open', facts: [], trail: [], ...extra };
}

function run(slug: string, extra: Partial<ImportedRun> = {}): ImportedRun {
  return {
    slug, title: 'The Mill', setting: 'A mill on a river.', status: 'binding', register: 'Plain past tense.',
    clocks: [{ name: 'days', countsFrom: 'the first flood' }], scenes: [scene(1), scene(2), scene(3)],
    entries: [], rulings: [], threads: [], waypoints: [], legs: [], unplaced: [], ...extra,
  };
}

test('an import chains each property oldest first, closing each at the next one\'s scene', async () => {
  const snapshot = await store.importRun(run('chained', {
    scenes: [scene(1), { ...scene(2), place: 'the mill', readings: [{ clock: 'Days', count: '2', partOfDay: 'noon' }] }, scene(3)],
    entries: [
      entry('the mill', { kind: 'place' }),
      entry('Quillet the miller', { alsoKnownAs: ['Quillet'], introducedInScene: 1, facts: [
        { property: 'where', value: 'at home', fromScene: 1, source: 'import', note: '' },
        { property: 'where', value: 'unknown when', fromScene: null, source: 'import', note: '' },
        { property: 'where', value: 'at the mill', fromScene: 3, source: 'author', note: '' },
        { property: 'mood', value: 'cheerful', fromScene: 1, source: 'import', note: '' },
      ], trail: [{ scene: 2, text: 'He ground the barley.' }] }),
    ],
    rulings: [{ text: 'Nobody swims.', source: 'author', scope: 'world', topics: ['practice'], about: ['quillet'], scene: 2 }],
    threads: [
      { text: 'Who broke the wheel?', about: ['Quillet'], openedInScene: 1, closed: false, resolution: '' },
      { text: 'Will it rain?', about: [], openedInScene: 1, closed: true, resolution: 'It rained.' },
    ],
    waypoints: [{ text: 'The wheel turns again.', reached: true }],
    legs: [{ from: 'the mill', to: 'the ford', duration: 'half a day', note: '', scene: 2 }],
  }));
  const sceneIdOf = (number: number) => snapshot.scenes.find((candidate) => candidate.number === number)!.id;
  const where = snapshot.facts.filter((fact) => fact.property === 'where');
  assert.deepEqual(where.map((fact) => [fact.value, fact.fromSceneId, fact.untilSceneId]), [
    ['at home', sceneIdOf(1), sceneIdOf(3)],
    ['unknown when', null, sceneIdOf(3)],
    ['at the mill', sceneIdOf(3), null],
  ]);
  assert.equal(snapshot.scenes[1]!.placeEntryId, snapshot.entries[0]!.id);
  assert.equal(snapshot.scenes[1]!.readings[0]!.count, '2');
  assert.equal(snapshot.notes[0]!.sceneId, sceneIdOf(2));
  assert.equal(snapshot.rulings[0]!.aboutEntryIds[0], snapshot.entries[1]!.id);
  assert.equal(snapshot.threads[1]!.closedInSceneId, sceneIdOf(3));
  assert.equal(snapshot.waypoints[0]!.reachedInSceneId, sceneIdOf(3));
  assert.equal(snapshot.legs[0]!.sceneId, sceneIdOf(2));
  assert.equal(snapshot.entries[1]!.source, 'import');
});

test('an import refuses a slug that exists, and every reference it cannot place, all at once', async () => {
  await store.importRun(run('taken'));
  await assert.rejects(store.importRun(run('taken')), Refusal);
  await assert.rejects(store.importRun(run('broken', {
    entries: [entry('Quillet', { trail: [{ scene: 9, text: 'Lost.' }] }), entry('Bram'), entry('the boatwright', { alsoKnownAs: ['bram'] })],
    threads: [{ text: 'A question.', about: ['the baker', 'Bram'], openedInScene: 7, closed: false, resolution: '' }],
  })), (error) => error instanceof Refusal
    && /scene 9/.test(error.message) && /scene 7/.test(error.message)
    && /"the baker"/.test(error.message) && /entries answer to/.test(error.message));
  const slugs = (await store.listRuns()).map((listing) => listing.run.slug);
  assert.ok(!slugs.includes('broken'), 'a refused import writes nothing');
});

test('redoing the newest imported scene takes back what that scene established', async () => {
  await store.importRun(run('redo-imported', {
    entries: [entry('Quillet', { facts: [
      { property: 'state', value: 'well', fromScene: 1, source: 'import', note: '' },
      { property: 'state', value: 'ill', fromScene: 3, source: 'import', note: '' },
    ] })],
  }));
  await store.redoScene(redoInput({ run: 'redo-imported', number: 3 }));
  const story = await store.snapshotOf('redo-imported', 'story');
  assert.deepEqual(story.facts.filter((fact) => fact.untilSceneId === null).map((fact) => fact.value), ['well']);
});

test('a run of 500 scenes, 100 entries and 20,000 facts and notes imports in a few seconds', async () => {
  const scenes = Array.from({ length: 500 }, (_, index) => scene(index + 1));
  const entries = Array.from({ length: 100 }, (_, entryIndex) => entry(`villager ${entryIndex}`, {
    facts: Array.from({ length: 100 }, (_, factIndex) => ({
      property: `property ${factIndex % 10}`, value: `value ${factIndex}`, fromScene: (factIndex * 5) % 500 + 1, source: 'import' as const, note: '',
    })),
    trail: Array.from({ length: 100 }, (_, noteIndex) => ({ scene: (noteIndex * 5) % 500 + 1, text: `Note ${noteIndex}.` })),
  }));
  const started = performance.now();
  const snapshot = await store.importRun(run('large', { scenes, entries }));
  const seconds = (performance.now() - started) / 1000;
  assert.equal(snapshot.facts.length, 10_000);
  assert.equal(snapshot.notes.length, 10_000);
  assert.equal(snapshot.facts.filter((fact) => fact.untilSceneId === null).length, 1_000);
  assert.ok(seconds < 8, `the import took ${seconds.toFixed(1)} seconds`);
});

test('an import chains each property by scene, whatever order the file gives, and never ends a fact before it begins', async () => {
  const snapshot = await store.importRun(run('out-of-order', {
    entries: [entry('Quillet', { facts: [
      { property: 'state', value: 'ill', fromScene: 3, source: 'import', note: '' },
      { property: 'state', value: 'well', fromScene: 1, source: 'import', note: '' },
      { property: 'state', value: 'mending', fromScene: null, source: 'import', note: '' },
      { property: 'state', value: 'weary', fromScene: 2, source: 'import', note: '' },
    ] })],
  }));
  const sceneIdOf = (number: number) => snapshot.scenes.find((candidate) => candidate.number === number)!.id;
  const chain = snapshot.facts.map((fact) => [fact.value, fact.fromSceneId, fact.untilSceneId]);
  // "mending" is undated and written after "ill", so it sorts after the newest scene written before
  // it and holds: nothing written before an undated fact is taken as newer than it.
  assert.deepEqual(chain, [
    ['well', sceneIdOf(1), sceneIdOf(2)],
    ['weary', sceneIdOf(2), sceneIdOf(3)],
    ['ill', sceneIdOf(3), sceneIdOf(3)],
    ['mending', null, null],
  ]);
});

test('an undated present after a stacked history keeps last place, though its neighbour is dated early', async () => {
  // As a field that stacks its history reads: older segments out of order, the undated present last.
  const snapshot = await store.importRun(run('present-last', {
    entries: [entry('Quillet', { facts: [
      { property: 'run state', value: 'at the ford', fromScene: 3, source: 'story', note: '' },
      { property: 'run state', value: 'at home', fromScene: 1, source: 'story', note: '' },
      { property: 'run state', value: 'resting at the mill', fromScene: null, source: 'story', note: '' },
    ] })],
  }));
  const holdingNow = snapshot.facts.filter((fact) => fact.untilSceneId === null).map((fact) => fact.value);
  assert.deepEqual(holdingNow, ['resting at the mill']);
});

test('an import keeps every fact of a property named "(each)" holding side by side', async () => {
  const snapshot = await store.importRun(run('each', {
    entries: [entry('Quillet', { facts: [
      { property: 'Knows (each)', value: 'the ford is shallow', fromScene: 1, source: 'import', note: '' },
      { property: 'knows (each)', value: 'the ferry leaks', fromScene: 2, source: 'import', note: '' },
    ] })],
  }));
  assert.deepEqual(snapshot.facts.map((fact) => [fact.property, fact.untilSceneId]), [['knows (each)', null], ['knows (each)', null]]);
});
