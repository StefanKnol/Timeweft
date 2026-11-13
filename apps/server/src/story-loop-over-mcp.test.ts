/**
 * The whole story loop, as a story chat plays it: a real MCP client from the SDK, connected to the
 * running server over Streamable HTTP.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Briefing, EntryLookup, SavedScene, SceneInFull } from '@timeweft/contract';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
let client: Client;
before(async () => {
  running = await startServerForTests();
  client = await running.mcpClient();
});
after(async () => {
  await running.stop();
});

interface ToolAnswer<Answer> {
  text: string;
  answer: Answer;
}

/** The answer from structured content; resume_run carries only sizes there, so its answer is undefined. */
async function callTool<Answer>(name: string, input: Record<string, unknown>): Promise<ToolAnswer<Answer>> {
  const result = await client.callTool({ name, arguments: input });
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content.map((part) => part.text).join('\n');
  assert.notEqual(result.isError, true, `${name} refused: ${text}`);
  return { text, answer: (result.structuredContent as { answer: Answer }).answer };
}

test('a story is begun, saved three times, resumed, looked into, redone and resumed again', async () => {
  const slug = 'the-ferry-crossing';
  await callTool('begin_run', {
    slug, title: 'The Ferry Crossing', setting: 'A slow river and one ferry.',
    clocks: [{ name: 'days on the river', countsFrom: 'the day the ferry first sailed' }],
  });

  const first = await callTool<SavedScene>('save_scene', {
    run: slug, title: 'The ferry sails', when: 'the first morning', place: 'the landing',
    summary: 'Nell the ferrywoman takes the miller across.', situationAfter: 'The ferry is mid river.',
    readings: [{ clock: 'days on the river', count: 1, partOfDay: 'morning' }],
    entries: [
      { name: 'Nell the ferrywoman', kind: 'person', pronoun: 'she' },
      { name: 'Odo the miller', kind: 'person', alsoKnownAs: ['the miller'], pronoun: 'he' },
      { name: 'the landing', kind: 'place' },
    ],
    facts: [{ entry: 'Nell the ferrywoman', property: 'where', value: 'on the ferry' }],
    rulings: [{ text: 'Name the ferrywoman only as Nell.', topics: ['naming'], about: ['Nell the ferrywoman'] }],
    threadsOpened: [{ text: 'What does the miller carry in the sack?', about: ['Odo the miller'] }],
  });
  assert.match(first.text, /Saved scene 1/);
  assert.match(first.text, /New entries: .*Nell the ferrywoman/);

  const second = await callTool<SavedScene>('save_scene', {
    run: slug, title: 'The far bank', when: 'the first noon',
    summary: 'They land on the far bank.', situationAfter: 'Nell ties up the ferry.',
    facts: [{ entry: 'Nell the ferrywoman', property: 'where', value: 'on the far bank' }],
    notes: [{ entry: 'the miller', text: 'He paid the fare in flour.' }],
  });
  assert.match(second.text, /Saved scene 2/);

  const thirdScene = await callTool<SavedScene>('save_scene', {
    run: slug, title: 'The sack', when: 'the first evening',
    summary: 'The miller opens the sack to show seed corn.', situationAfter: 'Nell rows home alone.',
    facts: [{ entry: 'Nell the ferrywoman', property: 'where', value: 'rowing home' }],
    threadsClosed: [{ thread: first.answer.threadsOpened[0]!.id, resolution: 'Seed corn for the spring.' }],
  });
  assert.equal(thirdScene.answer.scene.number, 3);
  assert.match(thirdScene.text, /Threads closed:/);

  const resumed = await callTool('resume_run', { run: slug, upcoming: ['Nell the ferrywoman'] });
  const resumedSizes = (await client.callTool({ name: 'resume_run', arguments: { run: slug, upcoming: ['Nell the ferrywoman'] } })).structuredContent as Omit<Briefing, 'text'>;
  assert.equal(Buffer.byteLength(resumed.text, 'utf8'), resumedSizes.bytes, 'the briefing tool answers with the briefing itself, and its sizes beside it');
  assert.match(resumed.text, /Nell rows home alone/);

  const lookedUp = await callTool<EntryLookup>('look_up', { run: slug, name: 'nell the ferrywoman', withHistory: true });
  assert.equal(lookedUp.answer.holding[0]!.value, 'rowing home');
  assert.match(lookedUp.text, /Holds now:\n- Nell the ferrywoman, where: rowing home/);
  assert.match(lookedUp.text, /Before:/);

  const redone = await callTool<SavedScene>('redo_scene', {
    run: slug, number: 3, title: 'The sack, again', when: 'the first evening',
    summary: 'The miller keeps the sack shut.', situationAfter: 'Nell sleeps on the far bank.',
    facts: [{ entry: 'Nell the ferrywoman', property: 'where', value: 'asleep on the far bank' }],
  });
  assert.equal(redone.answer.scene.number, 3);

  const resumedAgain = await callTool('resume_run', { run: slug, upcoming: ['Nell the ferrywoman'] });
  assert.match(resumedAgain.text, /Nell sleeps on the far bank/);
  assert.doesNotMatch(resumedAgain.text, /Nell rows home alone/, 'the struck take is still served');
  const afterRedo = await callTool<EntryLookup>('look_up', { run: slug, name: 'Nell the ferrywoman' });
  assert.equal(afterRedo.answer.holding[0]!.value, 'asleep on the far bank');
  const threads = await callTool('list_threads', { run: slug });
  assert.match(threads.text, /What does the miller carry in the sack\?.*open/, 'the redo took the closing back');
});

test('a refusal over MCP is an error result carrying the sentence', async () => {
  const result = await client.callTool({ name: 'look_up', arguments: { run: 'the-ferry-crossing', name: 'a stranger' } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Nothing in this run is called \\"a stranger\\"/);
});

test('read_scene answers the journeys first travelled in the scene, and says them', async () => {
  const slug = 'the-mill-road';
  await callTool('begin_run', { slug, title: 'The Mill Road' });
  await callTool('save_scene', {
    run: slug, title: 'To the mill', when: 'a morning', summary: 'The baker walks to the mill.', situationAfter: 'She is at the mill.',
    legs: [{ from: 'the ford', to: 'the mill', duration: 'half a morning', note: 'on foot' }],
  });
  const read = await callTool<SceneInFull>('read_scene', { run: slug, number: 1 });
  assert.deepEqual(read.answer.legs.map((leg) => [leg.fromPlace, leg.toPlace, leg.duration]), [['the ford', 'the mill', 'half a morning']]);
  assert.match(read.text, /Journeys:\n- From the ford to the mill: half a morning \(on foot\)/);
});
