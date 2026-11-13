/**
 * The story operations as MCP tools. One tool per operation whose audience is `story`, named as
 * the operation, with the title, description and input schema taken from the contract and never
 * retyped. The author's operations are not offered here at all: a chat writing a story is the
 * only caller this face has.
 *
 * It is stateless: every request gets a fresh server and transport, so no session lives in memory
 * and nothing about one chat can reach another.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  OPERATIONS, OPERATION_NAMES, Refusal, type AnswerByOperation, type OperationName, type Store,
} from '@timeweft/contract';
import { ANSWER_IN_WORDS, NO_NAMES, namesInTheRun, type NamesInTheRun } from './in-words.ts';
import { runOperation } from './operations.ts';
import { resumeRunWithinItsWholeBudget } from './resume-run-over-mcp.ts';
import { registerTheAttachments } from './attachments.ts';
import { messageWithNullArgumentsLeftOut } from './nulls-are-left-out.ts';

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
      // The contract's own schema, whole: every parameter and every item field carries its own
      // description there, so the tool list needs nothing added.
      inputSchema: definition.input,
      annotations: {
        title: definition.title,
        readOnlyHint: definition.effect === 'reads',
        // Nothing here loses anything: history is kept whole, and a redo keeps the earlier take.
        destructiveHint: false,
      },
    }, (input: unknown) => answerToolCall(store, name, input));
  }
  // What a chat may attach from the connector's menu: copies of story answers, and one prompt.
  registerTheAttachments(server, store);
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
  // A null is read as left out before the SDK parses a tool's input, since a client may offer null
  // beside every optional parameter and the contract gives null no meaning anywhere.
  await transport.handleRequest(request, response, messageWithNullArgumentsLeftOut(parsedBody));
}
