import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Refusal, type Store } from '@timeweft/contract';
import { openStoreForTests } from './index.ts';
import { beginDemoRun, redoInput, sceneInput, stateFactInput } from './demo-world.ts';

let store: Store;
let dispose: () => Promise<void>;
let runCounter = 0;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

async function freshRunWithAFirstScene(): Promise<{ slug: string; threadId: string; waypointId: string }> {
  runCounter += 1;
  const slug = `redo-${runCounter}`;
  await beginDemoRun(store, slug);
  const first = await store.saveScene(sceneInput({
    run: slug,
    entries: [{ name: 'the ferry', kind: 'item' }, { name: 'Tam the ferryman', kind: 'person', alsoKnownAs: ['Tam'] }],
    facts: [
      { entry: 'the ferry', property: 'state', value: 'afloat' },
      { entry: 'Tam', property: 'mood', value: 'calm' },
    ],
    threadsOpened: [{ text: 'Will the ferry hold another winter?', about: ['the ferry'] }],
  }));
  const waypointId = (await store.snapshotOf(slug, 'story')).waypoints[0]!.id;
  return { slug, threadId: first.threadsOpened[0]!.id, waypointId };
}

test('a redo takes back everything the earlier take established, and the new take stands under the same number', async () => {
  const { slug, threadId, waypointId } = await freshRunWithAFirstScene();
  const earlier = await store.saveScene(sceneInput({
    run: slug, title: 'The ferry sinks',
    entries: [{ name: 'the drowned bell', kind: 'item' }],
    facts: [
      { entry: 'the ferry', property: 'state', value: 'sunk' },
      { entry: 'the drowned bell', property: 'where', value: 'under the ford' },
      { entry: 'Tam', property: 'mood', value: 'grieving', statedByAuthor: false },
    ],
    notes: [{ entry: 'Tam', text: 'He watched it go down.' }],
    rulings: [{ text: 'Bells ring underwater here.' }],
    threadsOpened: [{ text: 'Who will raise the bell?' }],
    threadsClosed: [{ thread: threadId, resolution: 'It did not.' }],
    waypointsReached: [waypointId],
    legs: [{ from: 'the mill', to: 'the ford', duration: 'an hour' }],
  }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2, title: 'The ferry holds',
    facts: [{ entry: 'Tam', property: 'mood', value: 'relieved' }] }));
  assert.equal(redone.scene.number, 2);
  assert.notEqual(redone.scene.id, earlier.scene.id);

  const story = await store.snapshotOf(slug, 'story');
  assert.deepEqual(story.scenes.map((scene) => [scene.number, scene.title]), [[1, 'A scene'], [2, 'The ferry holds']]);
  const holding = story.facts.filter((fact) => fact.untilSceneId === null).map((fact) => fact.value).sort();
  assert.deepEqual(holding, ['afloat', 'relieved']);
  assert.ok(!story.facts.some((fact) => fact.value === 'sunk' || fact.value === 'grieving'));
  assert.ok(!story.entries.some((entry) => entry.name === 'the drowned bell'), 'an entry only the struck take introduced is taken back');
  assert.equal(story.notes.length, 0);
  assert.equal(story.rulings.length, 0);
  assert.deepEqual(story.threads.map((thread) => [thread.text, thread.closedInSceneId]), [['Will the ferry hold another winter?', null]]);
  assert.equal(story.waypoints[0]!.reachedInSceneId, null);
  assert.equal(story.legs.length, 0);

  const author = await store.snapshotOf(slug, 'author');
  const struck = author.scenes.find((scene) => scene.id === earlier.scene.id)!;
  assert.equal(struck.status, 'struck');
  const sunk = author.facts.find((fact) => fact.value === 'sunk')!;
  assert.equal(sunk.fromSceneId, struck.id, 'the struck take stays readable');
  assert.equal(sunk.untilSceneId, struck.id, 'and what it started never holds');
  const afloat = author.facts.find((fact) => fact.value === 'afloat')!;
  assert.equal(afloat.untilSceneId, null, 'what it closed holds again');
  assert.equal(author.rulings[0]!.withdrawnInSceneId, struck.id);
  assert.ok(author.notes.some((note) => note.sceneId === struck.id));
  assert.equal(author.waypoints[0]!.reachedInSceneId, null, 'a waypoint the take reached is unreached again');

  const listing = (await store.listRuns()).find((candidate) => candidate.run.slug === slug)!;
  assert.equal(listing.standingScenes, 2);
  assert.equal(listing.openThreads, 1);
});

test('a redo drops the collisions the earlier take raised', async () => {
  const { slug } = await freshRunWithAFirstScene();
  await store.stateFact(stateFactInput({ run: slug, entry: 'the ferry', property: 'state', value: 'afloat and tarred' }));
  const earlier = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the ferry', property: 'state', value: 'leaking' }] }));
  assert.equal(earlier.collisions.length, 1);
  await store.redoScene(redoInput({ run: slug, number: 2 }));
  const author = await store.snapshotOf(slug, 'author');
  assert.equal(author.collisions.length, 0);
});

test("a redo leaves what the author stated after the take standing, as of the new take", async () => {
  const { slug } = await freshRunWithAFirstScene();
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the ferry', property: 'state', value: 'leaking' }] }));
  await store.stateFact(stateFactInput({ run: slug, entry: 'the ferry', property: 'state', value: 'mended' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2 }));
  const story = await store.snapshotOf(slug, 'story');
  const ferry = story.entries.find((entry) => entry.name === 'the ferry')!;
  const holding = story.facts.filter((fact) => fact.entryId === ferry.id && fact.untilSceneId === null);
  assert.deepEqual(holding.map((fact) => [fact.value, fact.source, fact.fromSceneId]), [['mended', 'author', redone.scene.id]]);
});

test('a redo of the new take may reintroduce a name the struck take introduced', async () => {
  const { slug } = await freshRunWithAFirstScene();
  await store.saveScene(sceneInput({ run: slug, entries: [{ name: 'the toll', kind: 'other' }] }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2, entries: [{ name: 'the toll', kind: 'other' }],
    facts: [{ entry: 'the toll', property: 'what', value: 'a copper a crossing' }] }));
  assert.equal(redone.entriesAdded.length, 1);
  const story = await store.snapshotOf(slug, 'story');
  assert.equal(story.entries.filter((entry) => entry.name === 'the toll').length, 1);
});

test('only the newest standing scene can be redone, and a number with no scene is refused', async () => {
  const { slug } = await freshRunWithAFirstScene();
  await store.saveScene(sceneInput({ run: slug }));
  await assert.rejects(store.redoScene(redoInput({ run: slug, number: 1 })),
    (error) => error instanceof Refusal && /Only the newest scene can be redone/.test(error.message));
  await assert.rejects(store.redoScene(redoInput({ run: slug, number: 9 })), Refusal);
});
