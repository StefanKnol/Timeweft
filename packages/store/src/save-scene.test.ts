import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, Refusal, type Store } from '@timeweft/contract';
import { openStoreForTests } from './index.ts';
import { beginDemoRun, sceneInput, stateFactInput } from './demo-world.ts';

let store: Store;
let dispose: () => Promise<void>;
let runCounter = 0;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

async function freshRun(): Promise<string> {
  runCounter += 1;
  const slug = `the-ford-${runCounter}`;
  await beginDemoRun(store, slug);
  return slug;
}

const theMillerAndTheLantern = [
  { name: 'Odo the miller', kind: 'person' as const, alsoKnownAs: ['the miller'], pronoun: 'he' },
  { name: 'the lantern', kind: 'item' as const },
  { name: 'the ford', kind: 'place' as const },
];

async function holding(slug: string, entryName: string, property: string) {
  const snapshot = await store.snapshotOf(slug, 'author');
  const entry = snapshot.entries.find((candidate) => candidate.name === entryName)!;
  return snapshot.facts.filter((fact) => fact.entryId === entry.id && fact.property === property && fact.untilSceneId === null);
}

test('a scene takes the next number after the highest standing one', async () => {
  const slug = await freshRun();
  const first = await store.saveScene(sceneInput({ run: slug }));
  const second = await store.saveScene(sceneInput({ run: slug }));
  assert.equal(first.scene.number, 1);
  assert.equal(second.scene.number, 2);
});

test('a scene may introduce a name and use it in the same save', async () => {
  const slug = await freshRun();
  const saved = await store.saveScene(sceneInput({
    run: slug, place: 'the ford', entries: theMillerAndTheLantern,
    facts: [{ entry: 'the lantern', property: 'held by', value: 'the miller carries it', about: 'The Miller ' }],
    notes: [{ entry: 'ODO THE MILLER', text: 'He lit the lantern at the ford.' }],
    readings: [{ clock: 'Days since the flood', count: 3, partOfDay: 'dusk' }],
  }));
  assert.equal(saved.entriesAdded.length, 3);
  const miller = saved.entriesAdded.find((entry) => entry.name === 'Odo the miller')!;
  const ford = saved.entriesAdded.find((entry) => entry.name === 'the ford')!;
  assert.equal(saved.factsWritten[0]!.aboutEntryId, miller.id);
  assert.equal(saved.factsWritten[0]!.source, 'story');
  assert.equal(saved.scene.placeEntryId, ford.id);
  assert.equal(saved.scene.readings[0]!.count, '3');
  assert.equal(miller.introducedInSceneId, saved.scene.id);
});

test('an entry already in the run is not added again, and the save says so', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern }));
  const saved = await store.saveScene(sceneInput({ run: slug, entries: [{ name: '  the MILLER ', kind: 'person' }] }));
  assert.equal(saved.entriesAdded.length, 0);
  assert.match(saved.cautions.join(' '), /already names an entry/);
  const snapshot = await store.snapshotOf(slug, 'author');
  assert.equal(snapshot.entries.length, 3);
});

test('a name that resolves to nothing is refused, in a fact, a note, an about and a place', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern }));
  const attempts = [
    { facts: [{ entry: 'the baker', property: 'state', value: 'asleep' }] },
    { notes: [{ entry: 'the baker', text: 'Slept.' }] },
    { facts: [{ entry: 'the lantern', property: 'held by', value: 'held', about: 'the baker' }] },
    { place: 'the mill' },
    { threadsOpened: [{ text: 'Who rang the bell?', about: ['the baker'] }] },
  ];
  for (const attempt of attempts) {
    await assert.rejects(store.saveScene(sceneInput({ run: slug, ...attempt })), (error) =>
      error instanceof Refusal && /Nothing in this run is called/.test(error.message));
  }
  const listing = (await store.listRuns()).find((candidate) => candidate.run.slug === slug)!;
  assert.equal(listing.standingScenes, 1, 'a refused save writes nothing');
});

test('two entries answering one name is a refusal naming both', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: [
    { name: 'the ferryman', kind: 'person', alsoKnownAs: ['Bram'] },
    { name: 'the boatwright', kind: 'person', alsoKnownAs: ['bram'] },
  ] }));
  await assert.rejects(
    store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'Bram', property: 'state', value: 'tired' }] })),
    (error) => error instanceof Refusal && /the ferryman/.test(error.message) && /the boatwright/.test(error.message));
});

