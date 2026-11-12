/**
 * A briefing has a size, and over MCP the whole tool result keeps to it. The briefing is the text;
 * the structured content carries only its sizes, never the text a second time, which would make
 * the result about twice what the chat asked for.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { startServerForTests, type RunningServer } from './server-for-tests.ts';

/** Room for the section table and the JSON around the text, whatever the budget. */
const ALLOWANCE_FOR_THE_SECTION_TABLE_BYTES = 4096;

let running: RunningServer;
let client: Client;
before(async () => {
  running = await startServerForTests();
  client = await running.mcpClient();
});
after(async () => {
  await running.stop();
});

async function callOrFail(name: string, input: Record<string, unknown>): Promise<void> {
  const result = await client.callTool({ name, arguments: input });
  assert.notEqual(result.isError, true, `${name} refused: ${JSON.stringify(result.content)}`);
}

test('the whole resume_run tool result stays within the budget plus the section table', async () => {
  const slug = 'the-long-mill-pond';
  await callOrFail('begin_run', { slug, title: 'The Long Mill Pond', setting: 'A mill pond and a long summer.' });
  const longSummary = 'The baker walks the length of the pond and counts the reeds. '.repeat(40);
  for (let sceneNumber = 1; sceneNumber <= 12; sceneNumber += 1) {
    await callOrFail('save_scene', {
      run: slug, title: `Day ${sceneNumber}`, when: `day ${sceneNumber}`,
      summary: longSummary, situationAfter: `The baker rests on day ${sceneNumber}.`,
      entries: sceneNumber === 1 ? [{ name: 'Ada the baker', kind: 'person', pronoun: 'she' }] : [],
      facts: [{ entry: 'Ada the baker', property: 'where', value: `by the pond on day ${sceneNumber}` }],
    });
  }

  const budgetBytes = 8000;
  const result = await client.callTool({ name: 'resume_run', arguments: { run: slug, budgetBytes } });
  assert.notEqual(result.isError, true);
  const content = result.content as Array<{ type: string; text: string }>;
  const briefingText = content.map((part) => part.text).join('\n');
  assert.ok(Buffer.byteLength(briefingText, 'utf8') > budgetBytes / 2, 'the run was too small to fill the budget, so the test proves nothing');

  const structured = result.structuredContent as Record<string, unknown>;
  assert.deepEqual(Object.keys(structured).sort(), ['bytes', 'budgetBytes', 'sections'].sort());
  assert.equal(structured['budgetBytes'], budgetBytes);
  assert.equal(structured['bytes'], Buffer.byteLength(briefingText, 'utf8'));
  assert.ok(Array.isArray(structured['sections']));

  const wholeResultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  assert.ok(
    wholeResultBytes <= budgetBytes + ALLOWANCE_FOR_THE_SECTION_TABLE_BYTES,
    `the whole tool result was ${wholeResultBytes} bytes for a budget of ${budgetBytes}`,
  );
});
