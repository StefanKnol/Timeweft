/**
 * A null sent for an optional parameter answers exactly as the parameter left out, on the MCP face,
 * and a null for a required one is still refused by its name. Over the web a null stays the
 * contract's to refuse.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z, type ZodTypeAny } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OPERATIONS } from '@timeweft/contract';
import { STORY_TOOL_NAMES } from './mcp.ts';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';
import { argumentsWithNullsLeftOut } from './nulls-are-left-out.ts';

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

/** The object an optional array parameter's items are, found by peeling its default and optional. */
function itemObjectOf(schema: ZodTypeAny): z.AnyZodObject | null {
  let current: ZodTypeAny = schema;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) current = current._def.innerType as ZodTypeAny;
  if (!(current instanceof z.ZodArray)) return null;
  const item = current.element as ZodTypeAny;
  return item instanceof z.ZodObject ? item : null;
}

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
