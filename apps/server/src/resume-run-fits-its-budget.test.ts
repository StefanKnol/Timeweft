/**
 * A briefing has a size, and over MCP the whole tool result keeps to it: the text, its JSON
 * escaping and the section table together. The briefing is the text; the structured content
 * carries only its sizes, never the text a second time, which would make the result about twice
 * what the chat asked for.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
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

async function callOrFail(name: string, input: Record<string, unknown>): Promise<void> {
  const result = await client.callTool({ name, arguments: input });
  assert.notEqual(result.isError, true, `${name} refused: ${JSON.stringify(result.content)}`);
}

const SLUG = 'the-long-mill-pond';

/**
 * A run with more than either budget can hold: many scenes, many facts and rulings, and text full
 * of the characters JSON has to escape (quotes and line breaks), so that escaping is measured too.
 */
async function writeALongRun(): Promise<void> {
  await callOrFail('begin_run', { slug: SLUG, title: 'The Long Mill Pond', setting: 'A mill pond and a "long" summer.' });
  const longSummary = 'The baker walks the length of the pond and counts the "reeds". '.repeat(20);
  for (let sceneNumber = 1; sceneNumber <= 60; sceneNumber += 1) {
    await callOrFail('save_scene', {
      run: SLUG, title: `Day ${sceneNumber}`, when: `day ${sceneNumber}`,
      summary: longSummary, situationAfter: `The baker rests on day ${sceneNumber}.\nThe mill is "quiet".`,
      entries: sceneNumber === 1
        ? [{ name: 'Ada the baker', kind: 'person', pronoun: 'she' }, { name: 'The mill', kind: 'place' }]
        : [],
      facts: [
        { entry: 'Ada the baker', property: `chore ${sceneNumber}`, value: `sweeps the "loft" on day ${sceneNumber}` },
        { entry: 'The mill', property: `sack ${sceneNumber}`, value: `holds flour from day ${sceneNumber}` },
      ],
    });
  }
  for (let rulingNumber = 1; rulingNumber <= 30; rulingNumber += 1) {
    await callOrFail('record_ruling', {
      run: SLUG, topic: `the "pond" ${rulingNumber}`, text: `The pond is never drained, rule ${rulingNumber}.\nIt stays "still".`,
    });
  }
}

async function wholeResultAt(budgetBytes: number): Promise<{ wholeResultBytes: number; textBytes: number; structured: Record<string, unknown> }> {
  const result = await client.callTool({ name: 'resume_run', arguments: { run: SLUG, budgetBytes } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const content = result.content as Array<{ type: string; text: string }>;
  const briefingText = content.map((part) => part.text).join('\n');
  return {
    wholeResultBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
    textBytes: Buffer.byteLength(briefingText, 'utf8'),
    structured: result.structuredContent as Record<string, unknown>,
  };
}

test('the whole resume_run tool result, section table and escaping included, is within its budget', async () => {
  await writeALongRun();
  for (const budgetBytes of [2000, 20000]) {
    const { wholeResultBytes, textBytes, structured } = await wholeResultAt(budgetBytes);
    assert.deepEqual(Object.keys(structured).sort(), ['bytes', 'budgetBytes', 'sections'].sort());
    assert.equal(structured['budgetBytes'], budgetBytes, 'the table says the budget the chat asked for');
    assert.equal(structured['bytes'], textBytes);
    assert.ok(Array.isArray(structured['sections']));
    assert.ok(
      wholeResultBytes <= budgetBytes,
      `the whole tool result was ${wholeResultBytes} bytes for a budget of ${budgetBytes}`,
    );
    // The run is larger than the budget, so a briefing that used little of it would be a fault too.
    assert.ok(wholeResultBytes > budgetBytes * 0.8, `the whole tool result used only ${wholeResultBytes} of ${budgetBytes} bytes`);
  }
});