test('history is kept whole and only the newest fact holds', async () => {
  const slug = await freshRun();
  const first = await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'the lantern', property: 'where', value: 'on the mill shelf' }] }));
  const second = await store.saveScene(sceneInput({ run: slug,
    facts: [{ entry: 'the lantern', property: 'where', value: 'at the ford' }] }));
  const snapshot = await store.snapshotOf(slug, 'author');
  const whereFacts = snapshot.facts.filter((fact) => fact.property === 'where');
  assert.equal(whereFacts.length, 2);
  const older = whereFacts.find((fact) => fact.value === 'on the mill shelf')!;
  assert.equal(older.fromSceneId, first.scene.id);
  assert.equal(older.untilSceneId, second.scene.id);
  const now = await holding(slug, 'the lantern', 'where');
  assert.deepEqual(now.map((fact) => fact.value), ['at the ford']);
});

test('an identical fact is counted as unchanged and nothing is written', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'the lantern', property: 'state', value: 'lit' }] }));
  const again = await store.saveScene(sceneInput({ run: slug,
    facts: [{ entry: 'the lantern', property: 'state', value: 'lit' }] }));
  assert.equal(again.factsUnchanged, 1);
  assert.equal(again.factsWritten.length, 0);
  assert.equal((await store.snapshotOf(slug, 'author')).facts.length, 1);
});

test('a fact alongside keeps what the property already holds', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'Odo the miller', property: 'knows', value: 'the ford is shallow at dawn' }] }));
  await store.saveScene(sceneInput({ run: slug,
    facts: [{ entry: 'Odo the miller', property: 'knows', value: 'the ferry leaks', alongside: true }] }));
  assert.equal((await holding(slug, 'Odo the miller', 'knows')).length, 2);
});

test('a story fact may not replace an author fact: it becomes a waiting collision', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'Odo the miller', property: 'age', value: 'sixty', statedByAuthor: true }] }));
  const saved = await store.saveScene(sceneInput({ run: slug,
    facts: [{ entry: 'Odo the miller', property: 'age', value: 'forty' }] }));
  assert.equal(saved.factsWritten.length, 0);
  assert.equal(saved.collisions.length, 1);
  assert.equal(saved.collisions[0]!.state, 'waiting');
  assert.equal(saved.collisions[0]!.proposedValue, 'forty');
  assert.deepEqual((await holding(slug, 'Odo the miller', 'age')).map((fact) => fact.value), ['sixty']);
  const listing = (await store.listRuns()).find((candidate) => candidate.run.slug === slug)!;
  assert.equal(listing.waitingCollisions, 1);
});

test('an author fact replaces a story fact, and an author fact replaces an author fact', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'Odo the miller', property: 'age', value: 'forty' }] }));
  const byAuthor = await store.saveScene(sceneInput({ run: slug,
    facts: [{ entry: 'Odo the miller', property: 'age', value: 'sixty', statedByAuthor: true }] }));
  assert.equal(byAuthor.collisions.length, 0);
  assert.equal(byAuthor.factsWritten[0]!.source, 'author');
  const stated = await store.stateFact(stateFactInput({ run: slug, entry: 'the miller', property: 'age', value: 'sixty-one' }));
  assert.equal(stated.source, 'author');
  assert.equal(stated.fromSceneId, byAuthor.scene.id);
  assert.deepEqual((await holding(slug, 'Odo the miller', 'age')).map((fact) => fact.value), ['sixty-one']);
});

test('state_fact with no scene yet writes a first fact with no scene, and refuses to replace one', async () => {
  const slug = await freshRun();
  await store.importRun({
    slug: `${slug}-imported`, title: 'Imported', setting: '', status: 'binding', register: '', clocks: [], scenes: [],
    entries: [{ name: 'the ferry', kind: 'item', alsoKnownAs: [], pronoun: '', introducedInScene: null, visibility: 'open', facts: [], trail: [] }],
    rulings: [], threads: [], waypoints: [], legs: [], unplaced: [],
  });
  const first = await store.stateFact(stateFactInput({ run: `${slug}-imported`, entry: 'the ferry', property: 'state', value: 'afloat' }));
  assert.equal(first.fromSceneId, null);
  await assert.rejects(store.stateFact(stateFactInput({ run: `${slug}-imported`, entry: 'the ferry', property: 'state', value: 'sunk' })), Refusal);
});

test('settling a collision for the author keeps the author fact', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'the lantern', property: 'colour', value: 'green', statedByAuthor: true }] }));
  const saved = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'colour', value: 'red' }] }));
  const settled = await store.settleCollision({ collision: saved.collisions[0]!.id, take: 'author' });
  assert.equal(settled.state, 'author-kept');
  assert.deepEqual((await holding(slug, 'the lantern', 'colour')).map((fact) => fact.value), ['green']);
  await assert.rejects(store.settleCollision({ collision: saved.collisions[0]!.id, take: 'story' }),
    (error) => error instanceof Refusal && /settled already/.test(error.message));
});

