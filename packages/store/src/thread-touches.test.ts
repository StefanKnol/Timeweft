/**
 * A scene may touch an open thread, which moves it on without opening or closing it. The touch is a
 * row of its own, so a redone take's touch stops counting while the row is kept, and the scene a
 * thread was last touched in is derived from the standing scenes whenever the run is read.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Refusal, type ImportedRun, type ImportedScene, type Store } from '@timeweft/contract';
import { openStoreForTests } from './index.ts';
import { beginDemoRun, redoInput, sceneInput } from './demo-world.ts';
import { threadFromRow, type ThreadRow } from './rows.ts';

let store: Store;
let dispose: () => Promise<void>;
let runCounter = 0;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

async function runWithAnOpenThread(): Promise<{ slug: string; threadId: string }> {
  runCounter += 1;
  const slug = `touches-${runCounter}`;
  await beginDemoRun(store, slug);
  const first = await store.saveScene(sceneInput({
    run: slug, threadsOpened: [{ text: 'Who will mend the mill wheel?' }],
  }));
  return { slug, threadId: first.threadsOpened[0]!.id };
}

async function threadAsServed(slug: string, threadId: string) {
  const snapshot = await store.snapshotOf(slug, 'story');
  const thread = snapshot.threads.find((candidate) => candidate.id === threadId)!;
  const numberOf = (sceneId: string | null) => snapshot.scenes.find((scene) => scene.id === sceneId)?.number ?? null;
  return { thread, numberOf };
}

test('a thread with no touches was last touched in the scene it opened in', async () => {
  const { slug, threadId } = await runWithAnOpenThread();
  await store.saveScene(sceneInput({ run: slug }));
  const { thread, numberOf } = await threadAsServed(slug, threadId);
  assert.equal(numberOf(thread.lastTouchedInSceneId), 1);
  assert.deepEqual(thread.touches, []);
});

test('a scene that touches a thread becomes the scene it was last touched in, and its note is served with it', async () => {
  const { slug, threadId } = await runWithAnOpenThread();
  await store.saveScene(sceneInput({ run: slug }));
  const saved = await store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: threadId, note: 'The baker found a spare spoke.' }] }));
  assert.deepEqual(saved.threadsTouched.map((thread) => thread.id), [threadId]);
  assert.equal(saved.threadsTouched[0]!.lastTouchedInSceneId, saved.scene.id);
  await store.saveScene(sceneInput({ run: slug }));
  const { thread, numberOf } = await threadAsServed(slug, threadId);
  assert.equal(numberOf(thread.lastTouchedInSceneId), 3);
  assert.deepEqual(thread.touches.map((touch) => [numberOf(touch.sceneId), touch.note]), [[3, 'The baker found a spare spoke.']]);
  assert.equal(thread.closedInSceneId, null, 'a touch neither opens nor closes');
});

test('closing a thread counts as touching it, and touching and closing in one scene is allowed', async () => {
  const { slug, threadId } = await runWithAnOpenThread();
  await store.saveScene(sceneInput({ run: slug }));
  const closing = await store.saveScene(sceneInput({
    run: slug,
    threadsTouched: [{ thread: threadId, note: 'The spoke was fitted.' }],
    threadsClosed: [{ thread: threadId, resolution: 'The wheel turns.' }],
  }));
  assert.equal(closing.threadsClosed[0]!.lastTouchedInSceneId, closing.scene.id);
  assert.deepEqual(closing.threadsTouched, [], 'a thread closed in the scene is said as closed, not again as touched');
  const second = await runWithAnOpenThread();
  await store.saveScene(sceneInput({ run: second.slug }));
  const onlyClosed = await store.saveScene(sceneInput({ run: second.slug, threadsClosed: [{ thread: second.threadId, resolution: 'Nobody did.' }] }));
  assert.equal(onlyClosed.threadsClosed[0]!.lastTouchedInSceneId, onlyClosed.scene.id);
});

test('a touch of a closed thread, an unknown one or another run\'s is refused by name, and nothing is saved', async () => {
  const { slug, threadId } = await runWithAnOpenThread();
  const other = await runWithAnOpenThread();
  await assert.rejects(store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: other.threadId }] })),
    (error) => error instanceof Refusal && error.message.includes(`no thread with the id "${other.threadId}"`));
  await assert.rejects(store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: 'not-an-id' }] })),
    (error) => error instanceof Refusal && error.message.includes('no thread with the id "not-an-id"'));
  await store.saveScene(sceneInput({ run: slug, threadsClosed: [{ thread: threadId, resolution: 'Mended.' }] }));
  await assert.rejects(store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: threadId }] })),
    (error) => error instanceof Refusal && error.message.includes('"Who will mend the mill wheel?" is closed'));
  await assert.rejects(store.saveScene(sceneInput({ run: other.slug, threadsTouched: [{ thread: other.threadId }, { thread: other.threadId }] })),
    (error) => error instanceof Refusal && /touched twice/.test(error.message));
  const scenes = (await store.snapshotOf(slug, 'story')).scenes;
  assert.deepEqual(scenes.map((scene) => scene.number), [1, 2], 'a refused save writes no scene');
});

test('a redo of the newest scene: the struck take\'s touch stops counting and the new take\'s counts', async () => {
  const { slug, threadId } = await runWithAnOpenThread();
  await store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: threadId, note: 'First word of it.' }] }));
  await store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: threadId, note: 'The earlier take.' }] }));
  await store.redoScene(redoInput({ run: slug, number: 3 }));
  let served = await threadAsServed(slug, threadId);
  assert.equal(served.numberOf(served.thread.lastTouchedInSceneId), 2, 'the redone take did not touch it, so scene 2 is its last touch');
  assert.deepEqual(served.thread.touches.map((touch) => touch.note), ['First word of it.']);
  const author = (await store.snapshotOf(slug, 'author')).threads.find((thread) => thread.id === threadId)!;
  assert.deepEqual(author.touches.map((touch) => touch.note), ['First word of it.'], 'a struck take\'s touch is never served, to the author either');

  await store.redoScene(redoInput({ run: slug, number: 3, threadsTouched: [{ thread: threadId, note: 'The new take.' }] }));
  served = await threadAsServed(slug, threadId);
  assert.equal(served.numberOf(served.thread.lastTouchedInSceneId), 3);
  assert.deepEqual(served.thread.touches.map((touch) => touch.note), ['First word of it.', 'The new take.']);
});

test('a redo of the scene that closed a thread reopens it, and the redo may touch it', async () => {
  const { slug, threadId } = await runWithAnOpenThread();
  await store.saveScene(sceneInput({ run: slug, threadsClosed: [{ thread: threadId, resolution: 'Mended.' }] }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2, threadsTouched: [{ thread: threadId, note: 'Half mended.' }] }));
  assert.equal(redone.threadsTouched[0]!.closedInSceneId, null);
  assert.equal(redone.threadsTouched[0]!.lastTouchedInSceneId, redone.scene.id);
});

function importedScene(number: number): ImportedScene {
  return { number, title: `Scene ${number}`, starred: false, whenTyped: `day ${number}`, place: null, summary: 'The wheel turned.', record: '', steer: '', situationAfter: '', readings: [] };
}

test('an import writes every scene a thread names after its opening as a touch, and a thread naming none has none', async () => {
  const run: ImportedRun = {
    slug: 'touched-by-import', title: 'The Mill', setting: '', status: 'binding', register: '',
    clocks: [], scenes: [1, 2, 3, 4, 5].map(importedScene), entries: [], rulings: [],
    threads: [
      { text: 'Will the pond hold?', about: [], openedInScene: 1, closed: false, resolution: '', touchedInScenes: [2, 4] },
      { text: 'Who owns the weir?', about: [], openedInScene: 3, closed: false, resolution: '' },
    ],
    waypoints: [], legs: [], unplaced: [],
  };
  const snapshot = await store.importRun(run);
  const numberOf = (sceneId: string | null) => snapshot.scenes.find((scene) => scene.id === sceneId)?.number ?? null;
  const [pond, weir] = snapshot.threads;
  assert.deepEqual(pond!.touches.map((touch) => numberOf(touch.sceneId)), [2, 4]);
  assert.equal(numberOf(pond!.lastTouchedInSceneId), 4);
  assert.deepEqual(weir!.touches, []);
  assert.equal(numberOf(weir!.lastTouchedInSceneId), 3);
  // A redo of the newest imported scene takes back nothing the import touched elsewhere.
  await store.redoScene(redoInput({ run: 'touched-by-import', number: 5 }));
  const after = (await store.snapshotOf('touched-by-import', 'story')).threads[0]!;
  assert.equal(after.touches.length, 2);
});

test('a redo of the newest imported scene keeps the touches the import dated to it, on the new take, as it keeps the closings', async () => {
  const run: ImportedRun = {
    slug: 'touched-in-the-newest', title: 'The Mill', setting: '', status: 'binding', register: '',
    clocks: [], scenes: [1, 2, 3].map(importedScene), entries: [], rulings: [],
    threads: [
      { text: 'Will the pond hold?', about: [], openedInScene: 1, closed: false, resolution: '', touchedInScenes: [3] },
      { text: 'Who owns the weir?', about: [], openedInScene: 1, closed: true, resolution: 'The miller does.' },
    ],
    waypoints: [], legs: [], unplaced: [],
  };
  await store.importRun(run);
  const redone = await store.redoScene(redoInput({ run: 'touched-in-the-newest', number: 3 }));
  const snapshot = await store.snapshotOf('touched-in-the-newest', 'story');
  const pond = snapshot.threads.find((thread) => thread.text === 'Will the pond hold?')!;
  const weir = snapshot.threads.find((thread) => thread.text === 'Who owns the weir?')!;
  assert.equal(weir.closedInSceneId, redone.scene.id, 'the closing the import dated to scene 3 is on the new take');
  assert.deepEqual(pond.touches.map((touch) => touch.sceneId), [redone.scene.id], 'the touch the import dated to scene 3 is on the new take');
  assert.equal(pond.lastTouchedInSceneId, redone.scene.id);
});

test('a take that touches a thread the import had dated to the scene it redoes keeps its own note, and saves', async () => {
  const run: ImportedRun = {
    slug: 'touched-again-by-the-take', title: 'The Mill', setting: '', status: 'binding', register: '',
    clocks: [], scenes: [1, 2, 3].map(importedScene), entries: [], rulings: [],
    threads: [{ text: 'Will the pond hold?', about: [], openedInScene: 1, closed: false, resolution: '', touchedInScenes: [3] }],
    waypoints: [], legs: [], unplaced: [],
  };
  const imported = await store.importRun(run);
  const threadId = imported.threads[0]!.id;
  const redone = await store.redoScene(redoInput({ run: 'touched-again-by-the-take', number: 3, threadsTouched: [{ thread: threadId, note: 'The water rose.' }] }));
  const pond = (await store.snapshotOf('touched-again-by-the-take', 'story')).threads[0]!;
  assert.deepEqual(pond.touches, [{ sceneId: redone.scene.id, note: 'The water rose.' }]);
});

test('a thread\'s touches are served oldest scene first, whatever order their rows were written in', () => {
  const row = {
    id: 'thread', run_id: 'run', text: 'Who will mend the mill wheel?', opened_in_scene_id: 'scene-1', closed_in_scene_id: null,
    resolution: '', established_by_scene_id: 'scene-1', closed_by_scene_id: null, created_at: new Date('2026-01-01T00:00:00Z'), write_mark: 'mark', written_order: 1,
  } as unknown as ThreadRow;
  // The row for scene 5 was written before a redone scene 3's, which is the order the store reads them in.
  const served = threadFromRow(row, [], [
    { sceneId: 'scene-5', note: 'Half mended.', sceneNumber: 5, sceneStanding: true },
    { sceneId: 'scene-3', note: 'The new take of scene 3.', sceneNumber: 3, sceneStanding: true },
  ], new Map([['scene-1', 1], ['scene-3', 3], ['scene-5', 5]]));
  assert.deepEqual(served.touches.map((touch) => touch.sceneId), ['scene-3', 'scene-5']);
  assert.equal(served.lastTouchedInSceneId, 'scene-5');
});
