/**
 * resume_run as an MCP tool answers it: the briefing, its whole tool result within the budget
 * asked for. Kept apart from the tool registration so that the briefing a chat attaches is made
 * by the very same path as the briefing the tool answers.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Refusal, type Briefing, type Store } from '@timeweft/contract';
import { buildBriefing } from '@timeweft/briefing';
import { briefingInWords } from './in-words.ts';
import { parseOperationInput, snapshotForOperation } from './operations.ts';

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
