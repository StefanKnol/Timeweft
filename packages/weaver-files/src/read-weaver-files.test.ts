import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readWeaverFiles, safely } from './index.ts';
import { demoFiles, demoLog } from './demo-fixtures.ts';
import { summaryOf, readingsOfWhen, SUMMARY_LIMIT_CHARACTERS } from './read-log.ts';
import { castHeadingNamesAGroup, durationOfLegText, readEntryHeading } from './read-entries.ts';
import { topicsOf, sceneOfRulingPrefix } from './read-state.ts';
import { splitStackedHistory, presentOf } from './text-helpers.ts';
import type { ImportedEntry, WeaverFiles } from '@timeweft/contract';

const run = readWeaverFiles(demoFiles, { slug: 'wet-season' });

function entryNamed(name: string): ImportedEntry {
  const entry = run.entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `no entry named ${name}`);
  return entry;
}

function factsOf(entry: ImportedEntry, property: string) {
  return entry.facts.filter((fact) => fact.property === property);
}

test('the run takes its slug and defaults, and its title from the log heading', () => {
  assert.equal(run.slug, 'wet-season');
  assert.equal(run.title, 'The Wet Season');
  assert.equal(run.status, 'binding');
  assert.equal(run.setting, '');
  const given = readWeaverFiles(demoFiles, { slug: 'x', title: 'Given', setting: 'A valley', status: 'telling' });
  assert.equal(given.title, 'Given');
  assert.equal(given.setting, 'A valley');
  assert.equal(given.status, 'telling');
});

