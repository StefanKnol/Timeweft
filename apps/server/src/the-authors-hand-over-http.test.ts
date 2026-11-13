/**
 * The author's hand, over the real web routes: waypoints, the run itself, facts, rulings, threads
 * and entries, each changed from the author's pages, with nothing deleted and nothing written over
 * without keeping what it held. What a story is told is checked through the story operations
 * themselves, and the MCP face is shown to offer none of these acts.
 *
 * The rule every act here is dated by is docs/decisions/0003-the-authors-hand.md: an act made
 * outside a scene is dated to the newest standing scene, and a redo of that scene keeps it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { AnswerByOperation, OperationName, RunSnapshot } from '@timeweft/contract';
import { briefingUri, personUri } from './attachments.ts';
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

/** The sentence a refused act answers with. Fails where the act was not refused. */
async function refusalOf(name: OperationName, input: unknown): Promise<string> {
  const { status, body } = await running.call(name, input);
  assert.equal(status, 400, `${name} was expected to be refused, and answered ${status}`);
  assert.equal(body.ok, false);
  return body.refusal ?? '';
}

async function wholeRun(slug: string): Promise<RunSnapshot> {
  return answerOf('read_run', { run: slug });
}

async function briefingText(slug: string, upcoming: string[] = []): Promise<string> {
  return (await answerOf('resume_run', { run: slug, upcoming, budgetBytes: 200000 })).text;
}

/** A run with one scene at the mill, a miller, a ford and a sack of flour. */
async function beginTheMill(slug: string, waypoints: string[] = []): Promise<RunSnapshot> {
  await answerOf('begin_run', { slug, title: 'The Mill', setting: 'A mill by a ford.', waypoints });
  await answerOf('save_scene', {
    run: slug, title: 'The wheel', when: 'the first morning', place: 'the ford',
    summary: 'The miller turns the wheel.', situationAfter: 'The wheel turns.',
    entries: [
      { name: 'Odo the miller', kind: 'person', alsoKnownAs: ['the miller'], pronoun: 'he' },
      { name: 'the ford', kind: 'place' },
      { name: 'the sack of flour', kind: 'item' },
    ],
    facts: [{ entry: 'Odo the miller', property: 'state', value: 'tired' }],
  });
  return wholeRun(slug);
}

function idOf(snapshot: RunSnapshot, name: string): string {
  const entry = snapshot.entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `no entry called ${name}`);
  return entry.id;
}

test('a waypoint is added, reworded, reached and withdrawn, and a story is told only what still stands, in its newest words', async () => {
  const slug = 'the-mill-waypoints';
  await beginTheMill(slug);

  const ahead = await answerOf('add_waypoint', { run: slug, text: 'The fair comes to the ford.' });
  const reworded = await answerOf('reword_waypoint', { waypoint: ahead.id, text: 'The autumn fair comes to the ford.' });
  assert.equal(reworded.id, ahead.id);
  assert.match(await refusalOf('reword_waypoint', { waypoint: ahead.id, text: 'The autumn fair comes to the ford.' }), /./,
    'the same words again are refused');

  let whole = await wholeRun(slug);
  assert.deepEqual(
    whole.waypointRewordings.filter((rewording) => rewording.waypointId === ahead.id).map((rewording) => [rewording.earlierText, rewording.laterText]),
    [['The fair comes to the ford.', 'The autumn fair comes to the ford.']],
    'what it said before is kept',
  );
  let briefing = await briefingText(slug);
  assert.ok(briefing.includes('The autumn fair comes to the ford.'));
  assert.ok(!briefing.includes('The fair comes to the ford.'), 'only the newest wording is told to a story');

  const toReach = await answerOf('add_waypoint', { run: slug, text: 'The miller sees the sea.' });
  const firstScene = whole.scenes.find((scene) => scene.number === 1)!;
  const reached = await answerOf('mark_waypoint_reached', { waypoint: toReach.id, scene: 1 });
  assert.equal(reached.reachedInSceneId, firstScene.id);
  await refusalOf('mark_waypoint_reached', { waypoint: toReach.id, scene: 1 });

  const withdrawn = await answerOf('withdraw_waypoint', { waypoint: ahead.id });
  assert.equal(withdrawn.withdrawnInSceneId, firstScene.id);
  await refusalOf('withdraw_waypoint', { waypoint: ahead.id });
  await refusalOf('reword_waypoint', { waypoint: ahead.id, text: 'The fair is called off.' });
  await refusalOf('mark_waypoint_reached', { waypoint: ahead.id, scene: 1 });

  briefing = await briefingText(slug);
  assert.ok(!briefing.includes('autumn fair'), 'a withdrawn waypoint is never told to a story');
  whole = await wholeRun(slug);
  const kept = whole.waypoints.find((waypoint) => waypoint.id === ahead.id);
  assert.equal(kept?.text, 'The autumn fair comes to the ford.', 'the author still reads it, withdrawn');
  assert.notEqual(kept?.withdrawnInSceneId, null);
});

