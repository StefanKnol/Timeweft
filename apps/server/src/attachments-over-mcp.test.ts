/**
 * What a chat may attach from the connector's menu, played over a real MCP client: each run's
 * briefing, each run's main characters, and the continue_run prompt. Every resource is a copy of
 * a story answer, so nothing author-only reaches one, and every uri names an id, never a name.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ImportedRun, RunSnapshot } from '@timeweft/contract';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';
import {
  BRIEFING_COPY_LINE, LONGEST_ATTACHED_PERSON_BYTES, PERSON_COPY_LINE, PERSON_NOT_REACHED_BY_NAME_COPY_LINE, briefingUri, lookUpWordsThatFit, personUri,
} from './attachments.ts';

const MARKER = 'SEALED-MARKER-77d2';
const SLUG = 'the-ford-crossing';
const OTHER_SLUG = 'the-long-bakery';

let running: RunningServer;
let client: Client;
let snapshot: RunSnapshot;
let otherSnapshot: RunSnapshot;

type ImportedEntry = ImportedRun['entries'][number];

function person(name: string, trailNotes: number, fields: Partial<ImportedEntry> = {}): ImportedEntry {
  return {
    name, kind: 'person', alsoKnownAs: [], pronoun: '', introducedInScene: 1, visibility: 'open', facts: [],
    trail: Array.from({ length: trailNotes }, (_, noteIndex) => ({ scene: 1 + (noteIndex % 2), text: `${name} is on the page, note ${noteIndex}.` })),
    ...fields,
  };
}

function scenes(firstPlace: string | null): ImportedRun['scenes'] {
  return [
    { number: 1, title: 'The ford', starred: false, whenTyped: 'day one', place: firstPlace, summary: 'The water is low.', record: '', steer: '', situationAfter: '', readings: [] },
    { number: 2, title: 'The mill', starred: false, whenTyped: 'day two', place: null, summary: 'The wheel turns.', record: '', steer: '', situationAfter: 'Everyone sleeps.', readings: [] },
  ];
}

function fordRun(): ImportedRun {
  return {
    slug: SLUG, title: 'The Ford Crossing', setting: 'A ford below a mill.', status: 'binding', register: '', clocks: [],
    scenes: scenes('the ford'),
    entries: [
      person('Hild the baker', 9, { facts: [{ property: 'who', value: 'bakes for the whole valley', fromScene: 1, source: 'author', note: '' }] }),
      person('Odo', 5, { alsoKnownAs: ['the miller'] }),
      person('Odo', 4, { alsoKnownAs: ['the carter'] }),
      ...Array.from({ length: 10 }, (_, position) => person(`Villager ${String(position).padStart(2, '0')}`, 3)),
      person('Wil the latecomer', 0),
      person('Pip', 1),
      person('Pip', 1),
      person(`the ${MARKER} stranger`, 20, { visibility: 'author-only' }),
      { name: 'the ford', kind: 'place', alsoKnownAs: [], pronoun: '', introducedInScene: 1, visibility: 'open', facts: [], trail: [{ scene: 1, text: 'The water is low.' }] },
    ],
    rulings: [], threads: [], waypoints: [], legs: [], unplaced: [],
  };
}

/** A run whose main character's trail notes are long enough that look_up answers past the limit. */
function longRun(): ImportedRun {
  const longNote = 'The baker kneads and the oven roars. '.repeat(300);
  return {
    slug: OTHER_SLUG, title: 'The Long Bakery', setting: 'A bakery that never closes.', status: 'binding', register: '', clocks: [],
    scenes: scenes(null),
    entries: [person('Hild the baker', 8, {
      trail: Array.from({ length: 8 }, (_, noteIndex) => ({ scene: 1 + (noteIndex % 2), text: `Loaf ${noteIndex}. ${longNote}` })),
    })],
    rulings: [], threads: [], waypoints: [], legs: [], unplaced: [],
  };
}

function idOf(run: RunSnapshot, name: string, alsoKnownAs?: string): string {
  const found = run.entries.find((candidate) => candidate.name === name && (alsoKnownAs === undefined || candidate.alsoKnownAs.includes(alsoKnownAs)));
  assert.ok(found, `no entry ${name}`);
  return found.id;
}

async function readText(uri: string): Promise<string> {
  const result = await client.readResource({ uri });
  return result.contents.map((content) => ('text' in content ? content.text : '')).join('');
}

async function toolText(name: string, input: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: input });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return (result.content as Array<{ text: string }>).map((part) => part.text).join('\n');
}

before(async () => {
  running = await startServerForTests();
  snapshot = await running.store.importRun(fordRun());
  otherSnapshot = await running.store.importRun(longRun());
  const statedSecretly = await running.call('state_fact', {
    run: SLUG, entry: 'Hild the baker', property: 'secret', value: `knows the ${MARKER}`, visibility: 'author-only',
  });
  assert.equal(statedSecretly.status, 200);
  client = await running.mcpClient();
});
after(async () => {
  await running.stop();
});

