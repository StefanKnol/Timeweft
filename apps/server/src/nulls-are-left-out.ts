/**
 * A tool's arguments with every null read as left out, on the MCP face only.
 *
 * A client may offer null beside every optional parameter, and no parameter in the contract gives
 * null a meaning, so a null is dropped before the input is parsed and the parameter's default
 * applies as if it had never been sent. The web route parses the contract's schema as it is.
 */

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutNullKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null));
}

/**
 * A tool's arguments with every null read as left out: a top-level key whose value is null is
 * dropped, and so is one inside each object in an array, or inside a plain object, so a default
 * applies as if the key had never been sent. A null for a required parameter is dropped too, and
 * is then refused as missing, by its name.
 */
export function argumentsWithNullsLeftOut(toolArguments: unknown): unknown {
  if (!isPlainRecord(toolArguments)) return toolArguments;
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(toolArguments)) {
    if (value === null) continue;
    if (Array.isArray(value)) result[name] = value.map((item) => (isPlainRecord(item) ? withoutNullKeys(item) : item));
    else if (isPlainRecord(value)) result[name] = withoutNullKeys(value);
    else result[name] = value;
  }
  return result;
}

/**
 * The same, applied to a JSON-RPC message or a batch of them: only a tools/call has its arguments
 * changed, and every other message passes through as it came.
 */
export function messageWithNullArgumentsLeftOut(message: unknown): unknown {
  if (Array.isArray(message)) return message.map(messageWithNullArgumentsLeftOut);
  if (!isPlainRecord(message) || message['method'] !== 'tools/call' || !isPlainRecord(message['params'])) return message;
  const params = message['params'];
  if (!('arguments' in params)) return message;
  return { ...message, params: { ...params, arguments: argumentsWithNullsLeftOut(params['arguments']) } };
}