test('the run is edited part by part, each earlier value kept, and a story reads the newest', async () => {
  const slug = 'the-mill-edited';
  await beginTheMill(slug);
  const edited = await answerOf('edit_run', {
    run: slug, title: 'The Mill at the Ford', setting: 'A mill by a ford, the year of the flood.', register: 'Close third on the miller.', status: 'telling',
  });
  assert.equal(edited.title, 'The Mill at the Ford');
  assert.equal(edited.status, 'telling');
  await refusalOf('edit_run', { run: slug, title: 'The Mill at the Ford' });

  const whole = await wholeRun(slug);
  assert.deepEqual(
    whole.runEdits.map((edit) => [edit.field, edit.earlierValue, edit.laterValue]).sort(),
    [
      ['register', '', 'Close third on the miller.'],
      ['setting', 'A mill by a ford.', 'A mill by a ford, the year of the flood.'],
      ['status', 'binding', 'telling'],
      ['title', 'The Mill', 'The Mill at the Ford'],
    ],
  );
  const firstScene = whole.scenes.find((scene) => scene.number === 1)!;
  assert.ok(whole.runEdits.every((edit) => edit.afterSceneId === firstScene.id), 'dated after the newest standing scene');
  assert.match(await briefingText(slug), /Close third on the miller\./);
});

test('a fact is stated by id and ended with nothing in its place; the author replaces their own fact without a collision, and a story cannot', async () => {
  const slug = 'the-mill-facts';
  let whole = await beginTheMill(slug);
  const sack = idOf(whole, 'the sack of flour');
  const miller = idOf(whole, 'Odo the miller');

  const held = await answerOf('state_fact', { run: slug, entryId: sack, property: 'held by', value: 'the miller carries it', aboutEntryId: miller, note: 'on his back' });
  assert.equal(held.entryId, sack);
  assert.equal(held.aboutEntryId, miller);
  assert.equal(held.note, 'on his back');
  await refusalOf('state_fact', { run: slug, entry: 'the sack of flour', entryId: sack, property: 'weight', value: 'heavy' });
  await refusalOf('state_fact', { run: slug, property: 'weight', value: 'heavy' });

  const replaced = await answerOf('state_fact', { run: slug, entryId: sack, property: 'held by', value: 'it lies by the wheel' });
  const collisions = await answerOf('list_collisions', { run: slug, waitingOnly: false });
  assert.equal(collisions.length, 0, 'the author\'s later word replaces their earlier one with no collision');

  const storySaid = await answerOf('save_scene', {
    run: slug, title: 'The theft', when: 'the second morning', summary: 'The sack is gone.', situationAfter: 'The wheel is idle.',
    facts: [{ entry: 'the sack of flour', property: 'held by', value: 'a stranger took it' }],
  });
  assert.equal(storySaid.collisions.length, 1, 'a story still cannot replace what the author stated');

  const ended = await answerOf('end_fact', { fact: replaced.id });
  whole = await wholeRun(slug);
  const secondScene = whole.scenes.find((scene) => scene.number === 2 && scene.status === 'standing')!;
  assert.equal(ended.untilSceneId, secondScene.id);
  assert.ok(whole.facts.some((fact) => fact.id === replaced.id), 'an ended fact is closed, never removed');
  await refusalOf('end_fact', { fact: replaced.id });

  const lookup = await answerOf('look_up', { run: slug, name: 'the sack of flour', withHistory: true });
  assert.ok(!lookup.holding.some((fact) => fact.property === 'held by'), 'nothing holds in its place');
  assert.ok(lookup.history.some((fact) => fact.id === replaced.id), 'and it is kept as history');
});