test('the server says at initialize that it offers resources, prompts and completion', () => {
  const capabilities = client.getServerCapabilities();
  assert.ok(capabilities?.resources, 'resources');
  assert.ok(capabilities?.prompts, 'prompts');
  assert.ok(capabilities?.completions, 'completions');
  assert.ok(capabilities?.tools, 'tools are still offered');
});

test('every listed resource says which one it is in its title, since that is what a menu shows', async () => {
  const { resources } = await client.listResources();
  assert.ok(resources.length > 2);
  for (const resource of resources) assert.equal(resource.title, resource.name, `${resource.uri} is titled "${String(resource.title)}"`);
  const titles = resources.map((resource) => resource.title);
  assert.ok(titles.includes('Briefing: The Ford Crossing'), titles.join(' | '));
  assert.ok(titles.includes('Hild the baker (The Ford Crossing)'), titles.join(' | '));
  assert.equal(new Set(resources.filter((resource) => resource.uri.includes('/briefing')).map((resource) => resource.title)).size,
    resources.filter((resource) => resource.uri.includes('/briefing')).length, 'two runs are two different titles');
});

test('the list holds a briefing per run, then the main character and the ten longest trails, by id', async () => {
  const { resources } = await client.listResources();
  const uris = resources.map((resource) => resource.uri);
  assert.ok(uris.includes(briefingUri(SLUG)) && uris.includes(briefingUri(OTHER_SLUG)));
  const briefing = resources.find((resource) => resource.uri === briefingUri(SLUG));
  assert.equal(briefing?.name, 'Briefing: The Ford Crossing');
  assert.equal(briefing?.mimeType, 'text/markdown');
  const people = resources.filter((resource) => resource.uri.startsWith(`timeweft://runs/${SLUG}/people/`));
  assert.equal(people.length, 11);
  assert.equal(people[0]?.uri, personUri(SLUG, idOf(snapshot, 'Hild the baker')));
  assert.equal(people[0]?.name, 'Hild the baker (The Ford Crossing)');
  assert.equal(people[0]?.description, 'The main character. bakes for the whole valley');
  assert.equal(people[1]?.uri, personUri(SLUG, idOf(snapshot, 'Odo', 'the miller')));
  assert.equal(people[2]?.uri, personUri(SLUG, idOf(snapshot, 'Odo', 'the carter')), 'two people sharing a name are two resources');
  assert.match(people[3]?.description ?? '', /nothing yet says who they are/);
  assert.ok(!uris.includes(personUri(SLUG, idOf(snapshot, 'Wil the latecomer'))), 'the shortest trail is not among the ten');
  assert.ok(!uris.includes(personUri(SLUG, idOf(snapshot, 'the ford'))), 'a place is not a person');
  assert.ok(!JSON.stringify(resources).includes(MARKER), 'an author-only person is never listed');
});

test('a briefing is the copy line, then exactly what resume_run answers with its defaults', async () => {
  const text = await readText(briefingUri(SLUG));
  assert.equal(text, `${BRIEFING_COPY_LINE}\n\n${await toolText('resume_run', { run: SLUG })}`);
  assert.ok(!text.includes(MARKER));
});

test('a person is the copy line, then exactly what look_up answers for them, author-only facts left out', async () => {
  const text = await readText(personUri(SLUG, idOf(snapshot, 'Hild the baker')));
  assert.equal(text, `${PERSON_COPY_LINE}\n\n${await toolText('look_up', { run: SLUG, name: 'Hild the baker' })}`);
  assert.match(text, /bakes for the whole valley/);
  assert.ok(!text.includes(MARKER), 'an author-only fact must not reach a served character');
  const carter = await readText(personUri(SLUG, idOf(snapshot, 'Odo', 'the carter')));
  assert.match(carter, /also the carter/, 'the uri reaches the person it names, not another of the same name');
});

test('an open person outside the ten is still readable, so an attached pointer keeps working', async () => {
  const text = await readText(personUri(SLUG, idOf(snapshot, 'Wil the latecomer')));
  assert.match(text, /^This is a copy/);
  assert.match(text, /Wil the latecomer \(person\)/);
});

test('a person look_up cannot reach by name is still read by id, and the copy says look_up refuses the name', async () => {
  const pips = snapshot.entries.filter((entry) => entry.name === 'Pip');
  assert.equal(pips.length, 2);
  const refused = await client.callTool({ name: 'look_up', arguments: { run: SLUG, name: 'Pip' } });
  assert.equal(refused.isError, true, 'look_up refuses a name two people share');
  for (const pip of pips) {
    const text = await readText(personUri(SLUG, pip.id));
    assert.ok(text.startsWith(`${PERSON_NOT_REACHED_BY_NAME_COPY_LINE}\n\n`), text.slice(0, 200));
    assert.ok(!text.includes(PERSON_COPY_LINE));
  }
  const odo = await readText(personUri(SLUG, idOf(snapshot, 'Odo', 'the miller')));
  assert.ok(odo.startsWith(`${PERSON_COPY_LINE}\n\n`), 'a shared name with one of their own is reachable, so the ordinary line');
});

