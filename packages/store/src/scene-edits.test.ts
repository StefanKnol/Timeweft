/**
 * The author edits a saved scene: the scene keeps its id and holds the newest words, each field
 * changed is a history row with both values dated after the newest standing scene, a story reads
 * only the newest wording, and nothing the scene established moves. A redo leaves the edits on the
 * struck take and moves their date onto the new take. See docs/decisions/0005-the-pages.md.
 *
 * A made-up demo world: a miller, a ferry, a ford and a lantern.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EarlierImportStandsInTheWay, OPERATIONS, RUN_EXPORT_TABLE_NAMES, Refusal, readRunExportDocument,
  type InputOf, type RequestOf, type RunExportDocument, type RunSnapshot, type Store,
} from '@timeweft/contract';
// The briefing is a pure package beside this one, read here to hold what a story is served.
import { buildBriefing, sceneInFull, standingScenesOf } from '../../briefing/src/index.ts';
import { openStoreForTests, type PostgresStore } from './index.ts';
import { beginDemoRun, redoInput, sceneInput } from './demo-world.ts';

let store: Store;
let dispose: () => Promise<void>;
let elsewhere: Store;
let disposeElsewhere: () => Promise<void>;
let runCounter = 0;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
  ({ store: elsewhere, dispose: disposeElsewhere } = await openStoreForTests());
});
after(async () => {
  await dispose();
  await disposeElsewhere();
});

function editInput(request: RequestOf<'edit_scene'>): InputOf<'edit_scene'> {
  return OPERATIONS.edit_scene.input.parse(request);
}

/** A run of two scenes at the ford, the first establishing a fact, a note, a ruling, a thread and a leg. */
async function runOfTwoScenes(): Promise<{ slug: string; firstId: string; secondId: string }> {
  runCounter += 1;
  const slug = `edited-ford-${runCounter}`;
  await beginDemoRun(store, slug);
  const first = await store.saveScene(sceneInput({
    run: slug, title: 'Flour at dusk', when: 'the third evening', place: 'the ford',
    summary: 'The miller crosses with the lantern.', record: 'The miller lifted the lantern and waded in.',
    situationAfter: 'The miller waits at the ford.',
    entries: [
      { name: 'Odo the miller', kind: 'person', pronoun: 'he' }, { name: 'the lantern', kind: 'item' },
      { name: 'the ford', kind: 'place' }, { name: 'the mill', kind: 'place' },
    ],
    facts: [{ entry: 'the lantern', property: 'held by', value: 'Odo', about: 'Odo the miller' }],
    notes: [{ entry: 'the lantern', text: 'It was lit at dusk.' }],
    rulings: [{ text: 'Nobody swims the ford.' }],
    threadsOpened: [{ text: 'Who cut the ferry rope?' }],
    legs: [{ from: 'the mill', to: 'the ford', duration: 'an hour', note: '' }],
  }));
  const second = await store.saveScene(sceneInput({
    run: slug, title: 'The ferry drifts', summary: 'The ferry is gone.', record: 'The rope hung loose.', situationAfter: 'The ford is empty.',
  }));
  return { slug, firstId: first.scene.id, secondId: second.scene.id };
}

async function authorView(slug: string): Promise<RunSnapshot> {
  return store.snapshotOf(slug, 'author');
}

async function storyView(slug: string): Promise<RunSnapshot> {
  return store.snapshotOf(slug, 'story');
}

function refusedWith(pattern: RegExp) {
  return (error: unknown) => error instanceof Refusal && pattern.test(error.message);
}

test('an edit keeps the scene its id, holds the newest words, and keeps each earlier value as a row', async () => {
  const { slug, firstId, secondId } = await runOfTwoScenes();
  const edited = await store.editScene(editInput({
    run: slug, sceneId: firstId, title: '  Flour at nightfall  ', record: 'The miller lifted the lantern high and waded in.', summary: 'The miller crosses with the lantern.',
  }));
  assert.equal(edited.scene.id, firstId);
  assert.equal(edited.scene.title, 'Flour at nightfall', 'a title is trimmed');
  assert.equal(edited.scene.record, 'The miller lifted the lantern high and waded in.');
  assert.deepEqual(edited.fieldsChanged, ['title', 'record'], 'a field given as it was is not counted');
  const whole = await authorView(slug);
  assert.equal(whole.scenes.filter((scene) => scene.number === 1).length, 1, 'no second take is written');
  assert.deepEqual(whole.sceneEdits.map((edit) => [edit.sceneId, edit.field, edit.earlierValue, edit.laterValue, edit.afterSceneId]), [
    [firstId, 'title', 'Flour at dusk', 'Flour at nightfall', secondId],
    [firstId, 'record', 'The miller lifted the lantern and waded in.', 'The miller lifted the lantern high and waded in.', secondId],
  ]);
  assert.deepEqual(edited.edits, whole.sceneEdits);
});

