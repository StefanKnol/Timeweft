/**
 * Author-only facts are a lane of their own, property names are one spelling, and taking a
 * story's side of a collision never brings a value back to life over what came after it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FactRecord, Store } from '@timeweft/contract';
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

async function runWithTheLantern(): Promise<{ slug: string; firstSceneId: string }> {
  runCounter += 1;
  const slug = `lanes-${runCounter}`;
  await beginDemoRun(store, slug);
  const first = await store.saveScene(sceneInput({ run: slug, entries: [{ name: 'the lantern', kind: 'item' }, { name: 'Odo the miller', kind: 'person' }] }));
  return { slug, firstSceneId: first.scene.id };
}

async function factsOn(slug: string, audience: 'story' | 'author', property: string): Promise<FactRecord[]> {
  const snapshot = await store.snapshotOf(slug, audience);
  return snapshot.facts.filter((fact) => fact.property === property);
}

function holdingValues(facts: FactRecord[]): string[] {
  return facts.filter((fact) => fact.untilSceneId === null).map((fact) => fact.value).sort();
}

test('a story save never confirms a guess at an author-only fact', async () => {
  const { slug } = await runWithTheLantern();
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the old smith', visibility: 'author-only' }));
  const saved = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'maker', value: 'the old smith' }] }));
  assert.equal(saved.factsUnchanged, 0, 'a matching author-only fact must not count as unchanged');
  assert.equal(saved.factsWritten.length, 1);
  assert.equal(saved.factsWritten[0]!.visibility, 'open');
});

test('a story save never closes an author-only fact, even when it says the author stated it', async () => {
  const { slug } = await runWithTheLantern();
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the old smith', visibility: 'author-only' }));
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'maker', value: 'a tinker', statedByAuthor: true }] }));
  const author = await factsOn(slug, 'author', 'maker');
  assert.deepEqual(holdingValues(author), ['a tinker', 'the old smith']);
});

test('a story fact never collides with an author-only fact: it is written as its own open fact', async () => {
  const { slug } = await runWithTheLantern();
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the old smith', visibility: 'author-only' }));
  const saved = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'maker', value: 'a tinker' }] }));
  assert.equal(saved.collisions.length, 0);
  assert.equal(saved.cautions.length, 0);
  assert.deepEqual(saved.factsWritten.map((fact) => [fact.value, fact.visibility]), [['a tinker', 'open']]);
  assert.deepEqual(holdingValues(await factsOn(slug, 'story', 'maker')), ['a tinker']);
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'maker')), ['a tinker', 'the old smith']);
});

test('a redo is as blind to the author-only lane as a save', async () => {
  const { slug } = await runWithTheLantern();
  await store.saveScene(sceneInput({ run: slug }));
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the old smith', visibility: 'author-only' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2, facts: [{ entry: 'the lantern', property: 'maker', value: 'the old smith' }] }));
  assert.equal(redone.factsUnchanged, 0);
  assert.equal(redone.collisions.length, 0);
  assert.deepEqual(holdingValues(await factsOn(slug, 'story', 'maker')), ['the old smith']);
  assert.equal((await factsOn(slug, 'author', 'maker')).filter((fact) => fact.untilSceneId === null).length, 2);
});

test('stating an author-only fact closes only author-only facts, and stating an open fact closes only open ones', async () => {
  const { slug } = await runWithTheLantern();
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'maker', value: 'a tinker' }] }));
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the old smith', visibility: 'author-only' }));
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'maker')), ['a tinker', 'the old smith']);
  const storyFacts = await factsOn(slug, 'story', 'maker');
  assert.deepEqual(storyFacts.map((fact) => [fact.value, fact.untilSceneId]), [['a tinker', null]], 'the story sees nothing end');
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'the young smith', visibility: 'author-only' }));
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'maker')), ['a tinker', 'the young smith']);
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'maker', value: 'a glazier' }));
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'maker')), ['a glazier', 'the young smith']);
});

test('a story snapshot reads exactly as if the author-only lane did not exist', async () => {
  const { slug } = await runWithTheLantern();
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'state', value: 'lit' }] }));
  const before = await factsOn(slug, 'story', 'state');
  await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: 'state', value: 'cursed', visibility: 'author-only' }));
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'state', value: 'lit' }] }));
  assert.deepEqual(await factsOn(slug, 'story', 'state'), before);
});

test('property names are trimmed and lower-cased at every door, so two spellings are one property', async () => {
  const { slug } = await runWithTheLantern();
  const first = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: '  Where ', value: 'on the shelf' }] }));
  assert.equal(first.factsWritten[0]!.property, 'where');
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'WHERE', value: 'at the ford' }] }));
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'where')), ['at the ford']);
  await store.redoScene(redoInput({ run: slug, number: 3, facts: [{ entry: 'the lantern', property: 'Where', value: 'at the mill' }] }));
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'where')), ['at the mill']);
  const stated = await store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', property: ' wHere', value: 'in the cellar' }));
  assert.equal(stated.property, 'where');
  const collided = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'Where ', value: 'lost' }] }));
  assert.equal(collided.collisions.length, 1, 'the story fact meets the author fact under one spelling');
  assert.equal(collided.collisions[0]!.property, 'where');
  await store.settleCollision({ collision: collided.collisions[0]!.id, take: 'story' });
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'where')), ['lost']);
  const imported = await store.importRun({
    slug: `${slug}-imported`, title: 'Imported', setting: '', status: 'binding', register: '', clocks: [],
    scenes: [{ number: 1, title: 'One', starred: false, whenTyped: 'day one', place: null, summary: 'x', record: '', steer: '', situationAfter: '', readings: [] },
      { number: 2, title: 'Two', starred: false, whenTyped: 'day two', place: null, summary: 'x', record: '', steer: '', situationAfter: '', readings: [] }],
    entries: [{ name: 'the ferry', kind: 'item', alsoKnownAs: [], pronoun: '', introducedInScene: 1, visibility: 'open', trail: [], facts: [
      { property: 'State', value: 'afloat', fromScene: 1, source: 'import', note: '' },
      { property: ' state', value: 'sunk', fromScene: 2, source: 'import', note: '' },
    ] }],
    rulings: [], threads: [], waypoints: [], legs: [], unplaced: [],
  });
  assert.deepEqual(imported.facts.map((fact) => [fact.property, fact.untilSceneId === null]), [['state', false], ['state', true]]);
});

test("taking the story's side closes only the fact the collision names", async () => {
  const { slug } = await runWithTheLantern();
  await store.saveScene(sceneInput({ run: slug, facts: [
    { entry: 'the lantern', property: 'colour', value: 'green', statedByAuthor: true },
    { entry: 'the lantern', property: 'colour', value: 'with a gold band', alongside: true },
  ] }));
  const collided = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'colour', value: 'red' }] }));
  await store.settleCollision({ collision: collided.collisions[0]!.id, take: 'story' });
  assert.deepEqual(holdingValues(await factsOn(slug, 'author', 'colour')), ['red', 'with a gold band']);
});

test("taking the story's side never closes a fact a later scene established, and never revives the story's over it", async () => {
  const { slug } = await runWithTheLantern();
  await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'colour', value: 'green', statedByAuthor: true }] }));
  const collided = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'colour', value: 'red' }] }));
  const later = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'colour', value: 'painted blue', alongside: true }] }));
  await store.settleCollision({ collision: collided.collisions[0]!.id, take: 'story' });
  const colour = await factsOn(slug, 'author', 'colour');
  const scenes = (await store.snapshotOf(slug, 'author')).scenes;
  const numberOf = (sceneId: string | null) => scenes.find((scene) => scene.id === sceneId)?.number ?? null;
  for (const fact of colour) {
    if (fact.untilSceneId !== null && fact.fromSceneId !== null) {
      assert.ok(numberOf(fact.untilSceneId)! >= numberOf(fact.fromSceneId)!, `"${fact.value}" ends before it begins`);
    }
  }
  assert.deepEqual(holdingValues(colour), ['painted blue']);
  const red = colour.find((fact) => fact.value === 'red')!;
  assert.deepEqual([red.fromSceneId, red.untilSceneId], [collided.scene.id, later.scene.id], "the story's value is kept as history until the later scene");
  const green = colour.find((fact) => fact.value === 'green')!;
  assert.equal(green.untilSceneId, collided.scene.id);
});

