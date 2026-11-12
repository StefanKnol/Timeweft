/** Small checks on what a caller sent, refused in words the caller can act on. */
import { Refusal } from '@timeweft/contract';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXACT_COUNT = /^-?\d+(\.\d+)?$/;

export function looksLikeAnId(text: string): boolean {
  return UUID_SHAPE.test(text);
}

/** A clock count as text, refused where it is not an exact decimal. */
export function exactCount(count: number | string, clockName: string): string {
  const text = String(count).trim();
  if (!EXACT_COUNT.test(text)) {
    throw new Refusal(`The count on the clock "${clockName}" must be an exact number such as 12 or 3.5; "${text}" is not.`);
  }
  return text;
}

