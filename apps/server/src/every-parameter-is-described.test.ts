/**
 * Every parameter of every tool, and every field of every object a parameter carries, reaches a
 * real MCP client with words of its own. Read from the JSON Schema the running server's tools/list
 * sends, not from the zod it was made from, so what is checked is what a chat is given.
 *
 * There is no list of blanks allowed: the contract describes every one, so a blank fails by its
 * tool and parameter name, and a field added to the contract without words fails here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z, type ZodTypeAny } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OPERATIONS } from '@timeweft/contract';
import { STORY_TOOL_NAMES } from './mcp.ts';
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

interface ReceivedSchema {
  type?: string | string[];
  description?: string;
  items?: ReceivedSchema;
  properties?: Record<string, ReceivedSchema>;
  anyOf?: ReceivedSchema[];
}

function isOfType(schema: ReceivedSchema, typeName: string): boolean {
  return Array.isArray(schema.type) ? schema.type.includes(typeName) : schema.type === typeName;
}

/**
 * Every place under one parameter that lacks a description, by path: the parameter itself, and
 * each property of an object it is or that an array of it holds, walked all the way down.
 */
function blanksUnder(path: string, schema: ReceivedSchema, describedHere: boolean): string[] {
  const blanks: string[] = [];
  if (describedHere && (schema.description ?? '').trim() === '') blanks.push(path);
  if (isOfType(schema, 'array')) {
    const items = schema.items;
    if (items !== undefined && isOfType(items, 'object')) {
      if (items.properties === undefined || Object.keys(items.properties).length === 0) blanks.push(`${path}[] has no properties`);
      // The items themselves need no words of their own: the parameter's describe the list.
      blanks.push(...blanksUnder(`${path}[]`, items, false));
    }
  }
  if (isOfType(schema, 'object')) {
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      blanks.push(...blanksUnder(`${path}.${field}`, fieldSchema, true));
    }
  }
  for (const option of schema.anyOf ?? []) blanks.push(...blanksUnder(path, option, false));
  return blanks;
}

test('every parameter and every field of every object a parameter carries has a description, as a client receives it', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...STORY_TOOL_NAMES].sort());
  const blanks: string[] = [];
  let parametersChecked = 0;
  let itemObjectsChecked = 0;
  for (const tool of tools) {
    for (const [parameterName, parameter] of Object.entries((tool.inputSchema.properties ?? {}) as Record<string, ReceivedSchema>)) {
      parametersChecked += 1;
      if (isOfType(parameter, 'array') && parameter.items !== undefined && isOfType(parameter.items, 'object')) itemObjectsChecked += 1;
      blanks.push(...blanksUnder(`${tool.name}.${parameterName}`, parameter, true));
    }
  }
  assert.deepEqual(blanks, [], `these reach a chat with no description: ${blanks.join(', ')}`);
  // A walk that found nothing to check would pass on any tool list.
  assert.ok(parametersChecked >= 40, `only ${parametersChecked} parameters were found`);
  assert.ok(itemObjectsChecked >= 8, `only ${itemObjectsChecked} arrays of objects were found`);
});

/** Whether a contract parameter is a list of objects, under its default and optional. */
function isArrayOfObjectsInTheContract(parameter: ZodTypeAny): boolean {
  let current: ZodTypeAny = parameter;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) current = current._def.innerType as ZodTypeAny;
  return current instanceof z.ZodArray && current.element instanceof z.ZodObject;
}

