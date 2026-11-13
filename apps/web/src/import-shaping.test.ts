import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_PARTS, LARGEST_IMPORT_BYTES, importCountsInWords, importRunInput, matchFilesToParts, partOfFileName,
  slugFromTitle, slugShown, titleFromLogText, unplacedInWords, whyFilesAreTooLarge, whyImportCannotStart,
  whySlugIsNotWellFormed,
} from './shaping.ts';

// A made-up demo world: a baker's run, kept in five files.

function file(name: string, size = 100): { name: string; size: number } {
  return { name, size };
}

test('a file is matched to its part by name, case-blind', () => {
  assert.equal(partOfFileName('log.md'), 'log');
  assert.equal(partOfFileName('STATE.MD'), 'state');
  assert.equal(partOfFileName('Cast.md'), 'cast');
  assert.equal(partOfFileName('items.md'), 'items');
  assert.equal(partOfFileName('places.md'), 'places');
});

test('a name with a prefix before the part is matched, as a downloaded file often has', () => {
  assert.equal(partOfFileName('the-run-log.md'), 'log');
  assert.equal(partOfFileName('9e21-state.md'), 'state');
  assert.equal(partOfFileName('baker run places.md'), 'places');
  assert.equal(partOfFileName('baker_cast.md'), 'cast');
});

test('a name that only ends in the letters of a part is not that part', () => {
  assert.equal(partOfFileName('catalog.md'), null);
  assert.equal(partOfFileName('estate.md'), null);
  assert.equal(partOfFileName('log.txt'), null);
  assert.equal(partOfFileName('notes.md'), null);
});

test('files are matched to the five parts, a part not given is null and an unknown file is not used', () => {
  const matched = matchFilesToParts([file('log.md'), file('mill-cast.md'), file('readme.md')]);
  assert.equal(matched.byPart.log?.name, 'log.md');
  assert.equal(matched.byPart.cast?.name, 'mill-cast.md');
  assert.equal(matched.byPart.state, null);
  assert.equal(matched.byPart.items, null);
  assert.equal(matched.byPart.places, null);
  assert.deepEqual(matched.notUsed.map((each) => each.name), ['readme.md']);
  assert.deepEqual(matched.refusals, []);
});

test('two files for one part are refused in words naming both, and neither is matched', () => {
  const matched = matchFilesToParts([file('log.md'), file('old-log.md'), file('state.md')]);
  assert.equal(matched.byPart.log, null);
  assert.equal(matched.byPart.state?.name, 'state.md');
  assert.equal(matched.refusals.length, 1);
  assert.match(matched.refusals[0] ?? '', /"log\.md"/);
  assert.match(matched.refusals[0] ?? '', /"old-log\.md"/);
  assert.match(matched.refusals[0] ?? '', /log\.md\. Pick only one/);
});

test('the title line of a log is its first top heading, with a trailing "- log" taken off', () => {
  assert.equal(titleFromLogText('# The Baker of the Ford - Log\n\n## Scene 1: Dawn'), 'The Baker of the Ford');
  assert.equal(titleFromLogText('Some preface\n# The Mill\n'), 'The Mill');
  assert.equal(titleFromLogText('## Scene 1: Dawn\nno top heading'), null);
  assert.equal(titleFromLogText('# Movement One\n## Scene 1'), null);
});

test('a slug is made from a title: lower case, accents off, hyphens between words', () => {
  assert.equal(slugFromTitle('The Baker of the Ford'), 'the-baker-of-the-ford');
  assert.equal(slugFromTitle('  Crème Brûlée, Again!  '), 'creme-brulee-again');
  assert.equal(slugFromTitle('Mill 2: the Return'), 'mill-2-the-return');
  assert.equal(slugFromTitle('!!!'), '');
});

test('a slug offered from a long title is cut at a hyphen and stays well formed', () => {
  const slug = slugFromTitle('the long road from the ford to the mill and back again by the old ferry crossing at dusk');
  assert.ok(slug.length <= 60, slug);
  assert.equal(whySlugIsNotWellFormed(slug), null);
  assert.ok(!slug.endsWith('-'));
});