test('a place is kept as its id or nothing, and a star as true or false', async () => {
  const { slug, firstId } = await runOfTwoScenes();
  const whole = await authorView(slug);
  const ford = whole.entries.find((entry) => entry.name === 'the ford')!;
  const mill = whole.entries.find((entry) => entry.name === 'the mill')!;
  await store.editScene(editInput({ run: slug, sceneId: firstId, placeEntryId: mill.id }));
  await store.editScene(editInput({ run: slug, sceneId: firstId, placeEntryId: null }));
  const starred = await store.editScene(editInput({ run: slug, sceneId: firstId, starred: true }));
  assert.equal(starred.scene.placeEntryId, null);
  assert.equal(starred.scene.starred, true);
  assert.deepEqual(starred.edits.map((edit) => [edit.field, edit.earlierValue, edit.laterValue]), [['starred', 'false', 'true']], 'a star alone writes one row');
  assert.deepEqual((await authorView(slug)).sceneEdits.map((edit) => [edit.field, edit.earlierValue, edit.laterValue]), [
    ['placeEntryId', ford.id, mill.id], ['placeEntryId', mill.id, ''], ['starred', 'false', 'true'],
  ]);
});

test('every refusal changes nothing', async () => {
  const { slug, firstId } = await runOfTwoScenes();
  const other = await runOfTwoScenes();
  const before = await authorView(slug);
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: randomUUID(), title: 'Lost' })), refusedWith(/holds no scene with the id/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: 'scene-one', title: 'Lost' })), refusedWith(/holds no scene with the id "scene-one"/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: other.firstId, title: 'Lost' })), refusedWith(/holds no scene with the id/), 'a scene of another run');
  await assert.rejects(store.editScene(editInput({ run: 'no-such-ford', sceneId: firstId, title: 'Lost' })), refusedWith(/no run called "no-such-ford"/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId })), refusedWith(/^Nothing given differs from what scene 1 holds/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, title: 'Flour at dusk', starred: false })), refusedWith(/^Nothing given differs/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, title: '   ' })), refusedWith(/A title needs some words/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, title: '' })), refusedWith(/A title needs some words; none were given/));
  // Every resume reads these, so a blank one is refused as a blank title is; the record and steer may be empty.
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, summary: '' })), refusedWith(/^A summary needs some words/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, summary: ' \n ' })), refusedWith(/^A summary needs some words; only spaces/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, whenTyped: '' })), refusedWith(/^When it happens needs some words/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, situationAfter: '  ' })), refusedWith(/^Where things stand after the scene needs some words/));
  const otherPlace = (await authorView(other.slug)).entries.find((entry) => entry.name === 'the mill')!;
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, placeEntryId: otherPlace.id })), refusedWith(/no entry with the id .* for the scene to be set at/));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: firstId, placeEntryId: 'the mill' })), refusedWith(/no entry with the id "the mill"/));
  assert.deepEqual(await authorView(slug), before);
});

test('a struck take is refused, naming the standing take of its scene', async () => {
  const { slug, secondId } = await runOfTwoScenes();
  await store.redoScene(redoInput({ run: slug, number: 2, title: 'The ferry returns' }));
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: secondId, title: 'Lost' })),
    refusedWith(/^A struck take is kept as it was; edit the standing take of scene 2\.$/));
  assert.deepEqual((await authorView(slug)).sceneEdits, []);
});

test('a place a redo took back is refused', async () => {
  const { slug } = await runOfTwoScenes();
  const third = await store.saveScene(sceneInput({ run: slug, title: 'The weir', entries: [{ name: 'the weir', kind: 'place' }] }));
  const weir = (await authorView(slug)).entries.find((entry) => entry.name === 'the weir')!;
  await store.redoScene(redoInput({ run: slug, number: 3, title: 'The bank' }));
  const newest = (await authorView(slug)).scenes.find((scene) => scene.number === 3 && scene.status === 'standing')!;
  assert.notEqual(newest.id, third.scene.id);
  await assert.rejects(store.editScene(editInput({ run: slug, sceneId: newest.id, placeEntryId: weir.id })),
    refusedWith(/"the weir" was introduced by a scene that has since been redone/));
});

