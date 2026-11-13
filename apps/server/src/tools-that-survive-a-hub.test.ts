/**
 * The tool list a real MCP client receives says, in each object parameter's description, every
 * field of its items, since a hub may pass on the description and drop the fields. And a null sent
 * for an optional parameter answers exactly as the parameter left out.
 *
 * The parameters are found by walking the contract, never listed by hand, so a parameter added
 * there is held here with nothing else touched.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z, type ZodTypeAny } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OPERATIONS } from '@timeweft/contract';
import { STORY_TOOL_NAMES } from './mcp.ts';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';
import {
  argumentsWithNullsLeftOut, fieldsInWords, inputSchemaForAHub, itemObjectOf, parameterDescriptionForAHub, plainObjectOf,
} from './tools-that-survive-a-hub.ts';

let running: RunningServer;
let client: Client;
before(async () => {
  running = await startServerForTests();
  client = await running.mcpClient();
});
after(async () => {
  await running.stop();
});

function shapeOf(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  return (schema as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
}

interface PropertySchema {
  type?: string | string[];
  description?: string;
  items?: { type?: string; properties?: Record<string, unknown> };
  properties?: Record<string, unknown>;
}

async function toolProperties(): Promise<Map<string, Record<string, PropertySchema>>> {
  const { tools } = await client.listTools();
  return new Map(tools.map((tool) => [tool.name, (tool.inputSchema.properties ?? {}) as Record<string, PropertySchema>]));
}

test('every object parameter of every story tool says each field of its items, as the client receives it', async () => {
  const received = await toolProperties();
  let checked = 0;
  for (const name of STORY_TOOL_NAMES) {
    for (const [parameterName, parameter] of Object.entries(shapeOf(OPERATIONS[name].input))) {
      const objectSchema = itemObjectOf(parameter) ?? plainObjectOf(parameter);
      if (objectSchema === null) continue;
      const description = received.get(name)?.[parameterName]?.description ?? '';
      for (const field of Object.keys(shapeOf(objectSchema))) {
        assert.ok(description.includes(`${field} (`), `${name}.${parameterName} does not say its field ${field}: "${description}"`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 10, `only ${checked} object parameters were found, so the walk found too few`);
});

test('read from the received JSON schema alone, every array of objects names its items\' fields', async () => {
  // A walk independent of the zod helpers, so a helper that misses a wrapper cannot hide a parameter.
  const received = await toolProperties();
  for (const [name, properties] of received) {
    for (const [parameterName, property] of Object.entries(properties)) {
      const fields = property.type === 'array' && property.items?.type === 'object'
        ? Object.keys(property.items.properties ?? {})
        : property.type === 'object' ? Object.keys(property.properties ?? {}) : [];
      for (const field of fields) {
        assert.ok((property.description ?? '').includes(`${field} (`), `${name}.${parameterName} lost its field ${field} for a hub`);
      }
    }
  }
});

test('a fact is described field by field, each with its kind, whether required, and its own words', async () => {
  const description = (await toolProperties()).get('save_scene')?.['facts']?.description ?? '';
  assert.match(description, /^What this scene established or changed\. Each item is an object with: entry \(text, required\): The name of the entry the fact is about\. property \(text, required\): /);
  assert.match(description, /about \(text, optional\): The name of another entry/);
  assert.match(description, /statedByAuthor \(yes or no, optional\): True only where the author said this/);
  assert.match(description, /alongside \(yes or no, optional\)/);
  assert.match(description, / note \(text, optional\)\.$/);
  const readings = (await toolProperties()).get('save_scene')?.['readings']?.description ?? '';
  assert.match(readings, /count \(a number or text, required\)/);
  const entries = (await toolProperties()).get('save_scene')?.['entries']?.description ?? '';
  assert.match(entries, /kind \(one of "person", "group", "place", "item", "other", required\)/);
  assert.match(entries, /alsoKnownAs \(a list of text, optional\)/);
});

test('a field added to a copy of a schema appears in the sentence, with nothing else touched', () => {
  const facts = shapeOf(OPERATIONS.save_scene.input)['facts']!;
  const item = itemObjectOf(facts) as unknown as z.AnyZodObject;
  const withAMadeUpField = z.array(item.extend({ weather: z.string().describe('What the sky over the ford was doing.') })).default([]);
  assert.match(parameterDescriptionForAHub(withAMadeUpField), /weather \(text, required\): What the sky over the ford was doing\./);
  const copiedInput = (OPERATIONS.save_scene.input as unknown as z.AnyZodObject).extend({ facts: withAMadeUpField });
  const offered = shapeOf(inputSchemaForAHub(copiedInput))['facts']!;
  assert.match(offered.description ?? '', /weather \(text, required\)/);
  assert.match(fieldsInWords(z.object({ count: z.number().int(), flags: z.array(z.boolean()).optional() })), /^count \(a number, required\)\. flags \(a list of yes or no values, optional\)\.$/);
  assert.match(parameterDescriptionForAHub(z.object({ ford: z.string() }).optional()), /^It is an object with: ford \(text, required\)\.$/);
});

test('the tool list is generated for MCP only: parsing a tool\'s input is unchanged', () => {
  for (const name of STORY_TOOL_NAMES) {
    const offered = inputSchemaForAHub(OPERATIONS[name].input);
    assert.deepEqual(Object.keys(shapeOf(offered)).sort(), Object.keys(shapeOf(OPERATIONS[name].input)).sort(), `${name} changed its parameters`);
  }
});

/**
 * Plain parameters the contract leaves with no description. Said here, and reported, rather than
 * given invented words. The test fails on any other, and on one of these once the contract gives
 * it words, so the list only shrinks.
 */
