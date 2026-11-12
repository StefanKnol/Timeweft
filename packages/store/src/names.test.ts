import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, normaliseProperty } from './names.ts';

test('a property is kept as a name is: composed, trimmed, its inner spaces made one, and in lower case', () => {
  // "e" followed by a combining acute is the same letter as the composed one, and a run of spaces,
  // a tab or a no-break space inside a property is one space, so none of these is a property of its own.
  const spellings = ['  Cafe\u0301   Owner ', 'caf\u00e9 owner', 'CAF\u00c9\towner', 'caf\u00e9\u00a0\u00a0owner'];
  for (const spelling of spellings) assert.equal(normaliseProperty(spelling), 'caf\u00e9 owner', JSON.stringify(spelling));
  for (const spelling of spellings) assert.equal(normaliseProperty(spelling), normaliseName(spelling));
});
