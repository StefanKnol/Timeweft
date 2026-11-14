/**
 * The scene list of slice 5: its order, its finding by number, words, star, struck takes and
 * entries, what it keeps for the tab, and the entry picker's offer. Pure shaping, held here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EntryNoteRecord, EntryRecord, FactRecord, RunOutline, SceneOutline } from '@timeweft/contract';
import {
  FRESH_SCENE_LIST_STATE, NO_SCENE_LIST_FILTERS, SCENES_SHOWN_AT_A_TIME, entryPickerCountInWords, entryPickerOptions, excerptAroundMatch,
  hashOfScene, listOrderFromStored, normaliseForMatching, orderStorageKey, orderedForDrawing, sceneChipCounts, sceneCountInWords,
  sceneFromItemId, sceneItemIdOf, sceneListIsNarrowed, sceneListStateFromStored, sceneNotFoundInWords, sceneNumberFromText,
  sceneNumbersById, sceneSlotsMatchingFilters, scenesByNumber, scenesInvolvingEntry, scenesMatching, recordVersionOf, searchedFieldInWords, textSearchAppliesTo, textSearchFindsFor, textSearchInWords,
  titleOfRoute,
} from './shaping.ts';

// A made-up demo world: a ferry, a ford, a mill and its miller.

function scene(number: number, settings: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: `scene-${number}`, runId: 'run', number, title: `Crossing ${number}`, starred: false, whenTyped: 'dawn',
    placeEntryId: null, summary: 'The ferry crosses.', recordWords: 10, steer: '', situationAfter: '', status: 'standing',
    readings: [], createdAt: `2026-01-01T00:00:00.${String(number).padStart(3, '0')}Z`, ...settings,
  };
}

function entry(id: string, name: string, settings: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id, runId: 'run', kind: 'person', name, alsoKnownAs: [], pronoun: '', introducedInSceneId: null, source: 'story',
    visibility: 'open', createdAt: '2026-01-01T00:00:00Z', ...settings,
  };
}

function fact(id: string, entryId: string, fromSceneId: string, aboutEntryId: string | null = null): FactRecord {
  return { id, entryId, property: 'where', value: 'at the ford', aboutEntryId, fromSceneId, untilSceneId: null, source: 'story', visibility: 'open', note: '', createdAt: '2026-01-01T00:00:00Z' };
}

function note(id: string, entryId: string, sceneId: string): EntryNoteRecord {
  return { id, entryId, sceneId, text: 'Crossed at night.', visibility: 'open', createdAt: '2026-01-01T00:00:00Z' };
}

function snapshotOf(scenes: SceneOutline[], parts: Partial<RunOutline> = {}): RunOutline {
  return {
    run: { id: 'run', slug: 'the-ferry', title: 'The ferry', setting: 'A river', status: 'binding', continuesRunId: null, register: 'plain', createdAt: '2026-01-01T00:00:00Z' },
    clocks: [], scenes, entries: [], facts: [], notes: [], rulings: [], threads: [], waypoints: [], legs: [], collisions: [],
    runEdits: [], entryEdits: [], waypointRewordings: [], sceneEdits: [], ...parts,
  };
}

const longRun = Array.from({ length: 420 }, (_, index) => scene(index + 1, { starred: (index + 1) % 25 === 0 }));

test('a long list is drawn newest first by default, with Show older at the foot', () => {
  const drawn = orderedForDrawing(scenesByNumber(longRun), 'newest-first', SCENES_SHOWN_AT_A_TIME, SCENES_SHOWN_AT_A_TIME);
  assert.equal(drawn.shown.length, 50);
  assert.equal(drawn.shown[0]?.number, 420);
  assert.equal(drawn.shown[49]?.number, 371);
  assert.equal(drawn.olderNotShown, 370);
  assert.equal(drawn.showOlderWouldAdd, 50);
  assert.equal(drawn.showOlderAt, 'foot');
});

test('oldest first draws the same newest scenes in number order, with Show older at the top', () => {
  const drawn = orderedForDrawing(scenesByNumber(longRun), 'oldest-first', SCENES_SHOWN_AT_A_TIME, SCENES_SHOWN_AT_A_TIME);
  assert.deepEqual(drawn.shown.map((slot) => slot.number), Array.from({ length: 50 }, (_, index) => 371 + index));
  assert.equal(drawn.showOlderAt, 'top');
});

test('Show older counts at 0, 50 and 420 drawn', () => {
  const slots = scenesByNumber(longRun);
  const atNone = orderedForDrawing(slots, 'newest-first', 0, SCENES_SHOWN_AT_A_TIME);
  assert.deepEqual([atNone.shown.length, atNone.olderNotShown, atNone.showOlderWouldAdd], [0, 420, 50]);
  const atFifty = orderedForDrawing(slots, 'newest-first', 50, SCENES_SHOWN_AT_A_TIME);
  assert.deepEqual([atFifty.shown.length, atFifty.olderNotShown, atFifty.showOlderWouldAdd], [50, 370, 50]);
  const atAll = orderedForDrawing(slots, 'oldest-first', 420, SCENES_SHOWN_AT_A_TIME);
  assert.deepEqual([atAll.shown.length, atAll.olderNotShown, atAll.showOlderWouldAdd], [420, 0, 0]);
  const nearlyAll = orderedForDrawing(slots, 'newest-first', 400, SCENES_SHOWN_AT_A_TIME);
  assert.equal(nearlyAll.showOlderWouldAdd, 20);
});

test('the order read back from storage is newest first unless it says oldest first', () => {
  assert.equal(listOrderFromStored(null), 'newest-first');
  assert.equal(listOrderFromStored('oldest-first'), 'oldest-first');
  assert.equal(listOrderFromStored('newest-first'), 'newest-first');
  assert.equal(listOrderFromStored('sideways'), 'newest-first');
  assert.equal(orderStorageKey('scenes'), 'timeweft.order.scenes');
});

test('a scene address is read by number for the standing take and by id for any take', () => {
  const struckFirst = scene(31, { id: 'struck-31', status: 'struck', createdAt: '2026-01-01T00:00:01Z' });
  const standing = scene(31, { id: 'standing-31', createdAt: '2026-01-01T00:00:02Z' });
  const allStruck = [scene(40, { id: 'struck-40-a', status: 'struck', createdAt: '2026-01-01T00:00:03Z' }), scene(40, { id: 'struck-40-b', status: 'struck', createdAt: '2026-01-01T00:00:04Z' })];
  const scenes = [struckFirst, standing, ...allStruck];

  assert.deepEqual(sceneFromItemId(scenes, '31'), { found: 'take', scene: standing });
  assert.deepEqual(sceneFromItemId(scenes, 'struck-31'), { found: 'take', scene: struckFirst });
  const atForty = sceneFromItemId(scenes, '40');
  assert.equal(atForty.found, 'every-take-struck');
  if (atForty.found === 'every-take-struck') assert.deepEqual(atForty.struck.map((take) => take.id), ['struck-40-a', 'struck-40-b']);
  assert.deepEqual(sceneFromItemId(scenes, '900'), { found: 'no-such-number', number: 900 });
  assert.deepEqual(sceneFromItemId(scenes, 'no-such-take'), { found: 'no-such-id' });

  assert.equal(sceneNotFoundInWords({ found: 'every-take-struck', number: 40, struck: allStruck }), 'Every take of scene 40 was struck.');
  assert.equal(sceneNotFoundInWords({ found: 'no-such-number', number: 900 }), 'This run has no scene 900.');
  assert.equal(sceneNotFoundInWords({ found: 'no-such-id' }), 'This run holds no scene with that id.');

  assert.equal(sceneItemIdOf(standing), '31');
  assert.equal(sceneItemIdOf(struckFirst), 'struck-31');
  assert.equal(hashOfScene('the-ferry', standing), '#/runs/the-ferry/scenes/31');
  assert.equal(hashOfScene('the-ferry', struckFirst), '#/runs/the-ferry/scenes/struck-31');
});

test('the tab names a scene reached by its number', () => {
  const snapshot = snapshotOf([scene(1), scene(2, { title: 'At the ford' })]);
  assert.equal(titleOfRoute({ page: 'run', slug: 'the-ferry', section: 'scenes', itemId: '2' }, snapshot), '2. At the ford · Scenes · The ferry');
});

test('matching ignores case and accents, and finds a scene by its number', () => {
  const scenes = [
    scene(1, { title: 'The Café by the Ford' }),
    scene(2, { summary: 'The miller pays the toll.' }),
    scene(3, { steer: 'Slow the crossing.' }),
    scene(4, { situationAfter: 'The ferry is moored at NIGHTFALL.' }),
    scene(12, { whenTyped: 'the third évening' }),
  ];
  const slots = scenesByNumber(scenes);
  const numbersFor = (typed: string) => scenesMatching(slots, typed).map((slot) => slot.number);
  assert.equal(normaliseForMatching('  Café   AU  lait '), 'cafe au lait');
  assert.deepEqual(numbersFor('cafe'), [1]);
  assert.deepEqual(numbersFor('CAFÉ'), [1]);
  assert.deepEqual(numbersFor('Miller'), [2]);
  assert.deepEqual(numbersFor('slow the'), [3]);
  assert.deepEqual(numbersFor('nightfall'), [4]);
  assert.deepEqual(numbersFor('Evening'), [12]);
  assert.deepEqual(numbersFor('12'), [12]);
  assert.deepEqual(numbersFor(''), [1, 2, 3, 4, 12]);
});

test('a struck take counts for its number when matching', () => {
  const slots = scenesByNumber([
    scene(7, { id: 'struck-7', status: 'struck', title: 'The first wording of the flood', createdAt: '2026-01-01T00:00:01Z' }),
    scene(7, { id: 'standing-7', title: 'The flood', createdAt: '2026-01-01T00:00:02Z' }),
  ]);
  assert.deepEqual(scenesMatching(slots, 'first wording').map((slot) => slot.number), [7]);
});

test('"With" finds a scene by its place, by first naming the entry, by a note and by a fact', () => {
  const scenes = [
    scene(1, { placeEntryId: 'ford' }),
    scene(2),
    scene(3),
    scene(4),
    scene(5),
  ];
  const snapshot = snapshotOf(scenes, {
    entries: [entry('ford', 'the ford', { kind: 'place' }), entry('miller', 'the miller', { introducedInSceneId: 'scene-2' }), entry('ferryman', 'the ferryman')],
    notes: [note('n', 'miller', 'scene-3')],
    facts: [fact('f-by', 'ferryman', 'scene-4'), fact('f-about', 'ferryman', 'scene-5', 'miller')],
  });
  const index = scenesInvolvingEntry(snapshot);
  assert.deepEqual([...(index.get('ford')?.get('scene-1') ?? [])], ['place']);
  assert.deepEqual([...(index.get('miller')?.get('scene-2') ?? [])], ['introduced']);
  assert.deepEqual([...(index.get('miller')?.get('scene-3') ?? [])], ['note']);
  assert.deepEqual([...(index.get('ferryman')?.get('scene-4') ?? [])], ['fact']);
  assert.deepEqual([...(index.get('miller')?.get('scene-5') ?? [])], ['fact']);

  const slots = scenesByNumber(scenes);
  const numbersWith = (withEntryIds: string[]) => sceneSlotsMatchingFilters(slots, { ...NO_SCENE_LIST_FILTERS, withEntryIds }, index).map((slot) => slot.number);
  assert.deepEqual(numbersWith(['miller']), [2, 3, 5]);
  assert.deepEqual(numbersWith(['ford']), [1]);
  // With more than one, a scene must be with every one.
  assert.deepEqual(numbersWith(['miller', 'ferryman']), [5]);
  assert.deepEqual(numbersWith(['ford', 'miller']), []);
});

test('the chips narrow to starred scenes and to numbers with struck takes, and say how many', () => {
  const scenes = [
    scene(1, { starred: true }),
    scene(2, { id: 'struck-2', status: 'struck', createdAt: '2026-01-01T00:00:01Z', starred: true }),
    scene(2, { id: 'standing-2', createdAt: '2026-01-01T00:00:02Z' }),
    scene(3, { starred: true }),
  ];
  const slots = scenesByNumber(scenes);
  // A starred struck take does not count: the star belongs to the take that stands.
  assert.deepEqual(sceneChipCounts(slots), { starred: 2, withStruckTakes: 1 });
  assert.deepEqual(sceneChipCounts(scenesByNumber(longRun)), { starred: 16, withStruckTakes: 0 });
  const index = scenesInvolvingEntry(snapshotOf(scenes));
  assert.deepEqual(sceneSlotsMatchingFilters(slots, { ...NO_SCENE_LIST_FILTERS, starredOnly: true }, index).map((slot) => slot.number), [1, 3]);
  assert.deepEqual(sceneSlotsMatchingFilters(slots, { ...NO_SCENE_LIST_FILTERS, withStruckTakesOnly: true }, index).map((slot) => slot.number), [2]);
});

test('a take found in the scenes\' text matches its number, but only for the words it was asked', () => {
  const slots = scenesByNumber([scene(1), scene(2), scene(3)]);
  const index = scenesInvolvingEntry(snapshotOf([]));
  const filters = { ...NO_SCENE_LIST_FILTERS, searchText: 'lantern oil' };
  assert.deepEqual(sceneSlotsMatchingFilters(slots, filters, index).map((slot) => slot.number), []);
  assert.deepEqual(sceneSlotsMatchingFilters(slots, filters, index, new Set(['scene-2'])).map((slot) => slot.number), [2]);

  const textSearch = { text: 'Lantern Oil', total: 1, scenesMatched: 1, matches: [{ sceneId: 'scene-2', number: 2, status: 'standing' as const, title: 'Crossing 2', field: 'record' as const, excerpt: 'filled with lantern oil.', matchStart: 12, matchLength: 11 }] };
  assert.equal(textSearchAppliesTo({ searchText: 'lantern oil', textSearch }), true);
  assert.deepEqual([...textSearchFindsFor({ searchText: 'lantern oil', textSearch }).keys()], ['scene-2']);
  assert.equal(textSearchAppliesTo({ searchText: 'lantern', textSearch }), false);
  assert.equal(textSearchFindsFor({ searchText: 'lantern', textSearch }).size, 0);
  assert.deepEqual(excerptAroundMatch(textSearch.matches[0]!), { before: 'filled with ', matched: 'lantern oil', after: '.' });
});

test('the count says how many match, or how many are drawn', () => {
  assert.equal(sceneCountInWords(420, 420, 50, false), 'The newest 50 of 420 scenes');
  assert.equal(sceneCountInWords(420, 420, 420, false), '420 scenes');
  assert.equal(sceneCountInWords(420, 12, 12, true), '12 of 420 scenes match');
  assert.equal(sceneCountInWords(420, 1, 1, true), '1 of 420 scenes matches');
  assert.equal(sceneCountInWords(1, 1, 1, false), '1 scene');
  assert.equal(sceneListIsNarrowed(NO_SCENE_LIST_FILTERS), false);
  assert.equal(sceneListIsNarrowed({ ...NO_SCENE_LIST_FILTERS, searchText: '   ' }), false);
  assert.equal(sceneListIsNarrowed({ ...NO_SCENE_LIST_FILTERS, withEntryIds: ['miller'] }), true);
});

test('what the list keeps for the tab is read back with care', () => {
  assert.deepEqual(sceneListStateFromStored(null), FRESH_SCENE_LIST_STATE);
  assert.deepEqual(sceneListStateFromStored('not an object'), FRESH_SCENE_LIST_STATE);
  const kept = sceneListStateFromStored({ searchText: 'ford', starredOnly: true, withStruckTakesOnly: 'yes', withEntryIds: ['miller', 3], shownCount: 150, openStruckNumbers: [31], textSearch: { text: 'ford' }, returnToNumber: 388 });
  assert.equal(kept.searchText, 'ford');
  assert.equal(kept.starredOnly, true);
  assert.equal(kept.withStruckTakesOnly, false);
  assert.deepEqual(kept.withEntryIds, []);
  assert.equal(kept.shownCount, 150);
  assert.deepEqual(kept.openStruckNumbers, [31]);
  assert.equal(kept.textSearch, null);
  assert.equal(kept.returnToNumber, 388);
  assert.equal(sceneListStateFromStored({ shownCount: 3 }).shownCount, SCENES_SHOWN_AT_A_TIME);
  // A search kept before the scenes were counted apart from the takes is dropped, not miscounted.
  assert.equal(sceneListStateFromStored({ textSearch: { text: 'ford', matches: [], total: 2 } }).textSearch, null);
  assert.deepEqual(sceneListStateFromStored({ textSearch: { text: 'ford', matches: [], total: 2, scenesMatched: 1 } }).textSearch, { text: 'ford', matches: [], total: 2, scenesMatched: 1 });
});

test('a number typed into "Go to scene" is a whole number from 1', () => {
  assert.deepEqual(sceneNumberFromText(' 388 '), { ok: true, number: 388 });
  assert.equal(sceneNumberFromText('').ok, false);
  assert.equal(sceneNumberFromText('0').ok, false);
  assert.equal(sceneNumberFromText('3.5').ok, false);
  assert.equal(sceneNumberFromText('the ford').ok, false);
});

test('the entry picker offers two entries that share a name apart, by id, each told apart', () => {
  const scenes = [scene(3), scene(14)];
  const entries = [
    entry('miller-young', 'Corin the miller', { introducedInSceneId: 'scene-14' }),
    entry('miller-old', 'Corin the miller', { introducedInSceneId: 'scene-3' }),
    entry('mill', 'the mill', { kind: 'place' }),
  ];
  const offer = entryPickerOptions(entries, 'corin', sceneNumbersById(scenes));
  assert.deepEqual(offer.options.map((option) => option.entryId), ['miller-old', 'miller-young']);
  assert.deepEqual(offer.options.map((option) => option.toldApart), ['a person, first named at scene 3', 'a person, first named at scene 14']);
  assert.equal(offer.matchingCount, 2);
  // Picking one leaves the other on offer.
  assert.deepEqual(entryPickerOptions(entries, 'corin', sceneNumbersById(scenes), { pickedIds: ['miller-old'] }).options.map((option) => option.entryId), ['miller-young']);
});

test('the entry picker matches other names, ranks names that begin with the text first, and says what it leaves out', () => {
  const entries = [
    entry('ferry', 'the ferry', { kind: 'place' }),
    entry('ferryman', 'Ferryman Oswin'),
    entry('boat', 'the old boat', { kind: 'item', alsoKnownAs: ['the ferry boat'] }),
    entry('secret', 'the ferry’s hidden cellar', { kind: 'place', visibility: 'author-only' }),
  ];
  const offer = entryPickerOptions(entries, 'FERRY', new Map());
  assert.deepEqual(offer.options.map((option) => option.entryId), ['ferryman', 'ferry', 'secret', 'boat']);
  assert.equal(offer.options.find((option) => option.entryId === 'boat')?.matchedOtherName, 'the ferry boat');
  assert.equal(offer.options.find((option) => option.entryId === 'secret')?.isAuthorOnly, true);
  assert.equal(offer.authorOnlyLeftOut, 0);

  const withoutAuthorOnly = entryPickerOptions(entries, 'ferry', new Map(), { leaveOutAuthorOnly: true });
  assert.equal(withoutAuthorOnly.options.some((option) => option.entryId === 'secret'), false);
  assert.equal(withoutAuthorOnly.authorOnlyLeftOut, 1);

  const limited = entryPickerOptions(entries, '', new Map(), { limit: 2 });
  assert.equal(limited.options.length, 2);
  assert.equal(limited.moreNotOffered, 2);
  assert.equal(entryPickerCountInWords(limited), '4 entries match. The first 2 are listed; type more to narrow them.');
  assert.equal(entryPickerCountInWords(entryPickerOptions(entries, 'oswin', new Map())), '1 entry matches.');
  assert.equal(entryPickerCountInWords(entryPickerOptions(entries, 'weir', new Map())), 'No entry matches.');
});

function findIn(sceneId: string, number: number, status: 'standing' | 'struck' = 'standing') {
  return { sceneId, number, status, title: `Crossing ${number}`, field: 'record' as const, excerpt: 'lantern oil', matchStart: 0, matchLength: 11 };
}

test('the text search line counts scenes, not takes, so a scene found in two takes counts once', () => {
  // Scene 7 holds the words in its standing take and in a struck one.
  const twoTakesOfOneScene = { matches: [findIn('take-7b', 7), findIn('take-7a', 7, 'struck')], total: 2, scenesMatched: 1 };
  assert.equal(textSearchInWords(twoTakesOfOneScene), 'The scenes’ text was searched too: 1 scene holds the words.');
  assert.equal(textSearchInWords({ matches: [], total: 0, scenesMatched: 0 }), 'The scenes’ text was searched too; no scene holds the words.');
  // Past the limit, the note counts the scenes among the takes listed.
  const pastTheLimit = { matches: [findIn('take-9', 9), findIn('take-8b', 8), findIn('take-8a', 8, 'struck')], total: 5, scenesMatched: 4 };
  assert.equal(textSearchInWords(pastTheLimit), 'The scenes’ text was searched too: 4 scenes hold the words. Only the newest 2 of them are counted here.');
  assert.equal(textSearchInWords({ matches: [findIn('take-9', 9)], total: 3, scenesMatched: 3 }), 'The scenes’ text was searched too: 3 scenes hold the words. Only the newest 1 of them is counted here.');
});

test('each searched field reads as a whole phrase after "In"', () => {
  assert.deepEqual(
    (['title', 'summary', 'record', 'steer', 'situationAfter'] as const).map((field) => `In ${searchedFieldInWords(field)}:`),
    ['In the title:', 'In the summary:', 'In the scene:', 'In the steer:', 'In where things stood after it:'],
  );
});

test("a take's record version is its newest record edit, so an edited record is fetched again", () => {
  const edits = [
    { id: 'edit-1', sceneId: 'take-200', field: 'record' as const },
    { id: 'edit-2', sceneId: 'take-200', field: 'title' as const },
    { id: 'edit-3', sceneId: 'take-201', field: 'record' as const },
    { id: 'edit-4', sceneId: 'take-200', field: 'record' as const },
  ];
  assert.equal(recordVersionOf('take-200', edits), 'edit-4');
  assert.equal(recordVersionOf('take-200', edits.slice(0, 3)), 'edit-1');
  assert.equal(recordVersionOf('take-202', edits), '', 'a record never changed has no version');
  assert.notEqual(recordVersionOf('take-200', edits.slice(0, 1)), recordVersionOf('take-200', edits), 'an edit gives a new version');
});
