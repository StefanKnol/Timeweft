/**
 * The author's hand: the doors the author's pages write through. Every act is dated to the newest
 * standing scene when it is made, keeps whatever it changed, survives a redo of that scene, and an
 * author-only switch takes an entry out of every story read and puts it back.
 *
 * A made-up demo world: a miller, a ferry, a ford and a lantern.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EarlierImportStandsInTheWay, OPERATIONS, Refusal, type ImportedRun, type InputOf, type OperationName,
  type RequestOf, type RunSnapshot, type Store,
} from '@timeweft/contract';
import pg from 'pg';
import { MIGRATIONS, openStore, openStoreForTests, testDatabaseUrl } from './index.ts';
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

/** An input as a real caller's would arrive, with every default filled in. */
function inputOf<Name extends OperationName>(name: Name, request: RequestOf<Name>): InputOf<Name> {
  return OPERATIONS[name].input.parse(request) as InputOf<Name>;
}

async function freshRun(): Promise<string> {
  runCounter += 1;
  const slug = `hand-${runCounter}`;
  await beginDemoRun(store, slug);
  return slug;
}

/** A run with one scene introducing the miller, the ferry and the lantern. */
async function runWithAScene(): Promise<{ slug: string; firstSceneId: string }> {
  const slug = await freshRun();
  const saved = await store.saveScene(sceneInput({
    run: slug, place: 'the ford',
    entries: [
      { name: 'Odo the miller', kind: 'person', pronoun: 'he' }, { name: 'the ferry', kind: 'item' },
      { name: 'the lantern', kind: 'item' }, { name: 'the ford', kind: 'place' },
    ],
    facts: [{ entry: 'the lantern', property: 'held by', value: 'Odo', about: 'Odo the miller' }],
    notes: [{ entry: 'the lantern', text: 'It was lit at dusk.' }],
  }));
  return { slug, firstSceneId: saved.scene.id };
}

async function authorView(slug: string): Promise<RunSnapshot> {
  return store.snapshotOf(slug, 'author');
}

async function storyView(slug: string): Promise<RunSnapshot> {
  return store.snapshotOf(slug, 'story');
}

function entryIdNamed(snapshot: RunSnapshot, name: string): string {
  const entry = snapshot.entries.find((each) => each.name === name);
  assert.ok(entry, `no entry called ${name}`);
  return entry.id;
}

function standingSceneId(snapshot: RunSnapshot, number: number): string {
  return snapshot.scenes.find((scene) => scene.number === number && scene.status === 'standing')!.id;
}

const refusedSaying = (pattern: RegExp) => (error: unknown) => error instanceof Refusal && pattern.test(error.message);

// Facts

test('ending a fact closes it at the newest scene with nothing after it, and keeps it', async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const fact = (await authorView(slug)).facts[0]!;
  const ended = await store.endFact(inputOf('end_fact', { fact: fact.id }));
  assert.equal(ended.untilSceneId, firstSceneId);
  assert.equal(ended.value, 'Odo');
  const author = await authorView(slug);
  assert.deepEqual(author.facts.map((each) => [each.id, each.untilSceneId]), [[fact.id, firstSceneId]]);
  assert.equal((await storyView(slug)).facts.filter((each) => each.untilSceneId === null).length, 0);
});

test('ending a fact is refused where it has stopped holding, the run has no scene, or the id names nothing', async () => {
  const { slug } = await runWithAScene();
  const fact = (await authorView(slug)).facts[0]!;
  await store.endFact(inputOf('end_fact', { fact: fact.id }));
  await assert.rejects(store.endFact(inputOf('end_fact', { fact: fact.id })), refusedSaying(/stopped holding already/));
  await assert.rejects(store.endFact(inputOf('end_fact', { fact: randomUUID() })), refusedSaying(/no fact with the id/));
  await assert.rejects(store.endFact(inputOf('end_fact', { fact: 'not an id' })), refusedSaying(/no fact with the id/));
  const bare = await freshRun();
  await store.addEntry(inputOf('add_entry', { run: bare, name: 'the mill', kind: 'place' }));
  const stated = await store.stateFact(stateFactInput({ run: bare, entry: 'the mill', property: 'state', value: 'still' }));
  await assert.rejects(store.endFact(inputOf('end_fact', { fact: stated.id })), refusedSaying(/has no scene yet/));
});

test('state_fact names the entry and what it points at by id, and refuses both or neither', async () => {
  const { slug } = await runWithAScene();
  const snapshot = await authorView(slug);
  const lantern = entryIdNamed(snapshot, 'the lantern');
  const ferry = entryIdNamed(snapshot, 'the ferry');
  const stated = await store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'where', value: 'aboard', aboutEntryId: ferry }));
  assert.equal(stated.entryId, lantern);
  assert.equal(stated.aboutEntryId, ferry);
  await assert.rejects(store.stateFact(stateFactInput({ run: slug, entry: 'the lantern', entryId: lantern, property: 'p', value: 'v' })), refusedSaying(/not both/));
  await assert.rejects(store.stateFact(stateFactInput({ run: slug, property: 'p', value: 'v' })), refusedSaying(/by its name or by its id/));
  await assert.rejects(store.stateFact(stateFactInput({ run: slug, entryId: lantern, about: 'the ferry', aboutEntryId: ferry, property: 'p', value: 'v' })), refusedSaying(/not both/));
  await assert.rejects(store.stateFact(stateFactInput({ run: slug, entryId: randomUUID(), property: 'p', value: 'v' })), refusedSaying(/no entry with the id/));
});