test('a ruling is recorded word for word as the author and withdrawn, and a story is no longer told it', async () => {
  const slug = 'the-mill-rulings';
  await beginTheMill(slug);
  const ruling = await answerOf('record_ruling', { run: slug, text: 'Never say the flood\'s name.', topics: ['naming'], about: ['Odo the miller'] });
  assert.equal(ruling.source, 'author');
  assert.equal((await answerOf('list_rulings', { run: slug })).length, 1);

  const withdrawn = await answerOf('withdraw_ruling', { ruling: ruling.id });
  assert.notEqual(withdrawn.withdrawnInSceneId, null);
  assert.equal(withdrawn.text, 'Never say the flood\'s name.');
  await refusalOf('withdraw_ruling', { ruling: ruling.id });

  assert.equal((await answerOf('list_rulings', { run: slug })).length, 0);
  assert.ok(!(await briefingText(slug, ['Odo the miller'])).includes('flood\'s name'));
  assert.ok(!(await answerOf('read_scene', { run: slug, number: 1 })).rulings.some((item) => item.id === ruling.id));
  const kept = (await wholeRun(slug)).rulings.find((item) => item.id === ruling.id);
  assert.equal(kept?.text, 'Never say the flood\'s name.', 'the author still reads it');
});

test('a thread is opened, touched and closed from the page', async () => {
  const slug = 'the-mill-threads';
  const whole = await beginTheMill(slug);
  const firstScene = whole.scenes.find((scene) => scene.number === 1)!;
  const thread = await answerOf('open_thread', { run: slug, text: 'Who stole the grindstone?', aboutEntryIds: [idOf(whole, 'Odo the miller')] });
  assert.equal(thread.openedInSceneId, firstScene.id);

  await answerOf('save_scene', { run: slug, title: 'Searching', when: 'noon', summary: 'The miller searches.', situationAfter: 'No stone.' });
  const touched = await answerOf('touch_thread', { thread: thread.id, note: 'A cart track leads away.' });
  assert.equal(touched.touches.at(-1)?.note, 'A cart track leads away.');
  await refusalOf('touch_thread', { thread: thread.id, note: 'Again.' });

  const listed = await answerOf('list_threads', { run: slug, about: ['the miller'] });
  assert.equal(listed[0]?.id, thread.id);

  const closed = await answerOf('close_thread', { thread: thread.id, resolution: 'The carter took it to be mended.' });
  assert.notEqual(closed.closedInSceneId, null);
  await refusalOf('close_thread', { thread: thread.id, resolution: 'Again.' });
  await refusalOf('touch_thread', { thread: thread.id, note: 'After it closed.' });
  assert.equal((await answerOf('list_threads', { run: slug })).length, 0);
});