test('scenes are read with titles on the heading or on the line after it, and stars', () => {
  assert.deepEqual(run.scenes.map((scene) => scene.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(run.scenes.map((scene) => scene.title), ['Flour at dusk', 'The ferry crossing', 'The flood', 'Flooded', 'The lantern relit']);
  assert.deepEqual(run.scenes.map((scene) => scene.starred), [true, true, false, false, true]);
});

test('the When line is kept whole', () => {
  assert.equal(run.scenes[0]?.whenTyped, 'Mill Day 3 (flood day +5) · the mill yard · dusk · [run begins]');
});

test('readings come off the clocks state.md defines, exactly', () => {
  assert.deepEqual(run.clocks.map((clock) => clock.name), ['Mill clock', 'flood reckoning']);
  assert.deepEqual(run.scenes[0]?.readings, [
    { clock: 'Mill clock', count: '3', partOfDay: '' },
    { clock: 'flood reckoning', count: '5', partOfDay: '' },
  ]);
  assert.deepEqual(run.scenes[1]?.readings, [
    { clock: 'Mill clock', count: '4', partOfDay: 'night' },
    { clock: 'flood reckoning', count: '6', partOfDay: 'night' },
  ]);
});

test('a span or an event-relative word gives no readings, never a guess', () => {
  assert.deepEqual(run.scenes[2]?.readings, []);
  assert.deepEqual(run.scenes[3]?.readings, []);
  assert.equal(run.scenes[2]?.whenTyped.startsWith('Mill Day 4 night to Mill Day 5'), true);
});

test('with no clocks defined, nothing is read', () => {
  assert.deepEqual(readingsOfWhen('Mill Day 3 (flood day +5)', []), []);
});

test('a clock appearing twice in one When is not read', () => {
  const clocks = [{ name: 'Mill clock', countsFrom: '', form: 'named' as const, prefixWords: ['Mill'] }];
  assert.deepEqual(readingsOfWhen('Mill Day 3 and Mill Day 4', clocks), []);
});

test('the summary is the first paragraph, the record the whole body', () => {
  const first = run.scenes[0];
  assert.equal(first?.summary, 'The miller grinds the last of the barley. She hears the river rising.');
  assert.match(first?.record ?? '', /A second paragraph/);
  assert.match(first?.record ?? '', /> - Line: Ada: "Not tonight\."/);
  assert.match(run.scenes[2]?.record ?? '', /a line after the block/);
});

test('a long summary is cut back to the whole sentences that fit', () => {
  const third = run.scenes[2];
  assert.ok((third?.summary.length ?? 0) <= SUMMARY_LIMIT_CHARACTERS);
  assert.match(third?.summary ?? '', /\.$/);
  assert.ok((third?.record.length ?? 0) > (third?.summary.length ?? 0));
  assert.ok(third?.record.includes(third.summary.slice(0, 80)));
});

test('a first sentence longer than the limit is cut at a word and marked', () => {
  const summary = summaryOf('word '.repeat(300));
  assert.ok(summary.length <= SUMMARY_LIMIT_CHARACTERS + 4);
  assert.match(summary, / \.\.\.$/);
});

test('a movement heading is carried in the record of the first scene under it', () => {
  assert.match(run.scenes[0]?.record ?? '', /^Movement: Movement I - The Ford/);
  assert.match(run.scenes[4]?.record ?? '', /^Movement: Movement II - The Lantern/);
  assert.doesNotMatch(run.scenes[1]?.record ?? '', /^Movement:/);
});

test('the place is the known place the Where line names', () => {
  assert.equal(run.scenes[0]?.place, 'The Old Ford');
  assert.equal(run.scenes[2]?.place, 'The Mill');
  assert.equal(run.scenes[1]?.place, null);
});

test('only the present situation reaches the last scene, and the stacked rest is counted', () => {
  const situation = run.scenes[4]?.situationAfter ?? '';
  assert.match(situation, /Current: Mill Day 9 \(flood reckoning day \+11\), evening, the mill kitchen\./);
  assert.match(situation, /The miller sits up with the lantern \(Scene 5\)\./);
  assert.match(situation, /Run began: the eve of the flood/);
  assert.doesNotMatch(situation, /long wait in the rain|paid the toll|waited out/);
  for (const scene of run.scenes.slice(0, 4)) assert.equal(scene.situationAfter, '');
  const report = run.unplaced.filter((line) => /bytes of stacked history/.test(line));
  assert.equal(report.length, 1);
  const stacked = ' Before that, Mill Day 8 at the ford, a long wait in the rain.'.trim().length
    + 'Earlier: she crossed the ford and paid the toll. Earlier: she waited out the rain.'.length;
  assert.match(report[0] ?? '', new RegExp(`: ${stacked} bytes`));
});

test('presentOf cuts at the first history marker only at a sentence start', () => {
  assert.deepEqual(presentOf('Now here. Before that, there.'), { present: 'Now here.', stackedBytes: 'Before that, there.'.length });
  assert.equal(presentOf('He came before dawn.').stackedBytes, 0);
});

test('standing rulings are verbatim, one per bullet, with source and scene', () => {
  const standing = run.rulings.filter((ruling) => ruling.scope === 'run');
  assert.equal(standing.length, 6);
  assert.equal(standing[0]?.text, '"The ferry never runs at night."');
  assert.deepEqual(standing.map((ruling) => ruling.source), ['author', 'author', 'story', 'author', 'author', 'author']);
  assert.deepEqual(standing.map((ruling) => ruling.scene), [null, 2, 3, null, 4, 3]);
});

test('ruling topics come from the keyword rules, and none is a valid answer', () => {
  const standing = run.rulings.filter((ruling) => ruling.scope === 'run');
  assert.deepEqual(standing[1]?.topics, ['narration']);
  assert.deepEqual(standing[3]?.topics, ['time']);
  assert.deepEqual(standing[4]?.topics, ['point of view']);
  assert.deepEqual(standing[5]?.topics, ['naming']);
  assert.deepEqual(topicsOf('the lantern is brass'), []);
});

test('rulings say which known entries they are about', () => {
  const standing = run.rulings.filter((ruling) => ruling.scope === 'run');
  assert.deepEqual(standing[5]?.about, ['Oren Vale']);
});

test('the scene prefix of a ruling: after and ranges give a scene, before gives none', () => {
  assert.equal(sceneOfRulingPrefix('Scene 7, author direction'), 7);
  assert.equal(sceneOfRulingPrefix('After Scene 7, author ruling'), 7);
  assert.equal(sceneOfRulingPrefix('Scenes 5-7, author direction'), 7);
  assert.equal(sceneOfRulingPrefix('Before Scene 7, author ruling'), null);
  assert.equal(sceneOfRulingPrefix('story side'), null);
});

test('coined canon is world rulings, sourced by their own label, topic coined', () => {
  const coined = run.rulings.filter((ruling) => ruling.scope === 'world');
  assert.equal(coined.length, 4);
  assert.deepEqual(coined.map((ruling) => ruling.source), ['story', 'author', 'story', 'story']);
  assert.ok(coined.every((ruling) => ruling.topics[0] === 'coined'));
  assert.deepEqual(coined.map((ruling) => ruling.scene), [2, null, 4, 5]);
});

test('threads: one per bullet, opened scene from the parenthesis, closed only where marked', () => {
  assert.equal(run.threads.length, 3);
  assert.deepEqual(run.threads.map((thread) => thread.openedInScene), [2, null, 4]);
  assert.deepEqual(run.threads.map((thread) => thread.closed), [false, false, true]);
  assert.match(run.threads[2]?.resolution ?? '', /^The toll dispute/);
  assert.deepEqual(run.threads[1]?.about, ['The Brass Lantern']);
});

test('waypoints: one per bullet, reached only where marked', () => {
  assert.deepEqual(run.waypoints, [
    { text: '(Author, Scene 3) A night crossing of the ford.', reached: false },
    { text: 'REACHED: The lantern is relit.', reached: true },
  ]);
});

test('entry headings give the name, the pronoun, later names and asides', () => {
  const ada = entryNamed('Ada Brook');
  assert.equal(ada.kind, 'person');
  assert.equal(ada.pronoun, 'she');
  assert.deepEqual(ada.alsoKnownAs, ['the Miller']);
  const oren = entryNamed('Oren Vale');
  assert.deepEqual(factsOf(oren, 'aside').map((fact) => fact.value), ['the ferryman']);
  assert.deepEqual(readEntryHeading('Brin (he) (the oldest) (later Old Brin)'), {
    name: 'Brin', pronoun: 'he', alsoKnownAs: ['Old Brin'], asides: ['the oldest'],
  });
});

test('cast kinds: a plural or "the people of" is a group, else a person', () => {
  assert.equal(entryNamed('The Ford Wardens').kind, 'group');
  assert.equal(entryNamed('The people of the bend').kind, 'group');
  assert.equal(castHeadingNamesAGroup('Ada Brook'), false);
  assert.equal(castHeadingNamesAGroup('The Miller'), false);
  assert.equal(entryNamed('The Brass Lantern').kind, 'item');
  assert.equal(entryNamed('The Old Ford').kind, 'place');
});

test('a labelled bullet is a fact under its lower-cased label', () => {
  const ada = entryNamed('Ada Brook');
  assert.deepEqual(factsOf(ada, 'voice').map((fact) => fact.value), ['short and dry.']);
  assert.deepEqual(factsOf(ada, 'last seen').map((fact) => [fact.value, fact.fromScene]), [['Scene 5, in the mill kitchen', 5]]);
});

test('stacked history in a fact is split oldest first, each with its scene', () => {
  const standing = factsOf(entryNamed('Ada Brook'), 'standing');
  assert.deepEqual(standing.map((fact) => [fact.value, fact.fromScene]), [
    ['a stranger to him.', null],
    ['wary of him (Scenes 1-2).', 2],
    ['trusts the ferryman now (Scene 4).', 4],
  ]);
  const where = factsOf(entryNamed('The Brass Lantern'), 'where');
  assert.deepEqual(where.map((fact) => fact.fromScene), [null, 2, 5]);
  assert.deepEqual(splitStackedHistory('only now'), ['only now']);
});

test('a stamp in the label goes to the note; anything else stays in the property', () => {
  const ada = entryNamed('Ada Brook');
  assert.deepEqual(factsOf(ada, 'state').map((fact) => fact.note), ['day +6, night']);
  assert.equal(factsOf(ada, 'who (as the ferryman knows her)').length, 1);
  assert.equal(factsOf(ada, 'who').length, 1);
  const pair = factsOf(ada, 'pair');
  assert.deepEqual(pair.map((fact) => [fact.source, fact.fromScene]), [['author', 3]]);
});

test('trail notes keep their scene, a range under its last scene with the range kept', () => {
  const ada = entryNamed('Ada Brook');
  assert.deepEqual(ada.trail, [
    { scene: 1, text: 'grinds flour at dusk.' },
    { scene: 2, text: '(day +6) crosses on the ferry.' },
    { scene: 4, text: '(Scene 3-4) keeps the lantern\nburning through the flood.' },
  ]);
  assert.deepEqual(entryNamed('The Brass Lantern').trail, [{ scene: 4, text: 'relit at the ford.' }]);
  assert.equal(ada.introducedInScene, 1);
});

test('a plain "Name: text" bullet in a group is a fact, an unlabelled one with a scene a trail note', () => {
  const wardens = entryNamed('The Ford Wardens');
  assert.deepEqual(factsOf(wardens, 'brin (he)').map((fact) => fact.value), ['the oldest warden.']);
  assert.deepEqual(wardens.trail.map((note) => note.scene), [3]);
});

test('legs: bullets and table rows, duration from the stated span, scene from the parenthesis', () => {
  assert.deepEqual(run.legs, [
    { from: 'The Mill', to: 'the village', duration: 'two days', note: 'cart', scene: 3 },
    { from: 'The Mill', to: 'the Old Ford', duration: 'half a day on foot.', note: 'half a day on foot.', scene: null },
    { from: 'The Old Ford', to: 'the far bank', duration: 'an hour on the rope', note: 'by ferry; a slow start; an hour on the rope; calm water.', scene: 2 },
  ]);
  assert.equal(durationOfLegText('cold; three nights by cart'), 'three nights by cart');
});

test('run-specific state becomes facts on the entry it names, or a new person', () => {
  const ada = entryNamed('Ada Brook');
  assert.deepEqual(factsOf(ada, 'run state').map((fact) => [fact.value, fact.fromScene]), [
    ['rested (Scene 1).', 1], ['worn out from the crossing.', null],
  ]);
  assert.equal(entryNamed('Tomas').kind, 'person');
});

test('everything not placed is said, by file, line and reason', () => {
  const reasons = run.unplaced;
  assert.ok(reasons.some((line) => /^state\.md line \d+: a run-specific state line/.test(line)));
  assert.ok(reasons.some((line) => /^state\.md lines \d+-\d+: the 2 lines of the names list/.test(line)));
  assert.ok(reasons.some((line) => /^state\.md line \d+: a line in a section whose heading the reader does not know/.test(line)));
  assert.ok(reasons.some((line) => /^cast\.md line \d+: a bullet with neither a label nor a scene number/.test(line)));
  assert.ok(reasons.some((line) => /^places\.md line \d+: a line among the legs/.test(line)));
  assert.ok(reasons.some((line) => /^places\.md line \d+: a bullet among the legs that does not read/.test(line)));
  assert.equal(reasons.length, 7);
});

test('empty files yield nothing and say nothing', () => {
  const empty = readWeaverFiles({ log: '', state: '', cast: '', items: '', places: '' }, { slug: 'empty' });
  assert.deepEqual([empty.scenes, empty.entries, empty.rulings, empty.threads, empty.waypoints, empty.legs, empty.clocks, empty.unplaced], [[], [], [], [], [], [], [], []]);
});

test('the reader never throws on truncated input, cut at every 97th byte', () => {
  const keys = Object.keys(demoFiles) as Array<keyof WeaverFiles>;
  for (const key of keys) {
    const bytes = new TextEncoder().encode(demoFiles[key]);
    for (let length = 0; length <= bytes.length; length += 97) {
      const truncated = new TextDecoder().decode(bytes.slice(0, length));
      assert.doesNotThrow(() => readWeaverFiles({ ...demoFiles, [key]: truncated }, { slug: 'cut' }), `${key} cut at ${length}`);
      assert.doesNotThrow(() => readWeaverFiles({ log: truncated, state: truncated, cast: truncated, items: truncated, places: truncated }, { slug: 'cut' }));
    }
  }
});

test('a fault inside one file\'s reader is reported against that file, never thrown', () => {
  const unplaced: string[] = [];
  const answer = safely('cast.md', (): number => {
    throw new Error('broken');
  }, 0, unplaced);
  assert.equal(answer, 0);
  assert.deepEqual(unplaced, ['cast.md: the reader could not read this file and carried nothing from it (broken).']);
});

test('the reader never throws on garbage', () => {
  const garbage = ['((((', '## Scene', '## Scene x\n**When:**', '- **', '- ( Scene 9', '## Clock\n- Current: Before that,', '| a | b', '\u0000￿', '# \n## \n- :', 'Scenes 1-'.repeat(50)];
  for (const text of garbage) {
    assert.doesNotThrow(() => readWeaverFiles({ log: text, state: text, cast: text, items: text, places: text }, { slug: 'garbage' }));
  }
});

test('the count of scenes read equals the count of "## Scene" headings', () => {
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const shapes = ['## Scene N: A title ★', '## Scene N', '## Scene', '## Scene N - A title', '## Scene 2: a repeat', '# Movement X', 'prose line', '> - Where: the Mill', '', '**When:** Mill Day N'];
  for (let trial = 0; trial < 200; trial += 1) {
    const lines: string[] = [];
    const count = next() % 40;
    for (let index = 0; index < count; index += 1) lines.push((shapes[next() % shapes.length] ?? '').replace('N', String(next() % 30)));
    const log = lines.join('\n');
    const headings = log.match(/^## Scene\b/gm)?.length ?? 0;
    const read = readWeaverFiles({ ...demoFiles, log }, { slug: 'count' });
    assert.equal(read.scenes.length, headings, log);
  }
  assert.equal(run.scenes.length, demoLog.match(/^## Scene\b/gm)?.length);
});

const privateDirectory = '/home/user/timeweft/private/run/';
test('local only: the real run files read without throwing (counts only)', { skip: !existsSync(`${privateDirectory}log.md`) }, () => {
  const read = (name: string): string => (existsSync(privateDirectory + name) ? readFileSync(privateDirectory + name, 'utf8') : '');
  const files: WeaverFiles = { log: read('log.md'), state: read('state.md'), cast: read('cast.md'), items: read('items.md'), places: read('places.md') };
  let real: ReturnType<typeof readWeaverFiles> | undefined;
  assert.doesNotThrow(() => {
    real = readWeaverFiles(files, { slug: 'local' });
  });
  if (!real) return;
  const entriesByKind: Record<string, number> = {};
  for (const entry of real.entries) entriesByKind[entry.kind] = (entriesByKind[entry.kind] ?? 0) + 1;
  const rulingsByScope: Record<string, number> = {};
  for (const ruling of real.rulings) rulingsByScope[ruling.scope] = (rulingsByScope[ruling.scope] ?? 0) + 1;
  const stackedReport = real.unplaced.find((line) => /bytes of stacked history/.test(line)) ?? '';
  const stackedBytes = Number(/: (\d+) bytes of stacked history/.exec(stackedReport)?.[1] ?? 0);
  console.log(JSON.stringify({
    scenes: real.scenes.length,
    sceneHeadings: files.log.match(/^## Scene\b/gm)?.length ?? 0,
    scenesWithReadings: real.scenes.filter((scene) => scene.readings.length > 0).length,
    entriesByKind,
    facts: real.entries.reduce((total, entry) => total + entry.facts.length, 0),
    trailNotes: real.entries.reduce((total, entry) => total + entry.trail.length, 0),
    rulingsByScope,
    threads: real.threads.length,
    waypoints: real.waypoints.length,
    legs: real.legs.length,
    unplaced: real.unplaced.length,
    stackedHistoryBytesNotCarried: stackedBytes,
  }));
  assert.equal(real.scenes.length, files.log.match(/^## Scene\b/gm)?.length ?? 0);
});
