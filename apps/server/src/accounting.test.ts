/**
 * Every operation in the contract has a handler, a web route that answers, a rendering in words,
 * and, where its audience is the story, an MCP tool made from the contract. No author operation is
 * a tool.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, OPERATION_NAMES } from '@timeweft/contract';
import { ANSWER_IN_WORDS } from './in-words.ts';
import { STORY_TOOL_NAMES } from './mcp.ts';
import { OPERATION_HANDLERS } from './operations.ts';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';

let running: RunningServer;
before(async () => {
  running = await startServerForTests();
});
after(async () => {
  await running.stop();
});

test('every operation has a handler and a rendering, and nothing else does', () => {
  assert.deepEqual(Object.keys(OPERATION_HANDLERS).sort(), [...OPERATION_NAMES].sort());
  assert.deepEqual(Object.keys(ANSWER_IN_WORDS).sort(), [...OPERATION_NAMES].sort());
});

test('every operation has a web route that answers in the wire shape', async () => {
  for (const name of OPERATION_NAMES) {
    const { status, body } = await running.call(name, {});
    assert.notEqual(status, 404, `${name} has no route`);
    assert.ok(status === 200 || status === 400, `${name} answered ${status}`);
    assert.equal(typeof body.ok, 'boolean', `${name} did not answer in the wire shape`);
  }
});

test('the tools are exactly the story operations, made from the contract', async () => {
  const client = await running.mcpClient();
  const { tools } = await client.listTools();
  const storyNames = OPERATION_NAMES.filter((name) => OPERATIONS[name].audience === 'story');
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...storyNames].sort());
  assert.deepEqual([...STORY_TOOL_NAMES].sort(), [...storyNames].sort());
  for (const tool of tools) {
    const definition = OPERATIONS[tool.name as keyof typeof OPERATIONS];
    assert.equal(tool.title, definition.title);
    assert.equal(tool.description, definition.description);
    assert.equal(tool.annotations?.readOnlyHint, definition.effect === 'reads', `${tool.name} has the wrong readOnlyHint`);
    assert.equal(tool.annotations?.destructiveHint, false);
    const shapeKeys = Object.keys((definition.input as unknown as { shape: Record<string, unknown> }).shape).sort();
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), shapeKeys, `${tool.name} does not take the contract's input`);
  }
});

test('no author operation is offered as a tool', async () => {
  const client = await running.mcpClient();
  const { tools } = await client.listTools();
  for (const name of OPERATION_NAMES.filter((candidate) => OPERATIONS[candidate].audience === 'author')) {
    assert.ok(!tools.some((tool) => tool.name === name), `${name} is the author's and must not be a tool`);
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, true, `${name} answered over MCP`);
  }
});