test('an entry is added, edited and renamed, the old name still finding it; an author-only one is never told to a story', async () => {
  const slug = 'the-mill-entries';
  await beginTheMill(slug);
  const baker = await answerOf('add_entry', { run: slug, name: 'Hild the baker', kind: 'person', alsoKnownAs: [], pronoun: 'she', visibility: 'open' });
  const secret = await answerOf('add_entry', { run: slug, name: 'the drowned bell', kind: 'item', visibility: 'author-only' });
  assert.equal(secret.entry.visibility, 'author-only');
  await refusalOf('look_up', { run: slug, name: 'the drowned bell' });
  assert.equal((await answerOf('find', { run: slug, text: 'drowned bell' })).length, 0);

  const edited = await answerOf('edit_entry', { entry: baker.entry.id, kind: 'person', pronoun: 'they', alsoKnownAs: ['the baker'] });
  assert.equal(edited.entry.pronoun, 'they');
  await refusalOf('edit_entry', { entry: baker.entry.id, pronoun: 'they' });

  const renamed = await answerOf('rename_entry', { entry: baker.entry.id, name: 'Hild of the bakehouse' });
  assert.deepEqual(renamed.entry.alsoKnownAs.sort(), ['Hild the baker', 'the baker']);
  const byOldName = await answerOf('look_up', { run: slug, name: 'Hild the baker' });
  assert.equal(byOldName.entry.id, baker.entry.id, 'the old name still finds it');

  const shared = await answerOf('add_entry', { run: slug, name: 'the miller', kind: 'person', visibility: 'open' });
  assert.ok(shared.cautions.length > 0, 'a name another entry answers to is added, with a caution');

  const whole = await wholeRun(slug);
  const fields = whole.entryEdits.filter((edit) => edit.entryId === baker.entry.id).map((edit) => edit.field).sort();
  assert.deepEqual(fields, ['alsoKnownAs', 'alsoKnownAs', 'name', 'pronoun'], 'each change kept, the rename as a name and a list');
});

test('turning an entry author-only takes it out of every story answer at once, and turning it open puts it all back', async () => {
  const slug = 'the-mill-hidden';
  const marker = 'BAKEHOUSE-MARKER-7f2';
  await answerOf('begin_run', { slug, title: 'The Bakehouse', setting: 'A bakehouse by a ford.' });
  await answerOf('save_scene', {
    run: slug, title: 'The oven', when: 'the first morning', place: `the ${marker} oven`,
    summary: 'The bread is baked.', situationAfter: 'Loaves cool on the sill.',
    entries: [
      { name: `Hild ${marker}`, kind: 'person', alsoKnownAs: ['the baker'], pronoun: 'she' },
      { name: `the ${marker} oven`, kind: 'place' },
      { name: 'Odo the miller', kind: 'person', pronoun: 'he' },
    ],
    facts: [{ entry: `Hild ${marker}`, property: 'who', value: `the baker ${marker}` }],
    notes: [{ entry: `Hild ${marker}`, text: `She lit the oven ${marker}.` }, { entry: 'Odo the miller', text: 'He brought flour.' }],
  });
  let whole = await wholeRun(slug);
  const hild = idOf(whole, `Hild ${marker}`);
  const oven = idOf(whole, `the ${marker} oven`);
  const client = await running.mcpClient();

  /**
   * Every story answer that could name them, joined: the briefing, look_up, find, the scene in full
   * and the attachments. Each asks by a name that is not the marker, so a refusal that quotes what
   * it was asked cannot carry the marker back.
   */
  async function whatAStoryIsTold(): Promise<string> {
    const answers: unknown[] = [
      await briefingText(slug, ['the baker']),
      await running.call('look_up', { run: slug, name: 'the baker', withHistory: true }),
      await answerOf('find', { run: slug, text: marker }),
      await answerOf('read_scene', { run: slug, number: 1 }),
    ];
    const { resources } = await client.listResources();
    answers.push(resources);
    answers.push(await client.readResource({ uri: briefingUri(slug) }));
    try {
      answers.push(await client.readResource({ uri: personUri(slug, hild) }));
    } catch (error) {
      answers.push(String(error));
    }
    return JSON.stringify(answers);
  }

  assert.ok((await whatAStoryIsTold()).includes(marker), 'open, a story is told of them');

  await answerOf('set_entry_visibility', { entry: hild, visibility: 'author-only' });
  await answerOf('set_entry_visibility', { entry: oven, visibility: 'author-only' });
  assert.ok(!(await whatAStoryIsTold()).includes(marker), 'author-only, nothing of them reaches a story');
  whole = await wholeRun(slug);
  assert.ok(JSON.stringify(whole).includes(`She lit the oven ${marker}.`), 'nothing was removed: the author still reads it all');

  await answerOf('set_entry_visibility', { entry: hild, visibility: 'open' });
  await answerOf('set_entry_visibility', { entry: oven, visibility: 'open' });
  const toldAgain = await whatAStoryIsTold();
  for (const piece of [`the baker ${marker}`, `She lit the oven ${marker}.`, `the ${marker} oven`]) {
    assert.ok(toldAgain.includes(piece), `turned open again, "${piece}" is back`);
  }
  const fields = (await wholeRun(slug)).entryEdits.filter((edit) => edit.entryId === hild).map((edit) => [edit.earlierValue, edit.laterValue]);
  assert.deepEqual(fields, [['open', 'author-only'], ['author-only', 'open']]);
});