test("settling a collision for the story closes the author's fact and writes the story's from its scene", async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'the lantern', property: 'colour', value: 'green', statedByAuthor: true }] }));
  const saved = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'colour', value: 'red' }] }));
  const settled = await store.settleCollision({ collision: saved.collisions[0]!.id, take: 'story' });
  assert.equal(settled.state, 'story-taken');
  const now = await holding(slug, 'the lantern', 'colour');
  assert.deepEqual(now.map((fact) => [fact.value, fact.source, fact.fromSceneId]), [['red', 'story', saved.scene.id]]);
  const author = (await store.snapshotOf(slug, 'author')).facts.find((fact) => fact.value === 'green')!;
  assert.equal(author.untilSceneId, saved.scene.id);
  await assert.rejects(store.settleCollision({ collision: saved.collisions[0]!.id, take: 'author' }), Refusal);
  await assert.rejects(store.settleCollision({ collision: 'not-an-id', take: 'author' }), Refusal);
});

test('two saves on one run at the same moment both land, with distinct numbers', async () => {
  const slug = await freshRun();
  const saves = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    store.saveScene(sceneInput({ run: slug, title: `Scene ${index}` }))));
  const numbers = saves.map((saved) => saved.scene.number).sort((left, right) => left - right);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);
});

test('threads open and close, waypoints are reached, rulings are numbered', async () => {
  const slug = await freshRun();
  const opened = await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    threadsOpened: [{ text: 'Who left the lantern at the ford?', about: ['the lantern'] }],
    rulings: [{ text: 'The miller never swims.', topics: ['practice'], about: ['the miller'] }] }));
  const ruling = await store.recordRuling(OPERATIONS.record_ruling.input.parse({ run: slug, text: 'Nights are long here.' }));
  assert.equal(ruling.number, 2);
  assert.equal(ruling.sceneId, opened.scene.id);
  const snapshot = await store.snapshotOf(slug, 'story');
  const waypoint = snapshot.waypoints[0]!;
  const closed = await store.saveScene(sceneInput({ run: slug,
    threadsClosed: [{ thread: opened.threadsOpened[0]!.id, resolution: 'The ferryman did.' }],
    waypointsReached: [waypoint.id] }));
  assert.equal(closed.threadsClosed[0]!.closedInSceneId, closed.scene.id);
  const listing = (await store.listRuns()).find((candidate) => candidate.run.slug === slug)!;
  assert.equal(listing.openThreads, 0);
  assert.deepEqual(listing.latest, { number: 2, title: 'A scene', whenTyped: 'the morning' });
  await assert.rejects(store.saveScene(sceneInput({ run: slug,
    threadsClosed: [{ thread: opened.threadsOpened[0]!.id, resolution: 'Again.' }] })), Refusal);
});

test('a reading on a clock the run does not keep, or a count that is not exact, is refused', async () => {
  const slug = await freshRun();
  await assert.rejects(store.saveScene(sceneInput({ run: slug, readings: [{ clock: 'days at sea', count: 1 }] })), Refusal);
  await assert.rejects(store.saveScene(sceneInput({ run: slug, readings: [{ clock: 'days since the flood', count: 'about ten' }] })), Refusal);
});

test('begin_run refuses a slug already taken and a run to continue that does not exist', async () => {
  const slug = await freshRun();
  await assert.rejects(beginDemoRun(store, slug), Refusal);
  await assert.rejects(store.beginRun(OPERATIONS.begin_run.input.parse({ slug: 'another-ford', title: 'x', continues: 'no-such-run' })), Refusal);
  await assert.rejects(store.snapshotOf('no-such-run', 'story'), Refusal);
});

test('every answer survives JSON.stringify unchanged', async () => {
  const slug = await freshRun();
  const saved = await store.saveScene(sceneInput({ run: slug, entries: theMillerAndTheLantern,
    facts: [{ entry: 'the lantern', property: 'state', value: 'lit', statedByAuthor: true }] }));
  const collided = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'the lantern', property: 'state', value: 'out' }] }));
  const answers: unknown[] = [
    saved, collided, await store.listRuns(), await store.snapshotOf(slug, 'author'), await store.snapshotOf(slug, 'story'),
    await store.stateFact(stateFactInput({ run: slug, entry: 'the ford', property: 'depth', value: 'knee deep' })),
    await store.recordRuling(OPERATIONS.record_ruling.input.parse({ run: slug, text: 'Plain words.' })),
    await store.settleCollision({ collision: collided.collisions[0]!.id, take: 'author' }),
  ];
  for (const answer of answers) assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer);
});