test('every parameter the contract makes a list of objects reaches the client with its items as an object with properties', async () => {
  // The received schema alone cannot tell a list of objects flattened to a list of anything from
  // one that never had fields, so which parameters must arrive whole is read from the contract.
  const { tools } = await client.listTools();
  const flattened: string[] = [];
  let checked = 0;
  for (const name of STORY_TOOL_NAMES) {
    const received = (tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {}) as Record<string, ReceivedSchema>;
    const shape = (OPERATIONS[name].input as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
    for (const [parameterName, parameter] of Object.entries(shape)) {
      if (!isArrayOfObjectsInTheContract(parameter)) continue;
      checked += 1;
      const items = received[parameterName]?.items;
      if (items === undefined || !isOfType(items, 'object') || Object.keys(items.properties ?? {}).length === 0) flattened.push(`${name}.${parameterName}`);
    }
  }
  assert.deepEqual(flattened, [], `these lists of objects reach a client with no item fields: ${flattened.join(', ')}`);
  assert.ok(checked >= 8, `only ${checked} lists of objects were found in the contract`);
});

test('an array of objects is offered with its items whole: save_scene\'s facts carry statedByAuthor as a property', async () => {
  const { tools } = await client.listTools();
  const facts = (tools.find((tool) => tool.name === 'save_scene')?.inputSchema.properties as Record<string, ReceivedSchema> | undefined)?.['facts'];
  assert.ok(facts !== undefined && isOfType(facts, 'array'));
  assert.ok(facts.items !== undefined && isOfType(facts.items, 'object'));
  assert.ok((facts.items.properties?.['statedByAuthor']?.description ?? '') !== '');
  // Nothing from the removed workaround: the parameter's description is its own and no more.
  assert.doesNotMatch(facts.description ?? '', /Each item is an object with/);
});

/**
 * Whether a parameter carries words of its own, on itself or on any wrapper around it: `optional`,
 * `default`, `nullable` and refinements each keep the description where it was given.
 */
function contractDescriptionOf(parameter: ZodTypeAny): string {
  let current: ZodTypeAny | undefined = parameter;
  while (current !== undefined) {
    const said = (current.description ?? '').trim();
    if (said !== '') return said;
    if (current instanceof z.ZodDefault || current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current._def.innerType as ZodTypeAny;
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema as ZodTypeAny;
    } else {
      current = undefined;
    }
  }
  return '';
}

/** The schema a parameter holds once its wrappers are taken off. */
function unwrappedInTheContract(parameter: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = parameter;
  for (;;) {
    if (current instanceof z.ZodDefault || current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current._def.innerType as ZodTypeAny;
    else if (current instanceof z.ZodEffects) current = current._def.schema as ZodTypeAny;
    else return current;
  }
}

/** Every place under one contract parameter with no description, walked into objects and lists of objects. */
function contractBlanksUnder(path: string, parameter: ZodTypeAny, describedHere: boolean): string[] {
  const blanks: string[] = [];
  if (describedHere && contractDescriptionOf(parameter) === '') blanks.push(path);
  const inner = unwrappedInTheContract(parameter);
  if (inner instanceof z.ZodArray) blanks.push(...contractBlanksUnder(`${path}[]`, inner.element as ZodTypeAny, false));
  if (inner instanceof z.ZodObject) {
    for (const [field, fieldSchema] of Object.entries(inner.shape as Record<string, ZodTypeAny>)) {
      blanks.push(...contractBlanksUnder(`${path}.${field}`, fieldSchema, true));
    }
  }
  return blanks;
}

test('every parameter of every operation, the author\'s included, carries a description in the contract', () => {
  // The author's operations never reach a client over MCP, so they are read from the contract
  // itself: the page and anyone reading the routes are told what each field is all the same.
  const blanks: string[] = [];
  let authorParametersChecked = 0;
  for (const [name, definition] of Object.entries(OPERATIONS)) {
    const shape = (definition.input as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
    for (const [parameterName, parameter] of Object.entries(shape)) {
      if (definition.audience === 'author') authorParametersChecked += 1;
      blanks.push(...contractBlanksUnder(`${name}.${parameterName}`, parameter, true));
    }
  }
  assert.deepEqual(blanks, [], `these have no description in the contract: ${blanks.join(', ')}`);
  assert.ok(authorParametersChecked >= 30, `only ${authorParametersChecked} parameters of the author's operations were found`);
});
