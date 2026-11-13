import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAlreadyExistsSentence, runAlreadyExistsUnreplaceablySentence, type ImportedRunReport, type RunRecord } from '@timeweft/contract';
import {
  importButtonText, importRunInput, removedEarlierImportInWords, replaceEarlierImportLabel, replaceEarlierImportOffered,
  slugRefusedAsExisting,
} from './shaping.ts';

// A made-up demo world: a baker's run, imported and imported again.

const FORM = { slug: 'the-bakery', title: '', setting: '', status: 'binding' as const };

test('replacing is offered only after the server said the run exists, and only for that slug', () => {
  const said = slugRefusedAsExisting(runAlreadyExistsSentence('the-bakery'), 'the-bakery');
  assert.equal(said, 'the-bakery');
  assert.equal(slugRefusedAsExisting('Scene 4 names "the oven", which no entry is called.', 'the-bakery'), null);
  assert.equal(replaceEarlierImportOffered(null, 'the-bakery'), false);
  assert.equal(replaceEarlierImportOffered(said, 'the-bakery'), true);
  assert.equal(replaceEarlierImportOffered(said, 'the-bakery-two'), false);
});

test('a slug taken by a run no import made offers no replacement, since the store would refuse it', () => {
  assert.equal(slugRefusedAsExisting(runAlreadyExistsUnreplaceablySentence('the-bakery'), 'the-bakery'), null);
});

test('the box says the earlier import is replaced by the picked files', () => {
  const label = replaceEarlierImportLabel('the-bakery');
  assert.match(label, /^Replace the earlier import of "the-bakery" with the files picked above\./);
  assert.match(label, /removed with everything it holds/);
});

test('the input asks for replacing only when the box is ticked', () => {
  assert.equal('replaceEarlierImport' in importRunInput(FORM, { log: '# The Bakery' }), false);
  assert.equal('replaceEarlierImport' in importRunInput({ ...FORM, replaceEarlierImport: false }, {}), false);
  assert.equal(importRunInput({ ...FORM, replaceEarlierImport: true }, {}).replaceEarlierImport, true);
});

test('the button says when it replaces', () => {
  assert.equal(importButtonText(false, false), 'Import');
  assert.equal(importButtonText(false, true), 'Import, replacing the earlier one');
  assert.equal(importButtonText(true, true), 'Replacing…');
});

test('what a replacing import removed is said in the counts own words, and nothing where none was replaced', () => {
  const counts = { scenes: 2, entries: 1, facts: 0, trailNotes: 0, rulings: 0, threads: 0, waypoints: 0, journeyLegs: 0, clocks: 1 };
  const run = { slug: 'the-bakery', title: 'The Bakery' } as RunRecord;
  const report: ImportedRunReport = { run, counts, unplaced: [], removedEarlierImport: { ...counts, scenes: 5 } };
  assert.deepEqual(removedEarlierImportInWords(report)?.slice(0, 2), [{ label: 'Scenes', count: 5 }, { label: 'Entries', count: 1 }]);
  assert.equal(removedEarlierImportInWords({ ...report, removedEarlierImport: null }), null);
  assert.equal(removedEarlierImportInWords({ run, counts, unplaced: [] }), null);
});