const LEFT_BLANK_BY_THE_CONTRACT = new Set([
  'begin_run.title', 'begin_run.setting', 'begin_run.status', 'save_scene.title', 'redo_scene.title', 'read_scene.number',
  'list_scenes.from', 'list_scenes.to', 'list_scenes.starredOnly', 'look_up.name', 'look_up.withHistory', 'find.text',
  'find.limit', 'list_rulings.topic', 'list_rulings.about', 'list_threads.about', 'list_threads.includeClosed',
  'record_ruling.statedByAuthor',
]);

test('no parameter of any tool has an empty description, but those the contract still leaves blank', async () => {
  const received = await toolProperties();
  const blank: string[] = [];
  for (const [name, properties] of received) {
    for (const [parameterName, property] of Object.entries(properties)) {
      if ((property.description ?? '').trim() === '') blank.push(`${name}.${parameterName}`);
    }
  }
  const newlyBlank = blank.filter((parameter) => !LEFT_BLANK_BY_THE_CONTRACT.has(parameter));
  assert.deepEqual(newlyBlank, [], `these parameters reach a chat with no description: ${newlyBlank.join(', ')}`);
  const nowDescribed = [...LEFT_BLANK_BY_THE_CONTRACT].filter((parameter) => !blank.includes(parameter));
  assert.deepEqual(nowDescribed, [], `the contract describes these now; take them off the list: ${nowDescribed.join(', ')}`);
});

test('a null is dropped at the top and inside each item, and nothing else is touched', () => {
  assert.deepEqual(
    argumentsWithNullsLeftOut({ run: 'the-ford', place: null, facts: [{ entry: 'the miller', about: null, note: '' }, 'odd'], files: { log: null, cast: 'x' }, count: 0, flag: false }),
    { run: 'the-ford', facts: [{ entry: 'the miller', note: '' }, 'odd'], files: { cast: 'x' }, count: 0, flag: false },
  );
  assert.equal(argumentsWithNullsLeftOut(null), null);
  assert.deepEqual(argumentsWithNullsLeftOut([null]), [null]);
});

/**
 * Valid arguments for every story tool, in an order that makes each valid, giving only what is
 * required at the top and some arrays of objects so the items' optional fields can be nulled.
 */
function storyCalls(slug: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  return [
    { name: 'begin_run', arguments: { slug, title: 'The Mill Pond', clocks: [{ name: 'days at the pond' }] } },
    { name: 'list_runs', arguments: {} },
    {
      name: 'save_scene',
      arguments: {
        run: slug, title: 'The sluice', when: 'the first morning', summary: 'The miller opens the sluice.', situationAfter: 'The pond drains.',
        readings: [{ clock: 'days at the pond', count: 1 }],
        entries: [{ name: 'the miller', kind: 'person' }, { name: 'the ford', kind: 'place' }],
        facts: [{ entry: 'the miller', property: 'where', value: 'at the sluice' }],
        notes: [{ entry: 'the miller', text: 'He opened the sluice.' }],
        rulings: [{ text: 'Keep the narration plain.' }],
        threadsOpened: [{ text: 'Where does the water go?' }],
        legs: [{ from: 'the ford', to: 'the pond', duration: 'an hour' }],
      },
    },
    { name: 'resume_run', arguments: { run: slug } },
    { name: 'read_scene', arguments: { run: slug, number: 1 } },
    { name: 'list_scenes', arguments: { run: slug } },
    { name: 'look_up', arguments: { run: slug, name: 'the miller' } },
    { name: 'find', arguments: { run: slug, text: 'sluice' } },
    { name: 'list_rulings', arguments: { run: slug } },
    { name: 'list_threads', arguments: { run: slug } },
    { name: 'record_ruling', arguments: { run: slug, text: 'No crossings at night.' } },
    { name: 'redo_scene', arguments: { run: slug, number: 1, title: 'The sluice, again', when: 'the first morning', summary: 'The miller leaves it shut.', situationAfter: 'The pond is full.' } },
  ];
}