test('an author-only entry may be the place, and a story is served the scene with no place', async () => {
  const { slug, firstId } = await runOfTwoScenes();
  const hidden = await store.addEntry(OPERATIONS.add_entry.input.parse({ run: slug, name: 'the drowned bell', kind: 'place', visibility: 'author-only' }));
  await store.editScene(editInput({ run: slug, sceneId: firstId, placeEntryId: hidden.entry.id }));
  assert.equal((await authorView(slug)).scenes.find((scene) => scene.id === firstId)!.placeEntryId, hidden.entry.id);
  assert.equal((await storyView(slug)).scenes.find((scene) => scene.id === firstId)!.placeEntryId, null);
});

test('a story reads only the newest wording and never an edit or an earlier wording', async () => {
  const { slug, firstId, secondId } = await runOfTwoScenes();
  await store.editScene(editInput({ run: slug, sceneId: firstId, title: 'Flour at nightfall', record: 'The miller waded in without a word.', steer: 'Keep it quiet.' }));
  await store.editScene(editInput({ run: slug, sceneId: secondId, situationAfter: 'The ford is empty and the rope is cut.', summary: 'The ferry drifted off.' }));
  const story = await storyView(slug);
  assert.deepEqual(story.sceneEdits, [], 'a story is served no edits');
  const read = sceneInFull(story, 1);
  assert.equal(read.scene.title, 'Flour at nightfall');
  assert.equal(read.scene.record, 'The miller waded in without a word.');
  const listed = standingScenesOf(story).map((scene) => [scene.title, scene.summary]);
  assert.deepEqual(listed, [['Flour at nightfall', 'The miller crosses with the lantern.'], ['The ferry drifts', 'The ferry drifted off.']]);
  const briefing = JSON.stringify(buildBriefing(story, { upcoming: ['Odo the miller'], budgetBytes: 40_000 }));
  assert.ok(briefing.includes('The ford is empty and the rope is cut.'), 'the resume reads the newest situation');
  assert.ok(briefing.includes('The ferry drifted off.'));
  for (const earlier of ['Flour at dusk', 'The miller lifted the lantern and waded in.', 'The ford is empty.', 'The ferry is gone.']) {
    assert.equal(JSON.stringify(story).includes(`"${earlier}"`), false, `a story is served "${earlier}"`);
    assert.equal(briefing.includes(`"${earlier}"`) || briefing.includes(`${earlier}\\n`), false, `the resume holds "${earlier}"`);
  }
});

test('an edit moves no fact, note, ruling, thread or leg', async () => {
  const { slug, firstId } = await runOfTwoScenes();
  const before = await authorView(slug);
  const mill = before.entries.find((entry) => entry.name === 'the mill')!;
  await store.editScene(editInput({ run: slug, sceneId: firstId, title: 'Flour at nightfall', placeEntryId: mill.id, record: 'Changed.', starred: true }));
  const after = await authorView(slug);
  for (const part of ['entries', 'facts', 'notes', 'rulings', 'threads', 'legs', 'waypoints', 'collisions', 'runEdits', 'entryEdits'] as const) {
    assert.deepEqual(after[part], before[part], part);
  }
});

test('a redo of the edited newest scene leaves the edits on the struck take, moves their date, and says so', async () => {
  const { slug, firstId, secondId } = await runOfTwoScenes();
  await store.editScene(editInput({ run: slug, sceneId: secondId, title: 'The ferry drifts away', starred: true }));
  await store.editScene(editInput({ run: slug, sceneId: firstId, steer: 'Slow down here.' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 2, title: 'The ferry returns' }));
  assert.ok(redone.cautions.includes('The struck take carried 2 edits by the author; they stay with it.'), redone.cautions.join(' | '));
  const whole = await authorView(slug);
  const newTake = redone.scene.id;
  assert.deepEqual(whole.sceneEdits.map((edit) => [edit.sceneId, edit.field, edit.afterSceneId]), [
    [secondId, 'title', newTake], [secondId, 'starred', newTake], [firstId, 'steer', newTake],
  ]);
  assert.equal(redone.scene.title, 'The ferry returns', 'the new take is written from the redo, not from the edits');
  assert.equal(redone.scene.starred, false);
  const once = await store.redoScene(redoInput({ run: slug, number: 2, title: 'The ferry returns at last' }));
  assert.equal(once.cautions.some((caution) => /edits? by the author/.test(caution)), false, 'a take nobody edited carries nothing to say');
  await store.editScene(editInput({ run: slug, sceneId: once.scene.id, title: 'One edit' }));
  const third = await store.redoScene(redoInput({ run: slug, number: 2, title: 'Last take' }));
  assert.ok(third.cautions.includes('The struck take carried 1 edit by the author; it stays with it.'));
});

