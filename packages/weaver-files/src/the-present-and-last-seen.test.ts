/**
 * Readings that left an imported run's present older than its scenes: a "last seen" line written
 * once while every trail note restated it, a count written once in the Clock section beside the
 * scenes' readings, a named clock described by its status word, a thread dated only by a clock
 * count, and a part of the day standing in a later part of the When line. Each test failed against
 * the reader before its fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWeaverFiles } from './index.ts';
import { closingLabelledSentence } from './read-entries.ts';
import { isAPartOfTheDay } from './read-log.ts';
import { openedSceneOfThread } from './read-state.ts';
import type { ImportedEntry, WeaverFiles } from '@timeweft/contract';

const log = `# The Dry Season

## Scene 1: Grain
**When:** Mill Day 1 (flood day +3) · the mill · dusk
The miller grinds.

## Scene 2: The ford
**When:** Mill Day 2 (flood day +4) · the Old Ford · midday into early afternoon
> - Where: the Old Ford

## Scene 3: The bakery
**When:** Mill Day 3 (flood day +5) · morning
> - Where: the Bakery

## Scene 4: The ford again
**When:** Mill Day 4 (flood day +6) · the Old Ford · night
> - Where: the Old Ford
`;

const state = `# State

## Clock
- Current: Mill Day 4 (flood day +6), night, the Old Ford.
- Mill clock: running. Mill Day 1 = the day the ferry came (Scene 1), = flood day +3. Before that, scenes are stamped relative to the flood (eve / flood day / day +N).
- Run began: the eve of the flood
- Elapsed in run: three days since the eve (day +3 = Mill Day 1). Note (author, Scene 2): the ferry keeps no clock.
- Valley age: some centuries since the mill was built

## Current situation
The miller waits at the ford for the ferry (Scene 4).

## Open threads
- Scene 3: the baker wants flour; later raised again in Scene 4.
- The ferryman owes a rope since day +4.
- The bell nobody rings.
`;

const cast = `# Cast

## Ada Brook (she)
- **Who:** the miller.
- **Last seen:** Scene 1, the mill
- Scene 2: crosses at the ford. Last seen: Scene 2, the Old Ford.
- Scene 3: buys bread at the bakery and says: not today. Last seen: Scene 3, the Bakery.

## Oren Vale (he)
- **Who:** the ferryman.
- **Last seen:** Scene 1, the mill
- Scene 4: rows across in the dark.

## Bram (he)
- **Who:** the baker.
- **Mood:** cheerful
- Scene 3: kneads dough. Mood: weary.
- Scene 3: shuts the shop early. Who knows: the baker's wife.
`;

const places = `# Places

## The Old Ford
- **What:** a stony ford.
- **Last seen:** Scene 2

## The Bakery
- **What:** a bakery.
`;

const files: WeaverFiles = { log, state, cast, items: '', places };
const run = readWeaverFiles(files, { slug: 'dry-season', setting: 'A valley' });

function entryNamed(name: string): ImportedEntry {
  const entry = run.entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `no entry named ${name}`);
  return entry;
}

function holding(entry: ImportedEntry, property: string) {
  const facts = entry.facts.filter((fact) => fact.property === property);
  return facts.reduce((newest, fact) => ((fact.fromScene ?? -1) >= (newest?.fromScene ?? -1) ? fact : newest), facts[0]);
}

test("a trail note's closing \"Last seen:\" sentence is a fact of the note's scene, and the note keeps the rest", () => {
  const ada = entryNamed('Ada Brook');
  const lastSeen = ada.facts.filter((fact) => fact.property === 'last seen');
  assert.deepEqual(lastSeen.map((fact) => [fact.value, fact.fromScene]), [
    ['Scene 1, the mill', 1], ['Scene 2, the Old Ford', 2], ['Scene 3, the Bakery', 3],
  ]);
  assert.equal(lastSeen[2]?.note, 'From the trail note of scene 3.');
  assert.deepEqual(ada.trail.map((note) => note.text), ['crosses at the ford.', 'buys bread at the bakery and says: not today.']);
});

test('a closing sentence is read only under "last seen" or a label the entry already carries', () => {
  const bram = entryNamed('Bram');
  assert.deepEqual(bram.facts.filter((fact) => fact.property === 'mood').map((fact) => [fact.value, fact.fromScene]), [['cheerful', null], ['weary', 3]]);
  assert.ok(!bram.facts.some((fact) => fact.property === 'who knows'));
  assert.equal(bram.trail[1]?.text, "shuts the shop early. Who knows: the baker's wife.");
  assert.equal(closingLabelledSentence('Met the miller. Who: a friend. She left.'), null);
  assert.deepEqual(closingLabelledSentence('Met the miller. Last seen: Scene 4, the mill.'), { rest: 'Met the miller.', label: 'Last seen', value: 'Scene 4, the mill' });
});

test('"last seen" is brought up to the newest scene naming the entry, the hand-kept line becoming history', () => {
  const oren = entryNamed('Oren Vale');
  assert.deepEqual(oren.facts.filter((fact) => fact.property === 'last seen').map((fact) => [fact.value, fact.fromScene]), [
    ['Scene 1, the mill', 1], ['Scene 4, The Old Ford', 4],
  ]);
  // A place is seen where a scene is set there.
  const ford = holding(entryNamed('The Old Ford'), 'last seen');
  assert.deepEqual([ford?.value, ford?.fromScene], ['Scene 4', 4]);
  // An entry with no "last seen" line gains none, and one already up to date gains nothing.
  assert.ok(!entryNamed('The Bakery').facts.some((fact) => fact.property === 'last seen'));
  assert.equal(entryNamed('Ada Brook').facts.filter((fact) => fact.property === 'last seen').length, 3);
  assert.ok(run.unplaced.some((line) => /2 entries' "last seen" line was older/.test(line)));
});

test('a count written once in the Clock section is left out of the run, the author\'s note in its bullet is a ruling, and no leftover becomes the setting', () => {
  const situation = run.scenes.at(-1)?.situationAfter ?? '';
  assert.equal(situation, 'The miller waits at the ford for the ferry (Scene 4).');
  assert.doesNotMatch(situation, /Elapsed|three days|Valley age/);
  // The setting is only what the caller gave; the leftovers are not where and when the run is set.
  assert.equal(run.setting, 'A valley');
  const note = run.rulings.find((ruling) => /ferry keeps no clock/.test(ruling.text));
  assert.deepEqual(note, {
    text: 'Note (author, Scene 2): the ferry keeps no clock.', source: 'author', scope: 'run',
    topics: ['time'], about: [], scene: 2,
  });
  assert.ok(run.unplaced.some((line) => /"Valley age" line is neither the present, a clock, the zero of the days-after clock nor a note by the author/.test(line)));
  assert.ok(run.unplaced.some((line) => /a sentence of the Clock section's "Elapsed in run" line that carry a count on a kept clock were left out/.test(line)));
  // The note that ends the "Elapsed in run" bullet is carried as a ruling, so the rest of that
  // bullet, which is only its count, is not also said as a leftover that was not carried.
  assert.ok(!run.unplaced.some((line) => /the rest of the Clock section's "Elapsed in run" line/.test(line)));
  for (const clock of run.clocks) assert.doesNotMatch(clock.countsFrom, /three days|day \+3 =/);
  // A count closing its sentence is still a count.
  const closing = readWeaverFiles({ log: '', cast: '', items: '', places: '', state: '# State\n\n## Clock\n- Mill clock: Mill Day 1 = the first flood.\n- Elapsed: the run is at Mill Day 9.\n' }, { slug: 'closing' });
  assert.equal(closing.setting, '');
});

test('with no Current situation section, the Clock section\'s Current line is the present', () => {
  const alone = readWeaverFiles({ log, cast: '', items: '', places: '', state: '# State\n\n## Clock\n- Current: Mill Day 4, night, at the ford.\n' }, { slug: 'alone' });
  assert.equal(alone.scenes.at(-1)?.situationAfter, 'Current: Mill Day 4, night, at the ford.');
});

test("a named clock is described by what its Day 1 is, never by a status word, and the days-after reckoning by its own zero", () => {
  const mill = run.clocks.find((clock) => clock.name === 'Mill clock');
  assert.equal(mill?.countsFrom, 'Mill Day 1 = the day the ferry came (Scene 1), = flood day +3.');
  const flood = run.clocks.find((clock) => clock.name === 'flood');
  assert.equal(flood?.countsFrom, 'Days after the eve of the flood, written "day +N". Before that, scenes are stamped relative to the flood (eve / flood day / day +N).');
  const stopped = readWeaverFiles({ log: '', cast: '', items: '', places: '', state: '# State\n\n## Clock\n- Mill clock: stopped. Mill Day 1 = the first flood.\n' }, { slug: 'stopped' });
  assert.equal(stopped.clocks[0]?.countsFrom, 'Mill Day 1 = the first flood. (stopped)');
  const undefinedDayOne = readWeaverFiles({ log: '', cast: '', items: '', places: '', state: '# State\n\n## Clock\n- Mill clock: running. Counts the days of milling since the wheel was mended.\n' }, { slug: 'no-day-one' });
  assert.equal(undefinedDayOne.clocks[0]?.countsFrom, 'Counts the days of milling since the wheel was mended.');
});

test('a thread is dated wherever its text says when it opened, by a scene or by a clock count', () => {
  assert.deepEqual(run.threads.map((thread) => thread.openedInScene), [3, 2, null]);
  assert.equal(openedSceneOfThread('(Scenes 4-6) the mill wheel'), 6);
  assert.equal(openedSceneOfThread('raised in Scene 7, again in Scene 9'), 7);
  assert.equal(openedSceneOfThread('The ferryman has owed the rope since Scene 2.'), 2);
});

test('a scene a thread names as a deadline does not date it, so a shorter log still imports', () => {
  // Before the fix the deadline was read as the scene the thread opened in, and an import of a
  // two-scene log refused the whole run for naming a scene 10 it does not have.
  assert.equal(openedSceneOfThread('The wheel must be mended before Scene 10 or the barley rots.'), null);
  assert.equal(openedSceneOfThread('The baker wants flour by Scene 3.'), null);
  const short = readWeaverFiles({
    log: '# The Mill\n\n## Scene 1: Grain\nThe miller grinds.\n\n## Scene 2: The ford\nThe ferry is late.\n',
    cast: '', items: '', places: '',
    state: '# State\n\n## Open threads\n- The wheel must be mended before Scene 10 or the barley rots.\n',
  }, { slug: 'deadline' });
  assert.deepEqual(short.threads.map((thread) => thread.openedInScene), [null]);
});

test('a part of the day is read from a later part of the When line where the count stands alone', () => {
  assert.deepEqual(run.scenes.map((scene) => scene.readings[0]?.partOfDay), ['dusk', 'midday into early afternoon', 'morning', 'night']);
  assert.equal(isAPartOfTheDay('the Old Ford'), false);
  assert.equal(isAPartOfTheDay('late evening'), true);
});

/** Reads a state.md holding only a Clock section with these lines, beside no log. */
function clockSectionAlone(lines: string, slug: string) {
  return readWeaverFiles({ log: '', cast: '', items: '', places: '', state: `# State\n\n## Clock\n${lines}\n` }, { slug });
}