test('what may not be attached is refused in a plain sentence that leaks nothing', async () => {
  const hiddenId = (await running.call('read_run', { run: SLUG })).body.answer as RunSnapshot;
  const hidden = hiddenId.entries.find((entry) => entry.name.includes(MARKER));
  assert.ok(hidden);
  const refused: Array<[string, RegExp]> = [
    [personUri(SLUG, hidden.id), /No person of the run "the-ford-crossing" has the id/],
    [personUri(SLUG, idOf(snapshot, 'the ford')), /No person of the run/],
    [personUri(SLUG, idOf(otherSnapshot, 'Hild the baker')), /No person of the run "the-ford-crossing"/],
    [personUri(SLUG, 'not-an-id'), /No person of the run/],
    [personUri('no-such-run', idOf(snapshot, 'Hild the baker')), /There is no run called "no-such-run"/],
    [briefingUri('no-such-run'), /There is no run called "no-such-run"/],
    [`timeweft://runs/${SLUG}/secrets`, /not found/],
    ['not a uri at all', /./],
  ];
  for (const [uri, expected] of refused) {
    await assert.rejects(client.readResource({ uri }), (error: Error) => {
      assert.match(error.message, expected, uri);
      assert.ok(!error.message.includes(MARKER), `${uri} leaked the author-only name`);
      return true;
    });
  }
});

test('a person whose look_up answers past the limit is cut to the newest trail, saying what was left out', async () => {
  const id = idOf(otherSnapshot, 'Hild the baker');
  const whole = await toolText('look_up', { run: OTHER_SLUG, name: 'Hild the baker' });
  assert.ok(Buffer.byteLength(whole, 'utf8') > LONGEST_ATTACHED_PERSON_BYTES, 'the demo run must answer past the limit for this test to mean anything');
  const text = await readText(personUri(OTHER_SLUG, id));
  assert.ok(Buffer.byteLength(text, 'utf8') <= LONGEST_ATTACHED_PERSON_BYTES);
  // The odd loaves are the notes of scene 2, the newest scene: all of them are kept.
  for (const newest of [1, 3, 5, 7]) assert.match(text, new RegExp(`scene 2: Loaf ${newest}\\.`), `loaf ${newest} is among the newest`);
  assert.equal(text.match(/^- scene 1: Loaf/gm)?.length ?? 0, 1, 'of the older scene, only what fits is kept');
  assert.match(text, /of the newest 8 trail notes look_up gives were left out of it; look_up gives them whole\./);
});

test('continue_run is listed with one required argument, and tells the chat how to pick the run up', async () => {
  const { prompts } = await client.listPrompts();
  const prompt = prompts.find((candidate) => candidate.name === 'continue_run');
  assert.equal(prompt?.title, 'Continue a run');
  assert.deepEqual(prompt?.arguments?.map((argument) => [argument.name, argument.required]), [['run', true]]);
  const got = await client.getPrompt({ name: 'continue_run', arguments: { run: SLUG } });
  assert.equal(got.messages.length, 1);
  assert.equal(got.messages[0]?.role, 'user');
  const text = got.messages[0]?.content.type === 'text' ? got.messages[0].content.text : '';
  assert.match(text, /call resume_run with run "the-ford-crossing"/);
  assert.match(text, /name in upcoming who and where/);
  assert.match(text, /two or three sentences/);
  assert.match(text, /save_scene/);
  await assert.rejects(client.getPrompt({ name: 'continue_run', arguments: { run: 'no-such-run' } }), /There is no run called "no-such-run"/);
});

test('continue_run completes a run slug from what is typed', async () => {
  const completed = await client.complete({ ref: { type: 'ref/prompt', name: 'continue_run' }, argument: { name: 'run', value: 'the-f' } });
  assert.deepEqual(completed.completion.values, [SLUG]);
});

test('the access token still guards /mcp: no token, no resources', async () => {
  const response = await fetch(`${running.baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }),
  });
  assert.equal(response.status, 401);
});

test('a person whose facts alone pass the limit is cut too, and the copy says look_up gives it whole', () => {
  const id = idOf(otherSnapshot, 'Hild the baker');
  const heavyFacts = Array.from({ length: 20 }, (_, factIndex) => ({
    id: `fact-heavy-${factIndex}`, entryId: id, property: `oven ${factIndex}`, value: 'Bread and more bread. '.repeat(250),
    aboutEntryId: null, fromSceneId: null, untilSceneId: null, source: 'story' as const, visibility: 'open' as const, note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  const heavy: RunSnapshot = { ...otherSnapshot, facts: [...otherSnapshot.facts, ...heavyFacts] };
  const text = lookUpWordsThatFit(heavy, id, { withHistory: false, trail: 8 });
  assert.ok(Buffer.byteLength(`${PERSON_COPY_LINE}\n\n${text}`, 'utf8') <= LONGEST_ATTACHED_PERSON_BYTES);
  assert.match(text, /The rest was cut to keep this copy under 60000 bytes, the trail with it; look_up gives it whole\.$/);
});
