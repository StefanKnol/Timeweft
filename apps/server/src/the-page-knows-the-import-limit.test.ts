/**
 * The page holds the import and restore routes' body limits as figures of its own, since it may
 * import only from the contract and the contract does not hold them. This reads the page's source
 * as text and fails where a figure parts from the server's, so the page never lets an import or a
 * restore start that the server will refuse with a 413, nor refuses one the server would take.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { largestBodyBytesFor } from './http-server.ts';

const SHAPING_SOURCE = readFileSync(new URL('../../web/src/shaping.ts', import.meta.url), 'utf8');

/** The page's figure, read from `export const <name> = <a product of whole numbers>;`. */
function pagesLargestBodyBytes(constantName: string): number {
  const declaration = new RegExp(`export const ${constantName} = ([\\d\\s*]+);`).exec(SHAPING_SOURCE);
  assert.ok(declaration !== null, `apps/web/src/shaping.ts no longer declares ${constantName} as a product of whole numbers`);
  return (declaration[1] ?? '').split('*').map((factor) => Number(factor.trim())).reduce((product, factor) => product * factor, 1);
}

test('the page holds the import route to the same body limit the server does', () => {
  assert.equal(pagesLargestBodyBytes('LARGEST_IMPORT_BODY_BYTES'), largestBodyBytesFor('import_run'));
});

test('the page holds the restore route to the same body limit the server does', () => {
  assert.equal(pagesLargestBodyBytes('LARGEST_RESTORE_BODY_BYTES'), largestBodyBytesFor('restore_run'));
});
