/**
 * The words a model reads. A saved scene says its number, what was written, and every collision
 * and caution in plain sentences; an id the story may not see is never turned into a name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, Refusal, type RunRecord, type SavedScene, type SceneInFull, type Store } from '@timeweft/contract';
import { importedRunInWords, runListingsInWords, savedSceneInWords, sceneInFullInWords, type NamesInTheRun } from './in-words.ts';
import { runOperation } from './operations.ts';

const SCENE_ID = '00000000-0000-4000-8000-000000000001';
const MILLER_ID = '00000000-0000-4000-8000-000000000002';
const HIDDEN_ID = '00000000-0000-4000-8000-000000000003';

const names: NamesInTheRun = {
  entryNames: new Map([[MILLER_ID, 'Odo the miller']]),
  sceneNumbers: new Map([[SCENE_ID, 4]]),
};

const saved: SavedScene = {
  scene: {
    id: SCENE_ID, runId: 'run', number: 4, title: 'The weir', starred: false, whenTyped: 'dusk', placeEntryId: null,
    summary: 's', record: '', steer: '', situationAfter: 'a', status: 'standing', readings: [], createdAt: '2026-01-01',
  },
  entriesAdded: [],
  factsWritten: [{
    id: 'f', entryId: MILLER_ID, property: 'where', value: 'at the weir', aboutEntryId: null, fromSceneId: SCENE_ID,
    untilSceneId: null, source: 'story', visibility: 'open', note: '', createdAt: '2026-01-01',
  }],
  factsUnchanged: 2,
  rulingsRecorded: [],
  threadsOpened: [],
  threadsClosed: [],
  collisions: [{
    id: 'c', runId: 'run', sceneId: SCENE_ID, entryId: HIDDEN_ID, property: 'depth', standingFactId: 'x',
    proposedValue: 'very deep', proposedAboutEntryId: null, state: 'waiting', createdAt: '2026-01-01',
  }],
  cautions: ['"the miller" already names an entry, so nothing was added.'],
};

test('a saved scene says its number, what was written, every collision and every caution', () => {
  const text = savedSceneInWords(saved, names);
  assert.match(text, /^Saved scene 4, "The weir"\./);
  assert.match(text, /- Odo the miller, where: at the weir, since scene 4/);
  assert.match(text, /2 facts already held exactly/);
  assert.match(text, /The story said the depth of an entry is "very deep", but the author stated otherwise\. The author's fact stands/);
  assert.match(text, /Caution: "the miller" already names an entry/);
  assert.doesNotMatch(text, new RegExp(HIDDEN_ID), 'an id the story cannot see was said');
});

test('an author operation is refused to a story caller before the store is touched', async () => {
  const untouchable = new Proxy({}, { get: () => { throw new Error('the store was touched'); } }) as Store;
  for (const name of Object.keys(OPERATIONS).filter((candidate) => OPERATIONS[candidate as keyof typeof OPERATIONS].audience === 'author')) {
    await assert.rejects(runOperation(untouchable, name as keyof typeof OPERATIONS, { run: 'the-ford' }, 'story'), Refusal, `${name} was not refused to a story`);
  }
});

test('a run listing says each run\'s setting and register whole, since a briefing that cut one points here', () => {
  const longRegister = 'Close third person on the baker, past tense, plain words. '.repeat(400);
  const text = runListingsInWords([{
    run: {
      id: 'run', slug: 'the-ford', title: 'The Ford', setting: 'A ford below the mill, in a wet spring.', status: 'binding',
      continuesRunId: null, register: longRegister, createdAt: '2026-01-01',
    },
    standingScenes: 2, latest: null, openThreads: 0, waitingCollisions: 0,
  }]);
  assert.ok(text.includes(longRegister.trim()), 'the register was not carried whole');
  assert.ok(text.includes('A ford below the mill, in a wet spring.'), 'the setting was not carried');
});

test('a scene read in full says the journeys first travelled in it', () => {
  const inFull: SceneInFull = {
    scene: saved.scene, entriesIntroduced: [], factsEstablished: [], notes: [], rulings: [], threadsOpened: [], threadsClosed: [],
    legs: [
      { id: 'l1', runId: 'run', fromPlace: 'the ford', toPlace: 'the mill', duration: 'half a morning', note: 'on foot, carrying flour', sceneId: SCENE_ID, createdAt: '2026-01-01' },
      { id: 'l2', runId: 'run', fromPlace: 'the mill', toPlace: 'the market', duration: 'an hour', note: '', sceneId: SCENE_ID, createdAt: '2026-01-01' },
    ],
  };
  const text = sceneInFullInWords(inFull, names);
  assert.match(text, /Journeys:\n- From the ford to the mill: half a morning \(on foot, carrying flour\)\n- From the mill to the market: an hour$/m);
});

test('an import says its counts and every unplaced line, or that every line was placed', () => {
  const run: RunRecord = { id: 'r', slug: 'the-weir', title: 'The Weir', setting: '', status: 'binding', continuesRunId: null, register: '', createdAt: '2026-01-01' };
  const counts = { scenes: 2, entries: 1, facts: 3, trailNotes: 1, rulings: 0, threads: 1, waypoints: 0, journeyLegs: 0, clocks: 1 };
  const said = importedRunInWords({ run, counts, unplaced: ['state.md, line 7: a line about the weather was not placed.'] });
  assert.match(said, /^Imported run the-weir: "The Weir"\.\n2 scenes, 1 entry, 3 facts, 1 trail note, 0 rulings, 1 thread, 0 waypoints, 0 journey legs, 1 clock\./);
  assert.match(said, /1 line could not be placed:\n- state\.md, line 7: a line about the weather was not placed\./);
  assert.match(importedRunInWords({ run, counts, unplaced: [] }), /Every line was placed\.$/);
});