test('export and restore carry the edits, and a restored scene edits on', async () => {
  const { slug, firstId } = await runOfTwoScenes();
  await store.editScene(editInput({ run: slug, sceneId: firstId, title: 'Flour at nightfall', starred: true }));
  const document = await store.exportRun(slug);
  assert.equal(document.formatVersion, 2);
  assert.equal(document.tables.scene_edits.length, 2);
  const report = await elsewhere.restoreRun(JSON.parse(JSON.stringify(document)) as RunExportDocument, { replace: false });
  assert.equal(report.rowsRestored.scene_edits, 2);
  const { exportedAt: _here, ...here } = document;
  const { exportedAt: _there, ...there } = await elsewhere.exportRun(slug);
  assert.deepEqual(there, here);
  assert.deepEqual(await elsewhere.snapshotOf(slug, 'author'), await authorView(slug));
  const again = await elsewhere.editScene(editInput({ run: slug, sceneId: firstId, title: 'Flour by moonlight' }));
  assert.equal(again.edits[0]!.earlierValue, 'Flour at nightfall');
});

test('a version 1 backup restores, read as holding no edits', async () => {
  const { slug } = await runOfTwoScenes();
  const current = await store.exportRun(slug);
  const { scene_edits: _notInVersion1, ...version1Tables } = current.tables;
  const version1 = JSON.parse(JSON.stringify({ ...current, formatVersion: 1, tables: version1Tables })) as unknown;
  const read = readRunExportDocument(version1);
  assert.deepEqual(read.tables.scene_edits, []);
  assert.deepEqual(Object.keys(read.tables).sort(), [...RUN_EXPORT_TABLE_NAMES].sort());
  const report = await elsewhere.restoreRun(read, { replace: false });
  assert.equal(report.rowsRestored.scene_edits, 0);
  // Handed to the store without the reader, it is read the same way.
  await (elsewhere as PostgresStore).database.deleteFrom('runs').where('slug', '=', slug).execute();
  await elsewhere.restoreRun(JSON.parse(JSON.stringify(version1)) as RunExportDocument, { replace: false });
  assert.deepEqual((await elsewhere.snapshotOf(slug, 'author')).scenes, (await authorView(slug)).scenes);
  // A version 1 backup that holds rows of a table added after it was not written by a server.
  const withRows = JSON.parse(JSON.stringify({ ...current, formatVersion: 1 })) as RunExportDocument;
  withRows.tables.scene_edits = [{ ...current.tables.scenes[0]! } as never];
  assert.throws(() => readRunExportDocument(withRows), refusedWith(/format version 1, which has no list for scene_edits/));
});

test('an import with a scene edit after it is not replaced', async () => {
  runCounter += 1;
  const slug = `imported-weir-${runCounter}`;
  const imported = {
    slug, title: 'The Weir', setting: 'A weir below a mill.', status: 'binding' as const, register: '',
    clocks: [], rulings: [], threads: [], waypoints: [], legs: [], unplaced: [], entries: [],
    scenes: [{ number: 1, title: 'Scene 1', starred: false, whenTyped: 'day 1', place: null, summary: 'The water fell.', record: '', steer: '', situationAfter: '', readings: [] }],
  };
  const snapshot = await store.importRun(imported);
  await store.editScene(editInput({ run: slug, sceneId: snapshot.scenes[0]!.id, starred: true }));
  await assert.rejects(store.replaceImportedRun({ ...imported, title: 'The Weir, corrected' }), (error: unknown) =>
    error instanceof EarlierImportStandsInTheWay && /1 change to a saved scene\./.test(error.message));
});

test('the record and the steer may be emptied, and a summary given with spaces around it is kept trimmed', async () => {
  const { slug, firstId } = await runOfTwoScenes();
  const edited = await store.editScene(editInput({ run: slug, sceneId: firstId, record: '', steer: '', summary: '  The miller ground at dusk.  ' }));
  assert.equal(edited.scene.record, '');
  assert.equal(edited.scene.steer, '');
  assert.equal(edited.scene.summary, 'The miller ground at dusk.');
});

test('a save refuses a summary, when or situation of only spaces, which the schema lets through', async () => {
  const { slug } = await runOfTwoScenes();
  const before = await authorView(slug);
  await assert.rejects(store.saveScene(sceneInput({ run: slug, summary: '   ' })), refusedWith(/^A summary needs some words; only spaces/));
  await assert.rejects(store.saveScene(sceneInput({ run: slug, when: ' ' })), refusedWith(/^When it happens needs some words/));
  await assert.rejects(store.saveScene(sceneInput({ run: slug, situationAfter: '\n' })), refusedWith(/^Where things stand after the scene needs some words/));
  await assert.rejects(store.saveScene(sceneInput({ run: slug, title: '  ' })), refusedWith(/^A title needs some words/));
  assert.deepEqual(await authorView(slug), before);
});
