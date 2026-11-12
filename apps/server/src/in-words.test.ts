/**
 * The words a model reads. A saved scene says its number, what was written, and every collision
 * and caution in plain sentences; an id the story may not see is never turned into a name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, Refusal, type SavedScene, type Store } from '@timeweft/contract';
import { savedSceneInWords, type NamesInTheRun } from './in-words.ts';
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
