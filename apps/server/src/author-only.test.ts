/**
 * Author-only material never reaches a story, over either face. A run is seeded with author-only
 * material carrying a marker; every story operation is then run over HTTP and over MCP, and the
 * marker must be in none of their answers, while read_run, the author's own view, holds it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, OPERATION_NAMES, type ImportedRun, type OperationName } from '@timeweft/contract';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';

const MARKER = 'SEALED-MARKER-41c9';
const SLUG = 'the-sealed-mill';

let running: RunningServer;

function runWithHiddenMaterial(): ImportedRun {
  return {
    slug: SLUG, title: 'The Sealed Mill', setting: 'A mill by a ford.', status: 'binding', register: '',
    clocks: [{ name: 'days at the mill', countsFrom: 'the first day' }],
    scenes: [
      { number: 1, title: 'The wheel', starred: true, whenTyped: 'day one', place: `the ${MARKER} vault`, summary: 'The wheel turned.', record: '', steer: '', situationAfter: '', readings: [] },
      { number: 2, title: 'The flour', starred: false, whenTyped: 'day two', place: null, summary: 'Flour was sacked.', record: '', steer: '', situationAfter: 'The miller rests.', readings: [] },
    ],
    entries: [
      { name: 'Odo the miller', kind: 'person', alsoKnownAs: ['the miller'], pronoun: 'he', introducedInScene: 1, visibility: 'open',
        facts: [{ property: 'state', value: 'tired', fromScene: 1, source: 'import', note: '' }],
        trail: [{ scene: 1, text: 'He turned the wheel by hand.' }] },
      { name: `the ${MARKER} vault`, kind: 'place', alsoKnownAs: [`${MARKER} cellar`], pronoun: '', introducedInScene: 1, visibility: 'author-only',
        facts: [{ property: 'what', value: `a vault ${MARKER}`, fromScene: 1, source: 'author', note: MARKER }],
        trail: [{ scene: 2, text: `Something stirs ${MARKER}.` }] },
    ],
    rulings: [{ text: 'Keep the narration plain.', source: 'author', scope: 'run', topics: ['narration'], about: ['Odo the miller', `the ${MARKER} vault`], scene: 1 }],
    threads: [{ text: 'What is under the mill?', about: [`the ${MARKER} vault`, 'Odo the miller'], openedInScene: 1, closed: false, resolution: '' }],
    waypoints: [], legs: [], unplaced: [],
  };
}

before(async () => {
  running = await startServerForTests();
  await running.store.importRun(runWithHiddenMaterial());
  const statedSecretly = await running.call('state_fact', {
    run: SLUG, entry: 'Odo the miller', property: 'secret', value: `knows the ${MARKER}`, visibility: 'author-only', note: MARKER,
  });
  assert.equal(statedSecretly.status, 200);
});
after(async () => {
  await running.stop();
});

/** One input per story operation, each aimed as close to the hidden material as a story could aim. */
function storyInputs(sceneSuffix: string): Record<OperationName, Record<string, unknown> | null> {
  return {
    list_runs: {},
    begin_run: { slug: `a-new-run-${sceneSuffix}`, title: 'Another' },
    resume_run: { run: SLUG, upcoming: ['Odo the miller', 'the miller'], budgetBytes: 200000 },
    save_scene: {
      run: SLUG, title: 'Digging', when: 'day three', summary: 'The miller digs.', situationAfter: 'The miller digs on.',
      facts: [{ entry: 'Odo the miller', property: 'secret', value: 'he knows nothing' }],
    },
    redo_scene: { run: SLUG, number: 3, title: 'Digging again', when: 'day three', summary: 'The miller does not dig.', situationAfter: 'The miller sleeps.' },
    read_scene: { run: SLUG, number: 1 },
    list_scenes: { run: SLUG },
    look_up: { run: SLUG, name: 'Odo the miller', withHistory: true, trail: 200 },
    find: { run: SLUG, text: 'mill', limit: 100 },
    list_rulings: { run: SLUG },
    list_threads: { run: SLUG, includeClosed: true },
    record_ruling: { run: SLUG, text: `Ruling given ${sceneSuffix}.` },
    state_fact: null,
    list_collisions: null,
    settle_collision: null,
    read_run: null,
    import_run: null,
  };
}

test('no story operation over HTTP answers with the marker, and read_run does', async () => {
  const inputs = storyInputs('http');
  for (const name of OPERATION_NAMES.filter((candidate) => OPERATIONS[candidate].audience === 'story')) {
    const { status, body } = await running.call(name, inputs[name]);
    assert.equal(status, 200, `${name} answered ${status}: ${body.refusal ?? ''}`);
    assert.ok(!JSON.stringify(body).includes(MARKER), `${name} answered with author-only material over HTTP`);
  }
  const whole = await running.call('read_run', { run: SLUG });
  assert.ok(JSON.stringify(whole.body).includes(MARKER), 'the author\'s own view should hold the marker');
});

test('no MCP tool answers with the marker, in its text or its structured content', async () => {
  const client = await running.mcpClient();
  const inputs = storyInputs('mcp');
  inputs.redo_scene = { ...inputs.redo_scene, number: 4 };
  for (const name of OPERATION_NAMES.filter((candidate) => OPERATIONS[candidate].audience === 'story')) {
    const result = await client.callTool({ name, arguments: inputs[name] ?? {} });
    assert.notEqual(result.isError, true, `${name} refused: ${JSON.stringify(result.content)}`);
    assert.ok(!JSON.stringify(result.content).includes(MARKER), `${name} said author-only material in its text`);
    assert.ok(!JSON.stringify(result.structuredContent).includes(MARKER), `${name} carried author-only material in its structured content`);
  }
  const lookup = await client.callTool({ name: 'look_up', arguments: { run: SLUG, name: `the ${MARKER} vault` } });
  assert.equal(lookup.isError, true, 'a story must not be able to look up an author-only entry by name');
});
