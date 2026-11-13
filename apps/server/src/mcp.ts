/**
 * The story operations as MCP tools. One tool per operation whose audience is `story`, named as
 * the operation, with the title, description and input schema taken from the contract and never
 * retyped; what is added for a hub in front is generated from the same schema. The author's operations are not offered here at all: a chat writing a story is the only
 * caller this face has.
 *
 * It is stateless: every request gets a fresh server and transport, so no session lives in memory
 * and nothing about one chat can reach another.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  OPERATIONS, OPERATION_NAMES, Refusal, type AnswerByOperation, type Briefing, type OperationName, type Store,
} from '@timeweft/contract';
import { ANSWER_IN_WORDS, NO_NAMES, briefingInWords, namesInTheRun, type NamesInTheRun } from './in-words.ts';
import { buildBriefing } from '@timeweft/briefing';
import { parseOperationInput, runOperation, snapshotForOperation } from './operations.ts';
import { inputSchemaForAHub, messageWithNullArgumentsLeftOut } from './tools-that-survive-a-hub.ts';

/** The operations offered as tools: every story operation, and only those. */
export const STORY_TOOL_NAMES: OperationName[] = OPERATION_NAMES.filter((name) => OPERATIONS[name].audience === 'story');

/** The run a tool's input names, if it names one, so ids in the answer can be said as names. */
async function namesForTheAnswer(store: Store, rawInput: unknown): Promise<NamesInTheRun> {
  const runSlug = typeof rawInput === 'object' && rawInput !== null ? (rawInput as { run?: unknown }).run : undefined;
  if (typeof runSlug !== 'string') return NO_NAMES;
  try {
    return namesInTheRun(await store.snapshotOf(runSlug, 'story'));
  } catch {
    return NO_NAMES;
  }
}

/** The tool result a briefing is answered with, saying the budget the chat asked for. */
function briefingToolResult(briefing: Briefing, budgetBytesAskedFor: number): CallToolResult {
  return {
    content: [{ type: 'text', text: briefingInWords(briefing) }],
    structuredContent: { bytes: briefing.bytes, budgetBytes: budgetBytesAskedFor, sections: briefing.sections },
  };
}

/** The size of a tool result as it travels: the JSON of it, escaping counted, in UTF-8 bytes. */
export function wholeToolResultBytes(result: CallToolResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

/**
 * Passes enough for any run measured: the first pass usually fits after one correction, and a
 * second correction covers the section table's figures changing width as the briefing shrinks.
 */
const MOST_PASSES_TO_FIT_A_BRIEFING = 8;

/**
 * A briefing answered over MCP, its whole tool result within the budget asked for. The budget is
 * the chat's room, and the text is not all that reaches it: the section table travels beside it
 * as structured content, and the text itself is escaped inside the JSON (a line break is two
 * bytes there). So the briefing is built, the whole result measured, and the briefing built again
 * against a budget smaller by what the result ran over. The text after a pass is never larger
 * than the budget it was built to, so each correction starts from the text's own size rather than
 * the budget, or a briefing smaller than its budget would take one pass per byte to shrink.
 */
export async function resumeRunWithinItsWholeBudget(store: Store, rawInput: unknown): Promise<CallToolResult> {
  const input = parseOperationInput('resume_run', rawInput, 'story');
  const snapshot = await snapshotForOperation(store, 'resume_run', input.run);
  const budgetBytesAskedFor = input.budgetBytes;
  let briefingBudgetBytes = budgetBytesAskedFor;
  let result = briefingToolResult(buildBriefing(snapshot, { upcoming: input.upcoming, budgetBytes: briefingBudgetBytes }), budgetBytesAskedFor);
  for (let pass = 1; pass < MOST_PASSES_TO_FIT_A_BRIEFING; pass += 1) {
    const overBytes = wholeToolResultBytes(result) - budgetBytesAskedFor;
    if (overBytes <= 0) return result;
    const textBytes = (result.structuredContent as { bytes: number }).bytes;
    briefingBudgetBytes = Math.max(0, Math.min(briefingBudgetBytes, textBytes) - overBytes);
    result = briefingToolResult(buildBriefing(snapshot, { upcoming: input.upcoming, budgetBytes: briefingBudgetBytes }), budgetBytesAskedFor);
  }
  // Said rather than sent over: a result larger than the chat asked for is the fault this guards.
  if (wholeToolResultBytes(result) > budgetBytesAskedFor) {
    throw new Refusal(`A briefing for "${input.run}" with its section table does not fit in ${budgetBytesAskedFor} bytes. Ask with a larger budgetBytes.`);
  }
  return result;
}

export async function answerToolCall(store: Store, name: OperationName, rawInput: unknown): Promise<CallToolResult> {
  try {
    if (name === 'resume_run') return await resumeRunWithinItsWholeBudget(store, rawInput);
    const answer = await runOperation(store, name, rawInput, 'story');
    const names = await namesForTheAnswer(store, rawInput);
    const sayInWords = ANSWER_IN_WORDS[name] as (answer: AnswerByOperation[OperationName], names: NamesInTheRun) => string;
    return {
      content: [{ type: 'text', text: sayInWords(answer, names) }],
      // Structured content must be an object, and several answers are lists, so every answer is
      // carried under one key, as the web route carries it. A briefing is answered apart, by
      // `briefingToolResult`, since its text is already the tool's text.
      structuredContent: { answer },
    };
  } catch (error) {
    if (error instanceof Refusal) return { isError: true, content: [{ type: 'text', text: error.message }] };
    console.error(`The tool ${name} failed:`, error);
    return { isError: true, content: [{ type: 'text', text: 'The server failed while doing that. Nothing was refused on purpose; try again, and tell the author if it keeps happening.' }] };
  }
}

export function makeMcpServer(store: Store): McpServer {
  const server = new McpServer({ name: 'timeweft', version: '0.1.0' });
  for (const name of STORY_TOOL_NAMES) {
    const definition = OPERATIONS[name];
    server.registerTool(name, {
      title: definition.title,
      description: definition.description,
      // The contract's schema, with each object parameter's fields said in its description, since
      // a hub may pass on the description and drop the fields.
      inputSchema: inputSchemaForAHub(definition.input),
      annotations: {
        title: definition.title,
        readOnlyHint: definition.effect === 'reads',
        // Nothing here loses anything: history is kept whole, and a redo keeps the earlier take.
        destructiveHint: false,
      },
    }, (input: unknown) => answerToolCall(store, name, input));
  }
  return server;
}

/** Serves one MCP request over Streamable HTTP, with a body the caller has already read. */
export async function serveMcpRequest(store: Store, request: IncomingMessage, response: ServerResponse, parsedBody: unknown): Promise<void> {
  const server = makeMcpServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on('close', () => {
    transport.close().catch((error: unknown) => console.error('Closing an MCP transport failed:', error));
    server.close().catch((error: unknown) => console.error('Closing an MCP server failed:', error));
  });
  await server.connect(transport);
  // A null is read as left out before the SDK parses a tool's input, since a hub offers null
  // beside every optional parameter and the contract gives null no meaning anywhere.
  await transport.handleRequest(request, response, messageWithNullArgumentsLeftOut(parsedBody));
}
