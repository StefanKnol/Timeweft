/**
 * Every operation run end to end over real HTTP on a real port, against a seeded demo run, each
 * answer checked for its shape.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATION_NAMES, type AnswerByOperation, type OperationName } from '@timeweft/contract';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
before(async () => {
  running = await startServerForTests();
});
after(async () => {
  await running.stop();
});

async function answerOf<Name extends OperationName>(name: Name, input: unknown): Promise<AnswerByOperation[Name]> {
  const { status, body } = await running.call(name, input);
  assert.equal(status, 200, `${name} answered ${status}: ${body.refusal ?? ''}`);
  assert.equal(body.ok, true);
  return body.answer as AnswerByOperation[Name];
}

const ran = new Set<OperationName>();

test('every operation runs end to end', async () => {
  const slug = 'the-ford';
  const begun = await answerOf('begin_run', {
    slug, title: 'The Ford', setting: 'A river valley with one ford.',
    clocks: [{ name: 'days since the flood', countsFrom: 'the morning the river rose' }],
    waypoints: ['The ferry crosses at night.'],
  });
  ran.add('begin_run');
  assert.equal(begun.run.slug, slug);
  assert.equal(begun.clocks.length, 1);

  const first = await answerOf('save_scene', {
    run: slug, title: 'Flour at dusk', when: 'the third evening', place: 'the ford',
    summary: 'The miller crosses to the ford with the lantern.', situationAfter: 'The miller waits at the ford.',
    readings: [{ clock: 'days since the flood', count: 3, partOfDay: 'dusk' }],
    entries: [
      { name: 'Odo the miller', kind: 'person', alsoKnownAs: ['the miller'], pronoun: 'he' },
      { name: 'the lantern', kind: 'item' },
      { name: 'the ford', kind: 'place' },
      { name: 'the ferry', kind: 'item' },
    ],
    facts: [{ entry: 'the lantern', property: 'held by', value: 'the miller carries it', about: 'the miller' }],
    notes: [{ entry: 'Odo the miller', text: 'He lit the lantern at the ford.' }],
    rulings: [{ text: 'Call him the miller in narration.', topics: ['narration'], about: ['Odo the miller'] }],
    threadsOpened: [{ text: 'Who cut the ferry rope?', about: ['the ferry'] }],
  });
  ran.add('save_scene');
  assert.equal(first.scene.number, 1);
  assert.equal(first.entriesAdded.length, 4);
  assert.equal(first.threadsOpened.length, 1);

  const second = await answerOf('save_scene', { run: slug, title: 'The ferry', when: 'the fourth morning', summary: 'The ferry is gone.', situationAfter: 'The ford is empty.' });
  const redone = await answerOf('redo_scene', { run: slug, number: 2, title: 'The ferry returns', when: 'the fourth morning', summary: 'The ferry comes back.', situationAfter: 'The ferry is moored.' });
  ran.add('redo_scene');
  assert.equal(redone.scene.number, second.scene.number);
  assert.notEqual(redone.scene.id, second.scene.id);

  const listings = await answerOf('list_runs', {});
  ran.add('list_runs');
  assert.equal(listings[0]!.run.slug, slug);
  assert.equal(listings[0]!.standingScenes, 2);

  const briefing = await answerOf('resume_run', { run: slug, upcoming: ['the miller'], budgetBytes: 4000 });
  ran.add('resume_run');
  assert.ok(briefing.bytes <= 4000);
  assert.match(briefing.text, /The ferry comes back/);

  const inFull = await answerOf('read_scene', { run: slug, number: 1 });
  ran.add('read_scene');
  assert.equal(inFull.scene.title, 'Flour at dusk');
  assert.equal(inFull.entriesIntroduced.length, 4);

  const summaries = await answerOf('list_scenes', { run: slug, from: 1, to: 2 });
  ran.add('list_scenes');
  assert.deepEqual(summaries.map((scene) => scene.number), [1, 2]);
  assert.ok(!('record' in summaries[0]!), 'a listing leaves the record out');

  const lookup = await answerOf('look_up', { run: slug, name: 'the lantern' });
  ran.add('look_up');
  assert.equal(lookup.entry.name, 'the lantern');
  assert.equal(lookup.holding[0]!.property, 'held by');

  const found = await answerOf('find', { run: slug, text: 'lantern' });
  ran.add('find');
  assert.ok(found.length > 0);
  assert.ok(found.every((item) => typeof item.text === 'string'));

  const rulings = await answerOf('list_rulings', { run: slug, about: ['the miller'] });
  ran.add('list_rulings');
  assert.equal(rulings.length, 1);

  const threads = await answerOf('list_threads', { run: slug, about: ['the ferry'] });
  ran.add('list_threads');
  assert.equal(threads.length, 1);

  const ruling = await answerOf('record_ruling', { run: slug, text: 'No crossings after dark.', topics: ['time'] });
  ran.add('record_ruling');
  assert.equal(ruling.number, 2);

  const fact = await answerOf('state_fact', { run: slug, entry: 'the ford', property: 'depth', value: 'knee deep' });
  ran.add('state_fact');
  assert.equal(fact.source, 'author');

  const colliding = await answerOf('save_scene', {
    run: slug, title: 'Flood', when: 'the fifth morning', summary: 'The water rose.', situationAfter: 'The ford is deep.',
    facts: [{ entry: 'the ford', property: 'depth', value: 'over a man\'s head' }],
  });
  assert.equal(colliding.collisions.length, 1);

  const collisions = await answerOf('list_collisions', { run: slug });
  ran.add('list_collisions');
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]!.state, 'waiting');

  const settled = await answerOf('settle_collision', { collision: collisions[0]!.id, take: 'author' });
  ran.add('settle_collision');
  assert.equal(settled.state, 'author-kept');

  const whole = await answerOf('read_run', { run: slug });
  ran.add('read_run');
  assert.equal(whole.scenes.filter((scene) => scene.status === 'struck').length, 1, 'the author sees the struck take');
  assert.equal(whole.collisions.length, 1);
  const struckTake = whole.scenes.find((scene) => scene.status === 'struck')!;
  const struckText = await answerOf('read_scene_text', { run: slug, sceneId: struckTake.id });
  ran.add('read_scene_text');
  assert.equal(struckText.status, 'struck');
  assert.equal(struckText.number, struckTake.number);
  const scenesHoldingTheTitle = await answerOf('search_scenes', { run: slug, text: struckTake.title, includeStruck: true });
  ran.add('search_scenes');
  assert.ok(scenesHoldingTheTitle.matches.some((match) => match.sceneId === struckTake.id), 'the struck take is found when struck takes are asked for');

  // The author's hand, each act once, on the run as it now stands: three standing scenes.
  const newestScene = whole.scenes.filter((scene) => scene.status === 'standing').at(-1)!;
  const firstScene = whole.scenes.find((scene) => scene.status === 'standing' && scene.number === 1)!;
  const lantern = whole.entries.find((entry) => entry.name === 'the lantern')!;
  const ferryThread = whole.threads.find((thread) => thread.text === 'Who cut the ferry rope?')!;

  const waypoint = await answerOf('add_waypoint', { run: slug, text: 'The miller reaches the far bank.' });
  ran.add('add_waypoint');
  assert.equal(waypoint.reachedInSceneId, null);
  assert.equal(waypoint.withdrawnInSceneId, null);

  const reworded = await answerOf('reword_waypoint', { waypoint: waypoint.id, text: 'The miller reaches the far bank by night.' });
  ran.add('reword_waypoint');
  assert.equal(reworded.id, waypoint.id, 'a reworded waypoint keeps its id');
  assert.equal(reworded.text, 'The miller reaches the far bank by night.');

  const reached = await answerOf('mark_waypoint_reached', { waypoint: waypoint.id, scene: 1 });
  ran.add('mark_waypoint_reached');
  assert.equal(reached.reachedInSceneId, firstScene.id, 'reached at the scene the author named');

  const withdrawnWaypoint = await answerOf('withdraw_waypoint', { waypoint: begun.waypoints[0]!.id });
  ran.add('withdraw_waypoint');
  assert.equal(withdrawnWaypoint.withdrawnInSceneId, newestScene.id);

  const edited = await answerOf('edit_run', { run: slug, register: 'Plain past tense.' });
  ran.add('edit_run');
  assert.equal(edited.register, 'Plain past tense.');
  assert.equal(edited.title, 'The Ford', 'what was not given stays');

  const opened = await answerOf('open_thread', { run: slug, text: 'Where did the water come from?', aboutEntryIds: [lantern.id] });
  ran.add('open_thread');
  assert.equal(opened.openedInSceneId, newestScene.id);
  assert.deepEqual(opened.aboutEntryIds, [lantern.id]);

  const touched = await answerOf('touch_thread', { thread: ferryThread.id, note: 'The rope was found frayed.' });
  ran.add('touch_thread');
  assert.ok(touched.touches.some((touch) => touch.sceneId === newestScene.id && touch.note === 'The rope was found frayed.'));

  const closed = await answerOf('close_thread', { thread: opened.id, resolution: 'From the hills.' });
  ran.add('close_thread');
  assert.equal(closed.closedInSceneId, newestScene.id);
  assert.equal(closed.resolution, 'From the hills.');

  const added = await answerOf('add_entry', { run: slug, name: 'Hild the baker', kind: 'person', pronoun: 'she', visibility: 'open' });
  ran.add('add_entry');
  assert.equal(added.entry.source, 'author');
  assert.equal(added.entry.introducedInSceneId, null);
  assert.deepEqual(added.cautions, []);

  const entryEdited = await answerOf('edit_entry', { entry: added.entry.id, alsoKnownAs: ['the baker'] });
  ran.add('edit_entry');
  assert.deepEqual(entryEdited.entry.alsoKnownAs, ['the baker']);

  const renamed = await answerOf('rename_entry', { entry: added.entry.id, name: 'Hild of the bakehouse' });
  ran.add('rename_entry');
  assert.equal(renamed.entry.name, 'Hild of the bakehouse');
  assert.ok(renamed.entry.alsoKnownAs.includes('Hild the baker'), 'the old name stays among its other names');

  const hidden = await answerOf('set_entry_visibility', { entry: added.entry.id, visibility: 'author-only' });
  ran.add('set_entry_visibility');
  assert.equal(hidden.entry.visibility, 'author-only');

  const editedScene = await answerOf('edit_scene', { run: slug, sceneId: firstScene.id, title: 'Flour at nightfall', starred: true, placeEntryId: null });
  ran.add('edit_scene');
  assert.equal(editedScene.scene.id, firstScene.id, 'an edited scene keeps its id');
  assert.equal(editedScene.scene.title, 'Flour at nightfall');
  assert.deepEqual(editedScene.fieldsChanged, ['title', 'placeEntryId', 'starred']);
  assert.equal(editedScene.edits[0]!.earlierValue, 'Flour at dusk');

  const ended = await answerOf('end_fact', { fact: fact.id });
  ran.add('end_fact');
  assert.equal(ended.id, fact.id);
  assert.equal(ended.untilSceneId, newestScene.id);

  const withdrawnRuling = await answerOf('withdraw_ruling', { ruling: ruling.id });
  ran.add('withdraw_ruling');
  assert.equal(withdrawnRuling.withdrawnInSceneId, newestScene.id);
  assert.equal(withdrawnRuling.text, 'No crossings after dark.', 'kept word for word');

  const imported = await answerOf('import_run', {
    slug: 'the-weir-mill', title: 'The Weir Mill',
    files: { log: '# The Weir Mill - Log\n\n## Scene 1: The wheel\n**When:** the first morning\nThe miller turns the wheel.\n' },
  });
  ran.add('import_run');
  assert.equal(imported.run.slug, 'the-weir-mill');
  assert.equal(imported.counts.scenes, 1);
  assert.ok(Array.isArray(imported.unplaced));

  // The run as it now stands holds a redo, a settled collision and every act of the author's hand,
  // so a backup of it carries every kind of row a run has, and a restore puts each back.
  const backup = await answerOf('export_run', { run: slug });
  ran.add('export_run');
  assert.equal(backup.runSlug, slug);
  assert.equal(backup.tables.collisions.length, 1);
  assert.ok(backup.tables.run_edits.length > 0 && backup.tables.entry_edits.length > 0 && backup.tables.scene_edits.length > 0 && backup.tables.thread_touches.length > 0);

  const restored = await answerOf('restore_run', { document: backup, replace: true });
  ran.add('restore_run');
  assert.equal(restored.run.slug, slug);
  assert.deepEqual(restored.replaced?.rowsRemoved, restored.rowsRestored, 'replacing a run with its own backup removes what it puts back');
  const { exportedAt: _takenThen, ...backupAsTaken } = backup;
  const { exportedAt: _takenNow, ...backupAgain } = await answerOf('export_run', { run: slug });
  assert.deepEqual(backupAgain, backupAsTaken);

  assert.deepEqual([...ran].sort(), [...OPERATION_NAMES].sort(), 'some operation was not run end to end');
});

test('a refusal is a 400 with a sentence, and a parse failure names the field', async () => {
  const unknownRun = await running.call('read_scene', { run: 'no-such-run', number: 1 });
  assert.equal(unknownRun.status, 400);
  assert.equal(unknownRun.body.ok, false);
  assert.match(unknownRun.body.refusal ?? '', /no run called "no-such-run"/);

  const badField = await running.call('read_scene', { run: 'the-ford', number: 'one' });
  assert.equal(badField.status, 400);
  assert.match(badField.body.refusal ?? '', /"number"/);
});