test("the author's own later fact replaces their earlier one with no collision, and the earlier is kept", async () => {
  const { slug } = await runWithAScene();
  const lantern = entryIdNamed(await authorView(slug), 'the lantern');
  const first = await store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'colour', value: 'brass' }));
  await store.saveScene(sceneInput({ run: slug }));
  await store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'colour', value: 'copper' }));
  const author = await authorView(slug);
  assert.equal(author.collisions.length, 0);
  assert.deepEqual(author.facts.filter((fact) => fact.property === 'colour').map((fact) => [fact.value, fact.untilSceneId === null]),
    [['brass', false], ['copper', true]]);
  assert.equal(author.facts.find((fact) => fact.id === first.id)!.value, 'brass');
});

// Rulings

test('withdrawing a ruling dates it to the newest scene and keeps it word for word', async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const ruling = await store.recordRuling(inputOf('record_ruling', { run: slug, text: 'Nobody swims at the ford.' }));
  const withdrawn = await store.withdrawRuling(inputOf('withdraw_ruling', { ruling: ruling.id }));
  assert.equal(withdrawn.withdrawnInSceneId, firstSceneId);
  assert.equal((await authorView(slug)).rulings[0]!.text, 'Nobody swims at the ford.');
  await assert.rejects(store.withdrawRuling(inputOf('withdraw_ruling', { ruling: ruling.id })), refusedSaying(/withdrawn already/));
  const bare = await freshRun();
  const early = await store.recordRuling(inputOf('record_ruling', { run: bare, text: 'The river is always cold.' }));
  await assert.rejects(store.withdrawRuling(inputOf('withdraw_ruling', { ruling: early.id })), refusedSaying(/has no scene yet/));
});

// Waypoints

test('a waypoint is added, reworded with its earlier words kept, and marked reached at a named scene', async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const waypoint = await store.addWaypoint(inputOf('add_waypoint', { run: slug, text: '  The mill wheel turns.  ' }));
  assert.equal(waypoint.text, 'The mill wheel turns.');
  assert.equal(waypoint.withdrawnInSceneId, null);
  const reworded = await store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: waypoint.id, text: 'The mill wheel turns at dawn.' }));
  assert.equal(reworded.id, waypoint.id);
  assert.equal(reworded.text, 'The mill wheel turns at dawn.');
  const author = await authorView(slug);
  assert.deepEqual(author.waypointRewordings.map((each) => [each.waypointId, each.earlierText, each.laterText, each.afterSceneId]),
    [[waypoint.id, 'The mill wheel turns.', 'The mill wheel turns at dawn.', firstSceneId]]);
  const story = await storyView(slug);
  assert.deepEqual(story.waypointRewordings, []);
  assert.equal(story.waypoints.find((each) => each.id === waypoint.id)!.text, 'The mill wheel turns at dawn.');
  await assert.rejects(store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: waypoint.id, text: 'The mill wheel turns at dawn.' })), refusedSaying(/already says/));

  const reached = await store.markWaypointReached(inputOf('mark_waypoint_reached', { waypoint: waypoint.id, scene: 1 }));
  assert.equal(reached.reachedInSceneId, firstSceneId);
  await assert.rejects(store.markWaypointReached(inputOf('mark_waypoint_reached', { waypoint: waypoint.id, scene: 1 })), refusedSaying(/reached already/));
  const other = await store.addWaypoint(inputOf('add_waypoint', { run: slug, text: 'The baker comes.' }));
  await assert.rejects(store.markWaypointReached(inputOf('mark_waypoint_reached', { waypoint: other.id, scene: 7 })), refusedSaying(/no standing scene 7/));
});

test('a withdrawn waypoint is kept for the author, never served to a story, and not reworded or reached', async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const waypoint = await store.addWaypoint(inputOf('add_waypoint', { run: slug, text: 'The ferry sinks.' }));
  const withdrawn = await store.withdrawWaypoint(inputOf('withdraw_waypoint', { waypoint: waypoint.id }));
  assert.equal(withdrawn.withdrawnInSceneId, firstSceneId);
  assert.ok((await authorView(slug)).waypoints.some((each) => each.id === waypoint.id));
  assert.ok(!(await storyView(slug)).waypoints.some((each) => each.id === waypoint.id));
  await assert.rejects(store.withdrawWaypoint(inputOf('withdraw_waypoint', { waypoint: waypoint.id })), refusedSaying(/withdrawn already/));
  await assert.rejects(store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: waypoint.id, text: 'The ferry floats.' })), refusedSaying(/is withdrawn/));
  await assert.rejects(store.markWaypointReached(inputOf('mark_waypoint_reached', { waypoint: waypoint.id, scene: 1 })), refusedSaying(/is withdrawn/));
  const bare = await freshRun();
  const early = (await authorView(bare)).waypoints[0]!;
  await assert.rejects(store.withdrawWaypoint(inputOf('withdraw_waypoint', { waypoint: early.id })), refusedSaying(/has no scene yet/));
  // Rewording needs no scene.
  assert.equal((await store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: early.id, text: 'The ferry crosses by moonlight.' }))).text, 'The ferry crosses by moonlight.');
  assert.equal((await authorView(bare)).waypointRewordings[0]!.afterSceneId, null);
});

