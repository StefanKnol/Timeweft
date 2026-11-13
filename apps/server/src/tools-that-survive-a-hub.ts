/**
 * What the MCP face does so a tool still means something after a hub has passed it on.
 *
 * Measured through the author's hub: a parameter that is an array of objects reaches the chat as
 * an array of anything, every field of its items gone, while descriptions survive. So each such
 * parameter's description is made to say its items' fields in words, generated from the same zod
 * schema, so a field added to the contract is said with nothing else touched. And the hub offers
 * null beside every optional parameter, which the contract never gives a meaning, so a null is read
 * as the key left out before the input is parsed.
 *
 * Both are the MCP face's alone. The web route parses the contract's schema as it is.
 */
import { z, type ZodTypeAny } from 'zod';

/** The wrappers that change how a value is given but not what it is, with the schema inside. */
function innerOfWrapper(schema: ZodTypeAny): ZodTypeAny | null {
  const definition = schema._def as { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; type?: ZodTypeAny; in?: ZodTypeAny };
  switch (definition.typeName) {
    case 'ZodDefault':
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodReadonly':
    case 'ZodCatch':
      return definition.innerType ?? null;
    case 'ZodEffects':
      return definition.schema ?? null;
    case 'ZodBranded':
      return definition.type ?? null;
    case 'ZodPipeline':
      return definition.in ?? null;
    default:
      return null;
  }
}

/** The schema with every wrapper taken off: what the value itself is. */
export function unwrapped(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (let inner = innerOfWrapper(current); inner !== null; inner = innerOfWrapper(current)) current = inner;
  return current;
}

/** The first description found from the outside in, so `.describe` before or after `.default` both count. */
export function descriptionOf(schema: ZodTypeAny): string {
  let current: ZodTypeAny | null = schema;
  while (current !== null) {
    const description = current.description?.trim() ?? '';
    if (description !== '') return description;
    current = innerOfWrapper(current);
  }
  return '';
}

function typeNameOf(schema: ZodTypeAny): string {
  return (schema._def as { typeName?: string }).typeName ?? '';
}

function shapeOf(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  return (schema as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
}

/** The object an array's items are, or null where the parameter is not an array of objects. */
export function itemObjectOf(schema: ZodTypeAny): ZodTypeAny | null {
  const value = unwrapped(schema);
  if (typeNameOf(value) !== 'ZodArray') return null;
  const item = unwrapped((value._def as { type: ZodTypeAny }).type);
  return typeNameOf(item) === 'ZodObject' ? item : null;
}

/** The object a parameter is, or null where it is not a plain object with fields. */
export function plainObjectOf(schema: ZodTypeAny): ZodTypeAny | null {
  const value = unwrapped(schema);
  return typeNameOf(value) === 'ZodObject' ? value : null;
}

/** What kind of value a field takes, in plain words. */
export function kindInWords(schema: ZodTypeAny): string {
  const value = unwrapped(schema);
  switch (typeNameOf(value)) {
    case 'ZodString':
      return 'text';
    case 'ZodNumber':
    case 'ZodBigInt':
      return 'a number';
    case 'ZodBoolean':
      return 'yes or no';
    case 'ZodEnum':
      return `one of ${(value._def as { values: readonly string[] }).values.map((option) => `"${option}"`).join(', ')}`;
    case 'ZodNativeEnum':
      return `one of ${Object.values((value._def as { values: Record<string, string | number> }).values).map((option) => `"${String(option)}"`).join(', ')}`;
    case 'ZodLiteral':
      return `exactly ${JSON.stringify((value._def as { value: unknown }).value)}`;
    case 'ZodArray':
      return `a list of ${listedKindInWords((value._def as { type: ZodTypeAny }).type)}`;
    case 'ZodUnion':
      return (value._def as { options: ZodTypeAny[] }).options.map(kindInWords).join(' or ');
    case 'ZodObject':
      return 'an object';
    default:
      return 'a value';
  }
}

/** A kind as it reads after "a list of": text stays text, "a number" becomes numbers. */
function listedKindInWords(schema: ZodTypeAny): string {
  const kind = kindInWords(schema);
  if (kind === 'a number') return 'numbers';
  if (kind === 'yes or no') return 'yes or no values';
  if (kind === 'an object') return 'objects';
  return kind;
}

function withClosingStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * One object's fields in words: each field's name, its kind, whether it is required and its own
 * description. A field with a default is optional, since leaving it out is allowed.
 */
export function fieldsInWords(objectSchema: ZodTypeAny): string {
  return Object.entries(shapeOf(objectSchema)).map(([fieldName, field]) => {
    const head = `${fieldName} (${kindInWords(field)}, ${field.isOptional() ? 'optional' : 'required'})`;
    const description = descriptionOf(field);
    return description === '' ? `${head}.` : `${head}: ${withClosingStop(description)}`;
  }).join(' ');
}

/**
 * A parameter's description as the tool list offers it: its own description, then its items'
 * fields where it is an array of objects, or its fields where it is a plain object. A parameter
 * that is neither keeps its own description, which may be empty.
 */
export function parameterDescriptionForAHub(parameter: ZodTypeAny): string {
  const own = descriptionOf(parameter);
  const items = itemObjectOf(parameter);
  const plain = items === null ? plainObjectOf(parameter) : null;
  const fields = items !== null
    ? `Each item is an object with: ${fieldsInWords(items)}`
    : plain !== null ? `It is an object with: ${fieldsInWords(plain)}` : '';
  if (fields === '') return own;
  return own === '' ? fields : `${withClosingStop(own)} ${fields}`;
}

/**
 * The input schema the tool list offers: the contract's own, with every parameter that is an
 * object or an array of objects described in words. Parsing is unchanged, since `.describe` only
 * copies the schema with a new description.
 */
export function inputSchemaForAHub(input: ZodTypeAny): ZodTypeAny {
  if (typeNameOf(input) !== 'ZodObject') return input;
  const object = input as unknown as z.AnyZodObject;
  const described: Record<string, ZodTypeAny> = {};
  for (const [name, parameter] of Object.entries(shapeOf(object))) {
    if (itemObjectOf(parameter) === null && plainObjectOf(parameter) === null) continue;
    described[name] = parameter.describe(parameterDescriptionForAHub(parameter));
  }
  return object.extend(described);
}

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