test('the slug box shows the offered slug until the author types, then what they typed', () => {
  assert.equal(slugShown('', false, 'The Mill'), 'the-mill');
  assert.equal(slugShown('', false, null), '');
  assert.equal(slugShown('my-own', true, 'The Mill'), 'my-own');
  assert.equal(slugShown('', true, 'The Mill'), '');
});

test('a slug is well formed only in the contract\'s own pattern', () => {
  assert.equal(whySlugIsNotWellFormed('the-mill-2'), null);
  assert.notEqual(whySlugIsNotWellFormed(''), null);
  assert.notEqual(whySlugIsNotWellFormed('The-Mill'), null);
  assert.notEqual(whySlugIsNotWellFormed('the--mill'), null);
  assert.notEqual(whySlugIsNotWellFormed('-mill'), null);
  assert.notEqual(whySlugIsNotWellFormed('the mill'), null);
});

test('files over twenty megabytes together are refused, saying the size and the limit', () => {
  assert.equal(whyFilesAreTooLarge([LARGEST_IMPORT_BYTES]), null);
  const sentence = whyFilesAreTooLarge([LARGEST_IMPORT_BYTES, 1024 * 1024]);
  assert.equal(sentence, 'The files come to 21.0 MB together, and an import takes at most 20.0 MB.');
});

test('the import can start with one part matched and a well-formed slug, and not with none', () => {
  assert.equal(whyImportCannotStart(matchFilesToParts([file('log.md')]), 'the-mill'), null);
  assert.equal(whyImportCannotStart(matchFilesToParts([]), 'the-mill'), 'Pick at least one of the five files.');
  assert.equal(whyImportCannotStart(matchFilesToParts([file('readme.md')]), 'the-mill'), 'Pick at least one of the five files.');
  assert.match(whyImportCannotStart(matchFilesToParts([file('log.md')]), 'The Mill') ?? '', /lower case/);
});

test('the import cannot start while two files match one part, or while the files are too large', () => {
  assert.match(whyImportCannotStart(matchFilesToParts([file('log.md'), file('a-log.md'), file('state.md')]), 'the-mill') ?? '', /Pick only one/);
  assert.match(whyImportCannotStart(matchFilesToParts([file('log.md', LARGEST_IMPORT_BYTES), file('state.md', 2)]), 'the-mill') ?? '', /at most 20\.0 MB/);
});

test('the input sends every part, empty where no file was given, and leaves blank title and setting out', () => {
  const input = importRunInput({ slug: 'the-mill', title: '  ', setting: '', status: 'binding' }, { log: '# The Mill', cast: 'the baker' });
  assert.deepEqual(input, {
    slug: 'the-mill',
    status: 'binding',
    files: { log: '# The Mill', state: '', cast: 'the baker', items: '', places: '' },
  });
  assert.deepEqual(Object.keys(input.files ?? {}), [...IMPORT_PARTS]);
});

test('the input carries a title and a setting where given, trimmed, and the status chosen', () => {
  const input = importRunInput({ slug: 'the-mill', title: ' The Mill ', setting: ' by the ford ', status: 'telling' }, {});
  assert.equal(input.title, 'The Mill');
  assert.equal(input.setting, 'by the ford');
  assert.equal(input.status, 'telling');
});

test('every count an import answers with is said, in a fixed order', () => {
  const said = importCountsInWords({ scenes: 3, entries: 4, facts: 5, trailNotes: 6, rulings: 7, threads: 8, waypoints: 9, journeyLegs: 10, clocks: 11 });
  assert.deepEqual(said.map((each) => each.label), ['Scenes', 'Entries', 'Facts', 'Trail notes', 'Rulings', 'Threads', 'Waypoints', 'Journey legs', 'Clocks']);
  assert.deepEqual(said.map((each) => each.count), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('the lines not placed are counted in words', () => {
  assert.equal(unplacedInWords(0), 'Every line was placed.');
  assert.equal(unplacedInWords(1), '1 line could not be placed.');
  assert.equal(unplacedInWords(1200), '1,200 lines could not be placed.');
});