// The run

test("editing a run changes what is given and keeps each earlier value with when it changed", async () => {
  const slug = await freshRun();
  const early = await store.editRun(inputOf('edit_run', { run: slug, title: 'The Ford at Night' }));
  assert.equal(early.title, 'The Ford at Night');
  await store.saveScene(sceneInput({ run: slug }));
  const sceneId = standingSceneId(await authorView(slug), 1);
  const edited = await store.editRun(inputOf('edit_run', { run: slug, title: 'The Ford at Night', register: 'Close third person, past tense.', status: 'telling' }));
  assert.equal(edited.register, 'Close third person, past tense.');
  assert.equal(edited.status, 'telling');
  const author = await authorView(slug);
  assert.deepEqual(author.runEdits.map((each) => [each.field, each.earlierValue, each.laterValue, each.afterSceneId]), [
    ['title', 'The Ford', 'The Ford at Night', null],
    ['register', '', 'Close third person, past tense.', sceneId],
    ['status', 'binding', 'telling', sceneId],
  ]);
  assert.deepEqual((await storyView(slug)).runEdits, []);
  await assert.rejects(store.editRun(inputOf('edit_run', { run: slug, title: 'The Ford at Night' })), refusedSaying(/Nothing given differs/));
  await assert.rejects(store.editRun(inputOf('edit_run', { run: slug })), refusedSaying(/Nothing given differs/));
});

// Threads

test('a thread is opened at the newest scene, or at none, about entries named by id', async () => {
  const bare = await freshRun();
  const early = await store.openThread(inputOf('open_thread', { run: bare, text: 'Who rings the bell?' }));
  assert.equal(early.openedInSceneId, null);
  const { slug, firstSceneId } = await runWithAScene();
  const odo = entryIdNamed(await authorView(slug), 'Odo the miller');
  const thread = await store.openThread(inputOf('open_thread', { run: slug, text: 'Will Odo sell the mill?', aboutEntryIds: [odo, odo] }));
  assert.equal(thread.openedInSceneId, firstSceneId);
  assert.deepEqual(thread.aboutEntryIds, [odo]);
  await assert.rejects(store.openThread(inputOf('open_thread', { run: slug, text: 'x', aboutEntryIds: [randomUUID()] })), refusedSaying(/no entry with the id/));
});

test('a thread is touched once per scene and closed with how it resolved, and neither once it is closed', async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const thread = await store.openThread(inputOf('open_thread', { run: slug, text: 'Will Odo sell the mill?' }));
  await store.saveScene(sceneInput({ run: slug }));
  const second = standingSceneId(await authorView(slug), 2);
  const touched = await store.touchThread(inputOf('touch_thread', { thread: thread.id, note: 'A buyer came by.' }));
  assert.deepEqual(touched.touches, [{ sceneId: second, note: 'A buyer came by.' }]);
  assert.equal(touched.lastTouchedInSceneId, second);
  await assert.rejects(store.touchThread(inputOf('touch_thread', { thread: thread.id })), refusedSaying(/touched the thread .* already/));
  const closed = await store.closeThread(inputOf('close_thread', { thread: thread.id, resolution: 'He kept it.' }));
  assert.equal(closed.closedInSceneId, second);
  assert.equal(closed.resolution, 'He kept it.');
  await assert.rejects(store.closeThread(inputOf('close_thread', { thread: thread.id, resolution: 'Again.' })), refusedSaying(/closed already/));
  await assert.rejects(store.touchThread(inputOf('touch_thread', { thread: thread.id })), refusedSaying(/is closed/));
  assert.notEqual(firstSceneId, second);
  const bare = await freshRun();
  const early = await store.openThread(inputOf('open_thread', { run: bare, text: 'Who rings the bell?' }));
  await assert.rejects(store.touchThread(inputOf('touch_thread', { thread: early.id })), refusedSaying(/has no scene yet/));
  await assert.rejects(store.closeThread(inputOf('close_thread', { thread: early.id, resolution: 'Nobody.' })), refusedSaying(/has no scene yet/));
});

// The outside-a-scene rule, through a redo