/** The same arguments with every optional parameter, and every optional field of every item, sent as null. */
function withEveryOptionalNull(name: string, given: Record<string, unknown>): Record<string, unknown> {
  const shape = shapeOf(OPERATIONS[name as keyof typeof OPERATIONS].input);
  const nulled: Record<string, unknown> = { ...given };
  for (const [parameterName, parameter] of Object.entries(shape)) {
    if (!parameter.isOptional()) continue;
    const item = itemObjectOf(parameter);
    if (item !== null && Array.isArray(given[parameterName])) {
      nulled[parameterName] = (given[parameterName] as Array<Record<string, unknown>>).map((value) => {
        const withNulls = { ...value };
        for (const [field, fieldSchema] of Object.entries(shapeOf(item))) if (fieldSchema.isOptional() && !(field in value)) withNulls[field] = null;
        return withNulls;
      });
    } else if (!(parameterName in given)) {
      nulled[parameterName] = null;
    }
  }
  return nulled;
}

/** Ids and moments differ between two stores; everything else must not. */
function comparable(value: unknown): string {
  return JSON.stringify(value)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<moment>');
}

test('every story tool answers with every optional parameter null exactly as with them left out', async () => {
  const other = await startServerForTests();
  try {
    const otherClient = await other.mcpClient();
    const covered = new Set<string>();
    const leftOutCalls = storyCalls('the-mill-pond');
    for (const call of leftOutCalls) {
      const nulled = withEveryOptionalNull(call.name, call.arguments);
      const leftOut = await client.callTool({ name: call.name, arguments: call.arguments });
      const withNulls = await otherClient.callTool({ name: call.name, arguments: nulled });
      assert.notEqual(leftOut.isError, true, `${call.name} refused its valid arguments: ${JSON.stringify(leftOut.content)}`);
      assert.equal(comparable(withNulls), comparable(leftOut), `${call.name} answered nulls differently from the parameters left out`);
      covered.add(call.name);
    }
    assert.deepEqual([...covered].sort(), [...STORY_TOOL_NAMES].sort(), 'some story tool was not called with nulls');
  } finally {
    await other.stop();
  }
});

test('a null for a required parameter is still refused, naming it', async () => {
  for (const call of storyCalls('the-mill-pond-refusals')) {
    const shape = shapeOf(OPERATIONS[call.name as keyof typeof OPERATIONS].input);
    for (const [parameterName, parameter] of Object.entries(shape)) {
      if (parameter.isOptional()) continue;
      const result = await client.callTool({ name: call.name, arguments: { ...call.arguments, [parameterName]: null } });
      assert.equal(result.isError, true, `${call.name} took a null ${parameterName}`);
      assert.match(JSON.stringify(result.content), new RegExp(`\\b${parameterName}\\b`), `${call.name} refused a null ${parameterName} without naming it`);
    }
  }
  const missingItemField = await client.callTool({
    name: 'save_scene',
    arguments: { run: 'the-mill-pond', title: 'x', when: 'x', summary: 'x', situationAfter: 'x', facts: [{ entry: null, property: 'where', value: 'here' }] },
  });
  assert.equal(missingItemField.isError, true);
  assert.match(JSON.stringify(missingItemField.content), /facts.*0.*entry/);
});

test('over the web a null is still the contract\'s to refuse: the null is dropped on the MCP face only', async () => {
  const { status, body } = await running.call('list_scenes', { run: 'the-mill-pond', from: null });
  assert.equal(status, 400);
  assert.match(body.refusal ?? '', /"from"/);
});