test('a "Run began" line with no days-after clock to count from it is said in the unplaced report, never the setting', () => {
  const read = clockSectionAlone('- Mill clock: Mill Day 1 = the day the ferry came.\n- Run began: the eve of the harvest', 'began-alone');
  assert.deepEqual(read.clocks.map((clock) => clock.name), ['Mill clock']);
  assert.equal(read.setting, '');
  assert.ok(read.unplaced.some((line) => /line 5: the Clock section's "Run began" line was not carried, since no "day \+N" counts from it/.test(line)));
  // Where a days-after clock counts from it, the line describes that clock and is not said twice.
  const counted = clockSectionAlone('- Run began: the eve of the harvest\n- Note: scenes are stamped (harvest day +2).', 'began-counted');
  assert.match(counted.clocks.find((clock) => clock.name === 'harvest')?.countsFrom ?? '', /the eve of the harvest/);
  assert.doesNotMatch(counted.setting, /Run began/);
});

test('what is left of a Clock section bullet once its count is out, and any other leftover, goes to the unplaced report', () => {
  const read = clockSectionAlone('- Mill clock: Mill Day 1 = the first flood.\n- Elapsed: the run is at Mill Day 9. So far.\n- Pond: low since the dry spell began.', 'fragment');
  assert.equal(read.setting, '');
  assert.ok(read.unplaced.some((line) => /line 5: the rest of the Clock section's "Elapsed" line is neither/.test(line)));
  assert.ok(read.unplaced.some((line) => /line 6: the Clock section's "Pond" line is neither/.test(line)));
  // A line that only says something is kept elsewhere is exactly what the store does not hold.
  const elsewhere = clockSectionAlone('- Valley age: broad strokes only (kept in another file).', 'elsewhere');
  assert.equal(elsewhere.setting, '');
  assert.deepEqual(elsewhere.rulings, []);
  assert.equal(elsewhere.unplaced.length, 1);
});

test('a Clock section bullet whose own label is a note by the author is a ruling, word for word, appended after the standing rulings', () => {
  const read = readWeaverFiles({
    log: '# The Mill\n\n## Scene 1: Grain\nThe miller grinds.\n\n## Scene 2: The ford\nThe ferry is late.\n',
    cast: '', items: '', places: '',
    state: [
      '# State', '', '## Clock', '- Note (author, Scene 2): the ferry runs on its own hours.',
      '- Note (author, Scene 9): the bell is never rung at night.', '- Note for the author: check the pond.', '',
      '## Standing rulings', '- (Scene 1) The miller is never named on the page.', '- "Plain past tense."', '',
    ].join('\n'),
  }, { slug: 'notes' });
  assert.deepEqual(read.rulings.map((ruling) => [ruling.text, ruling.source, ruling.scene, ruling.topics[0]]), [
    ['(Scene 1) The miller is never named on the page.', 'story', 1, 'narration'],
    ['"Plain past tense."', 'author', null, 'narration'],
    ['Note (author, Scene 2): the ferry runs on its own hours.', 'author', 2, 'time'],
    // Scene 9 is not in the log, so the note keeps no scene, and that is said.
    ['Note (author, Scene 9): the bell is never rung at night.', 'author', null, 'time'],
  ]);
  assert.ok(read.unplaced.some((line) => /names scene 9, which the log does not have/.test(line)));
  // A note left for the author is not the author's, so it is a leftover.
  assert.ok(read.unplaced.some((line) => /"Note for the author" line is neither/.test(line)));
  assert.equal(read.setting, '');
});

test('a Clock section line that is not a bullet is the present less its counts, and a countless bullet is unplaced, never the setting', () => {
  const read = readWeaverFiles({
    log: '# The Mill\n\n## Scene 1: Grain\nThe miller grinds.\n', cast: '', items: '', places: '',
    state: '# State\n\n## Clock\nThe mill is at day +9 now. The pond is low.\n- Weather: rain over the ford.\n- Elapsed: day +7 since the eve.\n',
  }, { slug: 'strays' });
  assert.equal(read.scenes.at(-1)?.situationAfter, 'The pond is low.');
  assert.equal(read.setting, '');
  assert.ok(read.unplaced.some((line) => /"Weather" line is neither/.test(line)));
  assert.ok(read.unplaced.some((line) => /a sentence of a Clock section line that carry a count on a kept clock were left out of the present/.test(line)));
  assert.ok(read.unplaced.some((line) => /"Elapsed" line that carry a count/.test(line)));
});

test('a named clock\'s definition is neither a count written once nor the days-after reckoning', () => {
  const read = clockSectionAlone([
    '- Mill clock: Mill Day 1 = the day the ferry came, counted relative to the flood.',
    '- Run began: the eve of the flood',
    '- Ferry note: Mill Day 1 = the first crossing.',
    '- Elapsed: (flood day +2) since the eve.',
  ].join('\n'), 'definitions');
  // "Mill Day 1 = ..." defines the clock, so the sentence stays the named clock's own even where it says "relative to".
  assert.equal(read.clocks.find((clock) => clock.name === 'Mill clock')?.countsFrom, 'Mill Day 1 = the day the ferry came, counted relative to the flood.');
  assert.equal(read.clocks.find((clock) => clock.name === 'flood')?.countsFrom, 'Days after the eve of the flood, written "day +N".');
  // And a definition in another bullet is no count, and no clock either, so it is said as a leftover.
  assert.equal(read.setting, '');
  assert.ok(read.unplaced.some((line) => /"Ferry note" line is neither/.test(line)));
});

test('a thread naming two clock counts is dated to the earliest scene that reads one', () => {
  const twoCounts = state.replace(/## Open threads[\s\S]*$/, '## Open threads\n- The ferryman owes a rope since day +4, first asked for on day +3.\n');
  const read = readWeaverFiles({ log, cast: '', items: '', places: '', state: twoCounts }, { slug: 'two-counts' });
  assert.deepEqual(read.threads.map((thread) => thread.openedInScene), [1]);
});

test('where two trail notes of one scene restate one property, the later written is kept', () => {
  const twoNotes = '# Cast\n\n## Ada Brook (she)\n- **Last seen:** Scene 1, the mill\n- Scene 2: crosses at the ford. Last seen: Scene 2, the Old Ford.\n- Scene 2: waits for the ferry. Last seen: Scene 2, the landing.\n';
  const read = readWeaverFiles({ log, cast: twoNotes, items: '', places: '', state: '' }, { slug: 'two-notes' });
  const ada = read.entries.find((entry) => entry.name === 'Ada Brook');
  const fromTheNotes = ada?.facts.filter((fact) => fact.property === 'last seen' && fact.fromScene === 2).map((fact) => fact.value);
  assert.deepEqual(fromTheNotes, ['Scene 2, the landing']);
});

test('an author\'s note merely mentioned inside a sentence is no ruling, and the count in that sentence is still left out', () => {
  const read = readWeaverFiles({
    log: '# The Mill\n\n## Scene 1: Grain\nThe miller grinds.\n', cast: '', items: '', places: '',
    state: [
      '# State', '', '## Clock', '- Run began: the eve of the flood.',
      "- Elapsed in run: the run is at day +9 (see the author's note: it drifts).",
      "- Elapsed again: the run is at day +9, see the author's note: it drifts.", '',
    ].join('\n'),
  }, { slug: 'mentioned' });
  assert.deepEqual(read.rulings, []);
  for (const [lineNumber, label] of [[5, 'Elapsed in run'], [6, 'Elapsed again']] as const) {
    assert.ok(read.unplaced.some((line) => line.startsWith(`state.md line ${lineNumber}: a sentence of the Clock section's "${label}" line that carry a count on a kept clock were left out`)), label);
  }
});

test('a note by the author whose label holds a colon inside its parenthesis keeps its scene', () => {
  const read = readWeaverFiles({
    log: '# The Mill\n\n## Scene 1: Grain\nThe miller grinds.\n\n## Scene 2: The ford\nThe ferry is late.\n',
    cast: '', items: '', places: '',
    state: '# State\n\n## Clock\n- Note (author, Scene 2: at the ford): the ferry keeps no clock.\n- Elapsed in run: three quiet days. Note (author, Scene 2: at the ford): the bell is silent.\n',
  }, { slug: 'colon' });
  assert.deepEqual(read.rulings.map((ruling) => [ruling.text, ruling.scene]), [
    ['Note (author, Scene 2: at the ford): the ferry keeps no clock.', 2],
    ['Note (author, Scene 2: at the ford): the bell is silent.', 2],
  ]);
});