test("a redo of the newest scene carries every author act dated to it onto the new take and takes none back", async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const before = await authorView(slug);
  const fact = before.facts[0]!;
  const lantern = entryIdNamed(before, 'the lantern');
  const ruling = await store.recordRuling(inputOf('record_ruling', { run: slug, text: 'No bells after dark.' }));
  const waypointToReach = await store.addWaypoint(inputOf('add_waypoint', { run: slug, text: 'Odo crosses.' }));
  const waypointToWithdraw = await store.addWaypoint(inputOf('add_waypoint', { run: slug, text: 'The ferry sinks.' }));
  const threadToTouch = await store.openThread(inputOf('open_thread', { run: slug, text: 'Will Odo sell the mill?' }));
  const threadToClose = await store.openThread(inputOf('open_thread', { run: slug, text: 'Who lit the lantern?' }));

  await store.endFact(inputOf('end_fact', { fact: fact.id }));
  const stated = await store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'colour', value: 'brass' }));
  await store.withdrawRuling(inputOf('withdraw_ruling', { ruling: ruling.id }));
  await store.markWaypointReached(inputOf('mark_waypoint_reached', { waypoint: waypointToReach.id, scene: 1 }));
  await store.withdrawWaypoint(inputOf('withdraw_waypoint', { waypoint: waypointToWithdraw.id }));
  await store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: waypointToReach.id, text: 'Odo crosses the ford.' }));
  await store.touchThread(inputOf('touch_thread', { thread: threadToTouch.id, note: 'A buyer came by.' }));
  await store.closeThread(inputOf('close_thread', { thread: threadToClose.id, resolution: 'Odo did.' }));
  await store.editRun(inputOf('edit_run', { run: slug, setting: 'A river valley in autumn.' }));
  await store.editEntry(inputOf('edit_entry', { entry: lantern, pronoun: 'it' }));

  const redone = await store.redoScene(redoInput({ run: slug, number: 1, entries: [{ name: 'the ferry', kind: 'item' }] }));
  const newTake = redone.scene.id;
  assert.notEqual(newTake, firstSceneId);
  const after = await authorView(slug);
  const endedFact = after.facts.find((each) => each.id === fact.id)!;
  assert.equal(endedFact.untilSceneId, firstSceneId, 'the take established it, so the redo closed it at the struck scene');
  const statedFact = after.facts.find((each) => each.id === stated.id)!;
  assert.equal(statedFact.fromSceneId, newTake);
  assert.equal(statedFact.untilSceneId, null);
  assert.equal(after.rulings.find((each) => each.id === ruling.id)!.withdrawnInSceneId, newTake);
  assert.equal(after.rulings.find((each) => each.id === ruling.id)!.sceneId, newTake);
  assert.equal(after.waypoints.find((each) => each.id === waypointToReach.id)!.reachedInSceneId, newTake);
  assert.equal(after.waypoints.find((each) => each.id === waypointToWithdraw.id)!.withdrawnInSceneId, newTake);
  const touchedThread = after.threads.find((each) => each.id === threadToTouch.id)!;
  assert.equal(touchedThread.openedInSceneId, newTake);
  assert.deepEqual(touchedThread.touches, [{ sceneId: newTake, note: 'A buyer came by.' }]);
  const closedThread = after.threads.find((each) => each.id === threadToClose.id)!;
  assert.equal(closedThread.closedInSceneId, newTake);
  assert.equal(closedThread.resolution, 'Odo did.');
  assert.deepEqual(after.runEdits.map((each) => each.afterSceneId), [newTake]);
  assert.equal(after.run.setting, 'A river valley in autumn.');
  assert.deepEqual(after.entryEdits.map((each) => each.afterSceneId), [newTake]);
  assert.deepEqual(after.waypointRewordings.map((each) => each.afterSceneId), [newTake]);
  // The story is not handed the withdrawn waypoint, and the reached one stays reached.
  const story = await storyView(slug);
  assert.ok(!story.waypoints.some((each) => each.id === waypointToWithdraw.id));
  assert.equal(story.waypoints.find((each) => each.id === waypointToReach.id)!.reachedInSceneId, newTake);
});

test('a fact the author ended that no scene established stays ended through a redo, as of the new take', async () => {
  const { slug } = await runWithAScene();
  const lantern = entryIdNamed(await authorView(slug), 'the lantern');
  const stated = await store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'colour', value: 'brass' }));
  await store.saveScene(sceneInput({ run: slug }));
  await store.endFact(inputOf('end_fact', { fact: stated.id }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2 }));
  const fact = (await authorView(slug)).facts.find((each) => each.id === stated.id)!;
  assert.equal(fact.untilSceneId, redone.scene.id);
});

// Entries

test('an author adds an entry introduced by no scene, with a caution where the name is taken', async () => {
  const { slug } = await runWithAScene();
  const written = await store.addEntry(inputOf('add_entry', { run: slug, name: ' the mill ', kind: 'place', alsoKnownAs: [' the old mill ', '', 'The Old Mill'] }));
  assert.equal(written.entry.name, 'the mill');
  assert.deepEqual(written.entry.alsoKnownAs, ['the old mill']);
  assert.equal(written.entry.source, 'author');
  assert.equal(written.entry.introducedInSceneId, null);
  assert.deepEqual(written.cautions, []);
  const twin = await store.addEntry(inputOf('add_entry', { run: slug, name: 'The Mill', kind: 'group' }));
  assert.equal(twin.cautions.length, 1);
  assert.match(twin.cautions[0]!, /"The Mill" also answers to "the mill"/);
  const secret = await store.addEntry(inputOf('add_entry', { run: slug, name: 'the drowned bell', kind: 'item', visibility: 'author-only' }));
  assert.ok((await authorView(slug)).entries.some((each) => each.id === secret.entry.id));
  assert.ok(!(await storyView(slug)).entries.some((each) => each.id === secret.entry.id));
});