test('an act made outside a scene is dated to the newest scene, and a redo of that scene keeps every one of them', async () => {
  const slug = 'the-mill-redone';
  let whole = await beginTheMill(slug, ['The miller crosses the ford.']);
  await answerOf('save_scene', { run: slug, title: 'Noon', when: 'noon', summary: 'The miller eats.', situationAfter: 'He rests.' });
  whole = await wholeRun(slug);
  const sack = idOf(whole, 'the sack of flour');
  const tiredFact = whole.facts.find((fact) => fact.property === 'state')!;

  const stated = await answerOf('state_fact', { run: slug, entryId: sack, property: 'where', value: 'by the wheel' });
  await answerOf('end_fact', { fact: tiredFact.id });
  const ruling = await answerOf('record_ruling', { run: slug, text: 'Keep the narration slow.' });
  await answerOf('withdraw_ruling', { ruling: ruling.id });
  const thread = await answerOf('open_thread', { run: slug, text: 'Will the wheel hold?' });
  await answerOf('touch_thread', { thread: thread.id, note: 'It creaks.' });
  const toClose = await answerOf('open_thread', { run: slug, text: 'Is the river rising?' });
  await answerOf('close_thread', { thread: toClose.id, resolution: 'It fell back.' });
  await answerOf('withdraw_waypoint', { waypoint: whole.waypoints[0]!.id });
  const toReach = await answerOf('add_waypoint', { run: slug, text: 'The miller sleeps.' });
  await answerOf('mark_waypoint_reached', { waypoint: toReach.id, scene: 2 });
  await answerOf('edit_run', { run: slug, register: 'Slow and plain.' });
  await answerOf('reword_waypoint', { waypoint: toReach.id, text: 'The miller sleeps at last.' });

  await answerOf('redo_scene', { run: slug, number: 2, title: 'Noon again', when: 'noon', summary: 'The miller eats bread.', situationAfter: 'He rests by the wheel.' });
  whole = await wholeRun(slug);
  const newTake = whole.scenes.find((scene) => scene.number === 2 && scene.status === 'standing')!;

  const factNow = whole.facts.find((fact) => fact.id === stated.id)!;
  assert.equal(factNow.fromSceneId, newTake.id, 'a stated fact moves onto the new take');
  assert.equal(factNow.untilSceneId, null, 'and still holds');
  assert.equal(whole.facts.find((fact) => fact.id === tiredFact.id)!.untilSceneId, newTake.id, 'an ended fact stays ended');
  assert.equal(whole.rulings.find((item) => item.id === ruling.id)!.withdrawnInSceneId, newTake.id, 'a withdrawn ruling stays withdrawn');
  const threadNow = whole.threads.find((item) => item.id === thread.id)!;
  assert.equal(threadNow.openedInSceneId, newTake.id, 'an opened thread moves onto the new take');
  assert.ok(threadNow.touches.some((touch) => touch.sceneId === newTake.id && touch.note === 'It creaks.'), 'a touch stays');
  assert.equal(whole.threads.find((item) => item.id === toClose.id)!.closedInSceneId, newTake.id, 'a closed thread stays closed');
  assert.equal(whole.waypoints.find((item) => item.id === whole.waypoints[0]!.id)!.withdrawnInSceneId, newTake.id, 'a withdrawn waypoint stays withdrawn');
  assert.equal(whole.waypoints.find((item) => item.id === toReach.id)!.reachedInSceneId, newTake.id, 'a reached waypoint stays reached');
  assert.ok(whole.runEdits.every((edit) => edit.afterSceneId === newTake.id), 'an edit is dated after the new take');
  assert.ok(whole.waypointRewordings.every((rewording) => rewording.afterSceneId === newTake.id), 'so is a rewording');
  assert.equal(whole.run.register, 'Slow and plain.');

  const briefing = await briefingText(slug);
  assert.ok(briefing.includes('by the wheel'));
  assert.ok(!briefing.includes('Keep the narration slow.'));
  assert.ok(!briefing.includes('The miller crosses the ford.'));
});