test("editing an entry keeps each earlier value, and refuses where nothing differs", async () => {
  const { slug } = await runWithAScene();
  const odo = entryIdNamed(await authorView(slug), 'Odo the miller');
  const edited = await store.editEntry(inputOf('edit_entry', { entry: odo, alsoKnownAs: ['Odo', 'the miller'], pronoun: 'they', kind: 'person' }));
  assert.deepEqual(edited.entry.alsoKnownAs, ['Odo', 'the miller']);
  assert.equal(edited.entry.pronoun, 'they');
  const edits = (await authorView(slug)).entryEdits;
  assert.deepEqual(edits.map((each) => [each.entryId, each.field, each.earlierValue, each.laterValue]), [
    [odo, 'pronoun', 'he', 'they'],
    [odo, 'alsoKnownAs', '[]', '["Odo","the miller"]'],
  ]);
  assert.deepEqual(JSON.parse(edits[1]!.laterValue), ['Odo', 'the miller']);
  assert.deepEqual((await storyView(slug)).entryEdits, []);
  await assert.rejects(store.editEntry(inputOf('edit_entry', { entry: odo, pronoun: 'they' })), refusedSaying(/Nothing given differs/));
  await assert.rejects(store.editEntry(inputOf('edit_entry', { entry: randomUUID(), pronoun: 'she' })), refusedSaying(/no entry with the id/));
});

test('a renamed entry is still found by its old name, and the change is kept', async () => {
  const { slug } = await runWithAScene();
  const odo = entryIdNamed(await authorView(slug), 'Odo the miller');
  const renamed = await store.renameEntry(inputOf('rename_entry', { entry: odo, name: 'Odo Fenwright' }));
  assert.equal(renamed.entry.name, 'Odo Fenwright');
  assert.deepEqual(renamed.entry.alsoKnownAs, ['Odo the miller']);
  assert.deepEqual(renamed.cautions, []);
  // A story still names him by what he was called.
  const saved = await store.saveScene(sceneInput({ run: slug, facts: [{ entry: 'Odo the miller', property: 'mood', value: 'glad' }] }));
  assert.equal(saved.factsWritten[0]!.entryId, odo);
  assert.deepEqual((await authorView(slug)).entryEdits.map((each) => [each.field, each.earlierValue, each.laterValue]), [
    ['name', 'Odo the miller', 'Odo Fenwright'],
    ['alsoKnownAs', '[]', '["Odo the miller"]'],
  ]);
  // Taking back a name it already goes by moves it out of the other names, and the old one in.
  const back = await store.renameEntry(inputOf('rename_entry', { entry: odo, name: 'odo the miller' }));
  assert.equal(back.entry.name, 'odo the miller');
  assert.deepEqual(back.entry.alsoKnownAs, ['Odo Fenwright']);
  await assert.rejects(store.renameEntry(inputOf('rename_entry', { entry: odo, name: 'odo the miller' })), refusedSaying(/called "odo the miller" already/));
  const caution = await store.renameEntry(inputOf('rename_entry', { entry: odo, name: 'the ferry' }));
  assert.match(caution.cautions[0]!, /"the ferry" also answers to "the ferry"/);
});

test('turning an entry author-only takes it, its facts, its trail and every pointer at it out of the story view, and back', async () => {
  const { slug, firstSceneId } = await runWithAScene();
  const author = await authorView(slug);
  const odo = entryIdNamed(author, 'Odo the miller');
  const ford = entryIdNamed(author, 'the ford');
  await store.stateFact(stateFactInput({ run: slug, entryId: odo, property: 'where', value: 'at the ford', aboutEntryId: ford }));
  await store.recordRuling(inputOf('record_ruling', { run: slug, text: 'Odo never swims.', about: ['Odo the miller'] }));
  await store.openThread(inputOf('open_thread', { run: slug, text: 'Will Odo sell?', aboutEntryIds: [odo, ford] }));
  await store.saveScene(sceneInput({ run: slug, notes: [{ entry: 'Odo the miller', text: 'He counted sacks.' }] }));
  const storyBefore = await storyView(slug);

  // Odo, and the ford a scene is set at, go author-only.
  const hidden = await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: odo, visibility: 'author-only' }));
  assert.equal(hidden.entry.visibility, 'author-only');
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: ford, visibility: 'author-only' }));
  const story = await storyView(slug);
  const mentionsOf = (snapshot: RunSnapshot, id: string): number => JSON.stringify(snapshot).split(id).length - 1;
  assert.equal(mentionsOf(story, odo), 0, 'no story answer names the author-only entry');
  assert.equal(mentionsOf(story, ford), 0);
  assert.ok(!story.entries.some((each) => each.id === odo));
  assert.ok(!story.facts.some((each) => each.value === 'Odo' || each.value === 'at the ford'));
  assert.ok(!story.notes.some((each) => each.text === 'He counted sacks.'));
  assert.equal(story.scenes.find((scene) => scene.id === firstSceneId)!.placeEntryId, null);
  assert.deepEqual(story.rulings.find((each) => each.text === 'Odo never swims.')!.aboutEntryIds, []);
  // A story's doors cannot name it either.
  await assert.rejects(store.recordRuling(inputOf('record_ruling', { run: slug, text: 'x', about: ['Odo the miller'] })), refusedSaying(/Nothing in this run is called/));
  // The author still sees everything, and the change is kept.
  assert.deepEqual((await authorView(slug)).entryEdits.map((each) => [each.field, each.earlierValue, each.laterValue]),
    [['visibility', 'open', 'author-only'], ['visibility', 'open', 'author-only']]);
  await assert.rejects(store.setEntryVisibility(inputOf('set_entry_visibility', { entry: odo, visibility: 'author-only' })), refusedSaying(/author-only already/));

  // Turned open again, the story view is as it was.
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: odo, visibility: 'open' }));
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: ford, visibility: 'open' }));
  assert.deepEqual(await storyView(slug), storyBefore);
});

// Replacing an earlier import once the author has written into it

function millRun(slug: string): ImportedRun {
  return {
    slug, title: 'The Mill', setting: 'A mill by a ford.', status: 'binding', register: '',
    clocks: [], scenes: [{ number: 1, title: 'Scene 1', starred: false, whenTyped: 'day 1', place: null, summary: 'The wheel turned.', record: '', steer: '', situationAfter: '', readings: [] }],
    entries: [{ name: 'the miller', kind: 'person', alsoKnownAs: [], pronoun: '', introducedInScene: null, visibility: 'open',
      facts: [{ property: 'where', value: 'at the mill', fromScene: 1, source: 'import', note: '' }], trail: [] }],
    rulings: [{ text: 'Nobody swims.', source: 'author', scope: 'run', topics: [], about: [], scene: 1 }],
    threads: [{ text: 'Who broke the wheel?', about: [], openedInScene: 1, closed: false, resolution: '' }],
    waypoints: [{ text: 'The wheel turns again.', reached: false }],
    legs: [], unplaced: [],
  };
}

const AUTHOR_ACTS_ON_AN_IMPORT: Array<[string, RegExp, (slug: string, snapshot: RunSnapshot) => Promise<unknown>]> = [
  ['ending a fact', /1 fact/, (_slug, snapshot) => store.endFact(inputOf('end_fact', { fact: snapshot.facts[0]!.id }))],
  ['withdrawing a ruling', /1 ruling/, (_slug, snapshot) => store.withdrawRuling(inputOf('withdraw_ruling', { ruling: snapshot.rulings[0]!.id }))],
  ['marking a waypoint reached', /1 waypoint/, (_slug, snapshot) => store.markWaypointReached(inputOf('mark_waypoint_reached', { waypoint: snapshot.waypoints[0]!.id, scene: 1 }))],
  ['withdrawing a waypoint', /1 waypoint/, (_slug, snapshot) => store.withdrawWaypoint(inputOf('withdraw_waypoint', { waypoint: snapshot.waypoints[0]!.id }))],
  ['rewording a waypoint', /1 rewording of a waypoint/, (_slug, snapshot) => store.rewordWaypoint(inputOf('reword_waypoint', { waypoint: snapshot.waypoints[0]!.id, text: 'The wheel turns.' }))],
  ['touching a thread', /1 thread/, (_slug, snapshot) => store.touchThread(inputOf('touch_thread', { thread: snapshot.threads[0]!.id }))],
  ['closing a thread', /1 thread/, (_slug, snapshot) => store.closeThread(inputOf('close_thread', { thread: snapshot.threads[0]!.id, resolution: 'Wind.' }))],
  ['editing the run', /1 change to the run's title/, (slug) => store.editRun(inputOf('edit_run', { run: slug, title: 'The Mill Again' }))],
  ['editing an entry', /1 change to an entry/, (_slug, snapshot) => store.editEntry(inputOf('edit_entry', { entry: snapshot.entries[0]!.id, pronoun: 'he' }))],
  ['renaming an entry', /2 changes to entries/, (_slug, snapshot) => store.renameEntry(inputOf('rename_entry', { entry: snapshot.entries[0]!.id, name: 'the old miller' }))],
  ['turning an entry author-only', /1 change to an entry/, (_slug, snapshot) => store.setEntryVisibility(inputOf('set_entry_visibility', { entry: snapshot.entries[0]!.id, visibility: 'author-only' }))],
  ['adding an entry', /1 entry/, (slug) => store.addEntry(inputOf('add_entry', { run: slug, name: 'the baker', kind: 'person' }))],
  ['adding a waypoint', /1 waypoint/, (slug) => store.addWaypoint(inputOf('add_waypoint', { run: slug, text: 'The baker comes.' }))],
  ['opening a thread', /1 thread/, (slug) => store.openThread(inputOf('open_thread', { run: slug, text: 'Who is the baker?' }))],
];

for (const [act, said, doIt] of AUTHOR_ACTS_ON_AN_IMPORT) {
  test(`replacing an earlier import is refused once the author has written into it by ${act}`, async () => {
    runCounter += 1;
    const slug = `hand-import-${runCounter}`;
    const imported = await store.importRun(millRun(slug));
    await doIt(slug, imported);
    const before = await authorView(slug);
    await assert.rejects(store.replaceImportedRun(millRun(slug)), (error: unknown) =>
      error instanceof EarlierImportStandsInTheWay && /wrote after it was imported/.test(error.message) && said.test(error.message));
    assert.deepEqual(await authorView(slug), before);
  });
}

// Migration 6, on a store that holds runs already

test("migrating a store written before the author's hand keeps its waypoints standing and lets the author edit them", async () => {
  const schema = `test_hand_older_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    await client.query(`create table timeweft_migrations (number integer primary key, name text not null, applied_at timestamptz not null default now())`);
    for (const migration of MIGRATIONS.filter((each) => each.number <= 5)) {
      // Each in a transaction of its own, as the store applies them: migration 4 keeps a table until commit.
      await client.query('begin');
      for (const statement of migration.statements) await client.query(statement);
      await client.query(`insert into timeweft_migrations (number, name) values ($1, $2)`, [migration.number, migration.name]);
      await client.query('commit');
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  const older = await openStore(testDatabaseUrl(), { schema });
  try {
    // Written as the store before migration 6 wrote them: a waypoint has no withdrawal column yet.
    const runId = randomUUID();
    await client.query(`insert into runs (id, slug, title, status) values ($1, 'the-older-ford', 'The Ford', 'binding')`, [runId]);
    await client.query(`insert into waypoints (id, run_id, text) values ($1, $2, 'The ferry crosses at night.')`, [randomUUID(), runId]);
    await older.migrate();
    const snapshot = await older.snapshotOf('the-older-ford', 'author');
    assert.deepEqual(snapshot.waypoints.map((each) => [each.text, each.withdrawnInSceneId]), [['The ferry crosses at night.', null]]);
    assert.deepEqual([snapshot.runEdits, snapshot.entryEdits, snapshot.waypointRewordings], [[], [], []]);
    await older.rewordWaypoint(inputOf('reword_waypoint', { waypoint: snapshot.waypoints[0]!.id, text: 'The ferry crosses at dawn.' }));
    assert.equal((await older.snapshotOf('the-older-ford', 'story')).waypoints[0]!.text, 'The ferry crosses at dawn.');
  } finally {
    await older.close();
    await client.query(`drop schema ${schema} cascade`);
    await client.end();
  }
});

// What the review found

test('turning a place author-only takes every journey leg naming it out of the story view, and back', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({
    run: slug,
    entries: [{ name: 'the weir', kind: 'place' }, { name: 'the mill', kind: 'place' }],
    legs: [{ from: 'the weir', to: 'the mill', duration: 'an hour', note: 'by punt' }],
  }));
  const weir = entryIdNamed(await authorView(slug), 'the weir');
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: weir, visibility: 'author-only' }));
  const story = await storyView(slug);
  assert.deepEqual(story.legs, []);
  assert.ok(!JSON.stringify(story).includes('weir'), 'the hidden name reaches a story nowhere');
  assert.equal((await authorView(slug)).legs.length, 1, 'the author still has the leg');
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: weir, visibility: 'open' }));
  assert.deepEqual((await storyView(slug)).legs.map((leg) => leg.fromPlace), ['the weir']);
});

test("a save's answer names no author-only entry through a thread the author opened", async () => {
  const { slug } = await runWithAScene();
  const ferry = entryIdNamed(await authorView(slug), 'the ferry');
  const thread = await store.openThread(inputOf('open_thread', { run: slug, text: 'A claim on the mill', aboutEntryIds: [ferry] }));
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: ferry, visibility: 'author-only' }));
  const saved = await store.saveScene(sceneInput({ run: slug, threadsTouched: [{ thread: thread.id, note: 'It came up.' }] }));
  assert.deepEqual(saved.threadsTouched.map((each) => each.aboutEntryIds), [[]]);
  assert.ok(!JSON.stringify(saved).includes(ferry));
});

test('a thread cannot be opened about an author-only entry, as a ruling cannot name one', async () => {
  const slug = await freshRun();
  const heir = await store.addEntry(inputOf('add_entry', { run: slug, name: 'the secret heir', kind: 'person', visibility: 'author-only' }));
  await assert.rejects(
    store.openThread(inputOf('open_thread', { run: slug, text: 'A claim on the mill', aboutEntryIds: [heir.entry.id] })),
    refusedSaying(/author-only, and a thread is told to a story/));
  assert.deepEqual((await authorView(slug)).threads, []);
});

test("a redo that names an entry again keeps the author's pronoun and other names on it", async () => {
  const { slug } = await runWithAScene();
  const ferry = entryIdNamed(await authorView(slug), 'the ferry');
  await store.editEntry(inputOf('edit_entry', { entry: ferry, pronoun: 'she', alsoKnownAs: ['the boat'] }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 1, entries: [{ name: 'the ferry', kind: 'item' }] }));
  assert.deepEqual(redone.entriesAdded.map((entry) => entry.id), [ferry]);
  const kept = (await storyView(slug)).entries.find((entry) => entry.id === ferry)!;
  assert.equal(kept.pronoun, 'she');
  assert.deepEqual(kept.alsoKnownAs, ['the boat']);
});

test('an entry the author renamed is taken up again by a redo naming its old name, and keeps the new one', async () => {
  const { slug } = await runWithAScene();
  const ferry = entryIdNamed(await authorView(slug), 'the ferry');
  await store.renameEntry(inputOf('rename_entry', { entry: ferry, name: 'the old ferry' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 1, entries: [{ name: 'the ferry', kind: 'item' }] }));
  assert.deepEqual(redone.entriesAdded.map((entry) => [entry.id, entry.name]), [[ferry, 'the old ferry']]);
  const story = await storyView(slug);
  assert.deepEqual(story.entries.filter((entry) => /ferry/.test(entry.name)).map((entry) => entry.id), [ferry]);
  assert.equal((await authorView(slug)).entries.filter((entry) => /ferry/.test(entry.name)).length, 1, 'no second ferry was made');
});

test('an entry of the redone take that the author edited stays, though the new take does not name it', async () => {
  for (const act of ['rename', 'pronoun', 'kind'] as const) {
    const { slug } = await runWithAScene();
    const ferry = entryIdNamed(await authorView(slug), 'the ferry');
    if (act === 'rename') await store.renameEntry(inputOf('rename_entry', { entry: ferry, name: 'the old ferry' }));
    if (act === 'pronoun') await store.editEntry(inputOf('edit_entry', { entry: ferry, pronoun: 'it' }));
    if (act === 'kind') await store.editEntry(inputOf('edit_entry', { entry: ferry, kind: 'other' }));
    await store.redoScene(redoInput({ run: slug, number: 1 }));
    assert.ok((await storyView(slug)).entries.some((entry) => entry.id === ferry), `after a ${act} the entry is still served`);
  }
});

test('an entry turned author-only, its scene redone, then turned open again comes back, with a caution where its name is shared', async () => {
  const { slug } = await runWithAScene();
  const lantern = entryIdNamed(await authorView(slug), 'the lantern');
  await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: lantern, visibility: 'author-only' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 1, entries: [{ name: 'the lantern', kind: 'item' }] }));
  assert.notEqual(redone.entriesAdded[0]!.id, lantern, 'a story cannot name the hidden one, so it made its own');
  const opened = await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: lantern, visibility: 'open' }));
  assert.ok((await storyView(slug)).entries.some((entry) => entry.id === lantern));
  assert.equal(opened.cautions.length, 1);
  assert.match(opened.cautions[0]!, /"the lantern" also answers to/);
});

test('turning an entry open again says so when a story has since made another of the same name', async () => {
  const { slug } = await runWithAScene();
  const ferry = entryIdNamed(await authorView(slug), 'the ferry');
  const hidden = await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: ferry, visibility: 'author-only' }));
  assert.deepEqual(hidden.cautions, []);
  await store.saveScene(sceneInput({ run: slug, entries: [{ name: 'the ferry', kind: 'item' }] }));
  const opened = await store.setEntryVisibility(inputOf('set_entry_visibility', { entry: ferry, visibility: 'open' }));
  assert.match(opened.cautions.join(' '), /"the ferry" also answers to/);
});

test("a redo touching a thread the author touched at that scene keeps the author's note, through a second redo too", async () => {
  const { slug } = await runWithAScene();
  const thread = await store.openThread(inputOf('open_thread', { run: slug, text: 'Who broke the wheel?' }));
  await store.touchThread(inputOf('touch_thread', { thread: thread.id, note: 'The author noted it.' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 1, threadsTouched: [{ thread: thread.id, note: 'The story touched it.' }] }));
  assert.match(redone.cautions.join(' '), /author's note was kept/);
  const touchesNow = async () => (await authorView(slug)).threads.find((each) => each.id === thread.id)!.touches.map((touch) => touch.note);
  assert.deepEqual(await touchesNow(), ['The author noted it.']);
  await store.redoScene(redoInput({ run: slug, number: 1 }));
  assert.deepEqual(await touchesNow(), ['The author noted it.']);
});

test("a redo of the scene that opened a thread the author closed keeps the author's resolution", async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, threadsOpened: [{ text: 'Where is the key?' }] }));
  const thread = (await authorView(slug)).threads[0]!;
  await store.touchThread(inputOf('touch_thread', { thread: thread.id, note: 'The author touched it.' }));
  await store.closeThread(inputOf('close_thread', { thread: thread.id, resolution: 'The miller had it all along.' }));
  await store.redoScene(redoInput({ run: slug, number: 1 }));
  const author = await authorView(slug);
  const kept = author.threads.find((each) => each.id === thread.id)!;
  assert.equal(kept.resolution, 'The miller had it all along.');
  assert.equal(kept.closedInSceneId, kept.openedInSceneId, 'it stays on the struck take it was opened in');
  assert.deepEqual(kept.touches, [], "the author's touch stays on the struck take with its thread, where it no longer counts");
  assert.ok(!(await storyView(slug)).threads.some((each) => each.id === thread.id), 'the thread is taken back from a story');
});

test('an entry a redo took back is not edited, renamed or turned', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, entries: [{ name: 'a ghost', kind: 'person' }] }));
  const ghost = entryIdNamed(await authorView(slug), 'a ghost');
  await store.redoScene(redoInput({ run: slug, number: 1 }));
  await assert.rejects(store.editEntry(inputOf('edit_entry', { entry: ghost, pronoun: 'she' })), refusedSaying(/took it back/));
  await assert.rejects(store.renameEntry(inputOf('rename_entry', { entry: ghost, name: 'a wraith' })), refusedSaying(/took it back/));
  await assert.rejects(store.setEntryVisibility(inputOf('set_entry_visibility', { entry: ghost, visibility: 'author-only' })), refusedSaying(/took it back/));
  assert.deepEqual((await authorView(slug)).entryEdits, []);
});

test('state_fact refuses a value of only spaces, and keeps a value trimmed', async () => {
  const { slug } = await runWithAScene();
  const lantern = entryIdNamed(await authorView(slug), 'the lantern');
  await assert.rejects(store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'mood', value: '   ' })), refusedSaying(/only spaces/));
  const stated = await store.stateFact(stateFactInput({ run: slug, entryId: lantern, property: 'mood', value: ' dim ' }));
  assert.equal(stated.value, 'dim');
});