test('a run with no scene yet: what starts starts at no scene, what must stop at a scene is refused, and edits need none', async () => {
  const slug = 'the-mill-unbegun';
  await answerOf('begin_run', { slug, title: 'Before the Mill', waypoints: ['The wheel turns for the first time.'] });
  let whole = await wholeRun(slug);
  const waypointId = whole.waypoints[0]!.id;

  const thread = await answerOf('open_thread', { run: slug, text: 'Who built the mill?' });
  assert.equal(thread.openedInSceneId, null);
  const entry = await answerOf('add_entry', { run: slug, name: 'the millpond', kind: 'place' });
  const fact = await answerOf('state_fact', { run: slug, entryId: entry.entry.id, property: 'state', value: 'still' });
  assert.equal(fact.fromSceneId, null);
  const ruling = await answerOf('record_ruling', { run: slug, text: 'The mill has no name.' });

  await refusalOf('close_thread', { thread: thread.id, resolution: 'Nobody remembers.' });
  await refusalOf('touch_thread', { thread: thread.id, note: 'A stone is carved.' });
  await refusalOf('withdraw_waypoint', { waypoint: waypointId });
  await refusalOf('withdraw_ruling', { ruling: ruling.id });
  await refusalOf('end_fact', { fact: fact.id });

  const reworded = await answerOf('reword_waypoint', { waypoint: waypointId, text: 'The wheel turns at dawn for the first time.' });
  assert.equal(reworded.text, 'The wheel turns at dawn for the first time.');
  await answerOf('edit_run', { run: slug, setting: 'An empty valley.' });
  await answerOf('rename_entry', { entry: entry.entry.id, name: 'the millpool' });
  whole = await wholeRun(slug);
  assert.ok(whole.runEdits.every((edit) => edit.afterSceneId === null));
  assert.ok(whole.entryEdits.every((edit) => edit.afterSceneId === null));
  assert.ok(whole.waypointRewordings.every((rewording) => rewording.afterSceneId === null));
});

/** The author's acts this slice added, each with an input that would be taken over the web. */
const NEW_AUTHOR_OPERATIONS: OperationName[] = [
  'end_fact', 'withdraw_ruling', 'add_waypoint', 'reword_waypoint', 'mark_waypoint_reached', 'withdraw_waypoint', 'edit_run',
  'open_thread', 'touch_thread', 'close_thread', 'add_entry', 'edit_entry', 'rename_entry', 'set_entry_visibility',
];

test('over MCP none of these acts is offered, and calling one by name is refused and changes nothing', async () => {
  const slug = 'the-mill-over-mcp';
  const whole = await beginTheMill(slug, ['The miller crosses the ford.']);
  const thread = await answerOf('open_thread', { run: slug, text: 'Who owns the ford?' });
  const ruling = await answerOf('record_ruling', { run: slug, text: 'Plain words only.' });
  const miller = idOf(whole, 'Odo the miller');
  const inputs: Record<string, Record<string, unknown>> = {
    end_fact: { fact: whole.facts[0]!.id },
    withdraw_ruling: { ruling: ruling.id },
    add_waypoint: { run: slug, text: 'Sent over MCP.' },
    reword_waypoint: { waypoint: whole.waypoints[0]!.id, text: 'Sent over MCP.' },
    mark_waypoint_reached: { waypoint: whole.waypoints[0]!.id, scene: 1 },
    withdraw_waypoint: { waypoint: whole.waypoints[0]!.id },
    edit_run: { run: slug, title: 'Sent over MCP' },
    open_thread: { run: slug, text: 'Sent over MCP.' },
    touch_thread: { thread: thread.id, note: 'Sent over MCP.' },
    close_thread: { thread: thread.id, resolution: 'Sent over MCP.' },
    add_entry: { run: slug, name: 'Sent over MCP', kind: 'other' },
    edit_entry: { entry: miller, pronoun: 'Sent over MCP' },
    rename_entry: { entry: miller, name: 'Sent over MCP' },
    set_entry_visibility: { entry: miller, visibility: 'author-only' },
  };
  assert.deepEqual(Object.keys(inputs).sort(), [...NEW_AUTHOR_OPERATIONS].sort());

  const client: Client = await running.mcpClient();
  const { tools } = await client.listTools();
  for (const name of NEW_AUTHOR_OPERATIONS) {
    assert.ok(!tools.some((tool) => tool.name === name), `${name} is offered as a tool`);
    const result = await client.callTool({ name, arguments: inputs[name]! });
    assert.equal(result.isError, true, `${name} answered over MCP`);
  }
  const after = await wholeRun(slug);
  assert.ok(!JSON.stringify(after).includes('MCP'), 'nothing sent over MCP was written');
  assert.deepEqual(after.runEdits, []);
  assert.deepEqual(after.entryEdits, []);
});

test("over MCP a save's structured answer and a whole-run read name no author-only entry, nor a journey to it", async () => {
  const slug = 'the-mill-hidden-ford';
  const whole = await beginTheMill(slug);
  const sack = idOf(whole, 'the sack of flour');
  const thread = await answerOf('open_thread', { run: slug, text: 'A claim on the mill', aboutEntryIds: [sack] });
  await answerOf('save_scene', {
    run: slug, title: 'Downstream', when: 'noon', summary: 'A punt to the weir.', situationAfter: 'At the weir.',
    entries: [{ name: 'the weir', kind: 'place' }],
    legs: [{ from: 'the ford', to: 'the weir', duration: 'an hour', note: 'by punt' }],
  });
  const ford = idOf(whole, 'the ford');
  await answerOf('set_entry_visibility', { entry: sack, visibility: 'author-only' });
  await answerOf('set_entry_visibility', { entry: ford, visibility: 'author-only' });

  const client: Client = await running.mcpClient();
  const saved = await client.callTool({ name: 'save_scene', arguments: {
    run: slug, title: 'Talk', when: 'evening', summary: 'They talk.', situationAfter: 'Quiet.',
    threadsTouched: [{ thread: thread.id, note: 'It came up.' }],
  } });
  assert.notEqual(saved.isError, true);
  assert.ok(!JSON.stringify(saved).includes(sack), 'the save answer names the hidden entry');
  // The setting, the author's own prose, says "a ford"; the hidden entry is "the ford".
  assert.ok(!(await briefingText(slug, ['the weir'])).includes('the ford'), 'the briefing names the hidden place');
  const found = await answerOf('find', { run: slug, text: 'ford' });
  assert.ok(!JSON.stringify(found).includes('the ford'), 'find names the hidden place');
});
