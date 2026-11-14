/**
 * Five more readings that went wrong on a long hand-kept run: a clock's description that swallowed
 * the stacked present, a present dated by a later segment kept with it, closing forms a thread
 * bullet ends on, a waypoint that says in its own words that it was played, and a summary long
 * enough to read as a transcript. Each test here failed against the reader before its fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWeaverFiles } from './index.ts';
import { factsOfLabelledBullet } from './read-entries.ts';
import { summaryOf, SUMMARY_LIMIT_CHARACTERS } from './read-log.ts';
import { closureOfThread, statesNoSceneToReach } from './read-state.ts';
import { splitStackedHistoryDated } from './text-helpers.ts';
import type { WeaverFiles } from '@timeweft/contract';

function runOfState(state: string) {
  const files: WeaverFiles = { log: '', cast: '', items: '', places: '', state };
  return readWeaverFiles(files, { slug: 'demo' });
}

test("a relative clock's description is what day +0 is, never the stacked present nor a named clock's definition", () => {
  const stackedPresent = Array.from({ length: 30 }, (_, index) =>
    `Before that, flood day +${index + 2} at the ford, waiting out the rain.`).join(' ');
  const run = runOfState(`# State

## Clock
- Current: Mill Day 9 (flood day +11), evening, the mill kitchen. ${stackedPresent}
- Mill clock: Mill Day 1 = the day the ferry came, = flood day +3.
- Run began: the eve of the flood
`);
  const relative = run.clocks.find((clock) => clock.name === 'flood');
  assert.ok(relative);
  assert.equal(relative.countsFrom, 'Days after the eve of the flood, written "day +N".');
  assert.doesNotMatch(relative.countsFrom, /waiting out the rain/);
  assert.doesNotMatch(relative.countsFrom, /Mill Day 9/);
});

test('a relative clock still takes its name from the present where only the present names it', () => {
  const run = runOfState(`# State

## Clock
- Current: day 9 (harvest day +11), evening. Before that, harvest day +10.
- Run began: the eve of the harvest, and scenes are stamped relative to it.
`);
  const [relative] = run.clocks;
  assert.equal(relative?.name, 'harvest');
  assert.equal(relative?.countsFrom, 'Days after the eve of the harvest, and scenes are stamped relative to it, written "day +N".');
});

test("the present is dated by its own scene, not by a later segment kept with it", () => {
  const text = 'grinding the barley (Scene 20). Earlier: at the ford (Scene 15). Then on the ferry (Scene 25).';
  const split = splitStackedHistoryDated(text);
  assert.equal(split.presentScene, 20);
  assert.equal(split.present, 'grinding the barley (Scene 20).');
  assert.deepEqual(split.keptWithThePresent, ['at the ford (Scene 15). Then on the ferry (Scene 25).']);
  const facts = factsOfLabelledBullet('where', text);
  assert.equal(facts.at(-1)?.fromScene, 20);
  // The kept segment still travels with the present's value, so nothing it says is lost.
  assert.match(facts.at(-1)?.value ?? '', /on the ferry/);
});

test('a thread closes on a dash, a comma, a parenthesis, italics or a trailing scene note', () => {
  const cases: Array<[string, string]> = [
    ['Who sank the old ferry - closed.', 'Who sank the old ferry'],
    ['The toll at the ford, resolved', 'The toll at the ford'],
    ['The broken wheel (closed)', 'The broken wheel'],
    ['The broken wheel [resolved]', 'The broken wheel'],
    ['The lantern maker. *Closed.*', 'The lantern maker.'],
    ['The lantern maker. _Resolved_', 'The lantern maker.'],
    ['The flour count. Done (Scene 12).', 'The flour count.'],
    ['The flour count - resolved, Scene 12.', 'The flour count'],
    ['The flour count. Closed Scene 12', 'The flour count.'],
    ['The flour count [closed in Scene 12]', 'The flour count'],
  ];
  for (const [bullet, resolution] of cases) {
    assert.equal(closureOfThread(bullet), resolution, bullet);
  }
});

test('after a label, a status word followed by more prose is what the thread is about', () => {
  assert.equal(closureOfThread('The weir: closed sluices keep the mill pond full, but for how long?'), null);
  assert.equal(closureOfThread('The ford: done right, the crossing would save a day.'), null);
  assert.equal(closureOfThread('The debt: resolved; she paid it in flour.'), 'she paid it in flour.');
  assert.equal(closureOfThread('The debt: resolved (Scene 9).'), '(Scene 9).');
  assert.equal(closureOfThread('The debt: resolved'), 'The debt');
  assert.equal(closureOfThread('The new mill wheel is half-done.'), null);
  assert.equal(closureOfThread('The debt: done - the baker paid.'), 'the baker paid.');
});

test('a waypoint that says it was played, reached or done in a scene is reached', () => {
  const run = runOfState(`# State

## Authored waypoints
- A night crossing of the ford. Played Scene 12.
- The lantern is relit (reached Scene 30).
- The mill burns; done in Scene 40.
- The baker's wedding, still to come.
- The miller has played the fiddle before.
`);
  assert.deepEqual(run.waypoints.map((waypoint) => waypoint.reached), [true, true, true, false, false]);
});

test('a waypoint bullet that states no scene to reach is not a waypoint, and one that opens on an attribution still is', () => {
  const run = runOfState(`# State

## Authored waypoints
- (Author, Scene 2) The miller and the baker meet at the ford at dusk.
- (held by the author; kept out of the narration)
- *(kept elsewhere)*.
- (the bell rings) The ferry comes back.
`);
  assert.deepEqual(run.waypoints.map((waypoint) => waypoint.text), [
    '(Author, Scene 2) The miller and the baker meet at the ford at dusk.',
    '(the bell rings) The ferry comes back.',
  ]);
  const said = run.unplaced.filter((line) => /only a note that the waypoint is held outside the files, was not carried/.test(line));
  assert.deepEqual(said.map((line) => /line (\d+)/.exec(line)?.[1]), ['5', '6']);
  // No door adds a waypoint to a run that has begun, so the report does not send the author to one.
  for (const line of said) assert.doesNotMatch(line, /can be added in the app/);
  assert.equal(statesNoSceneToReach('(Scene 4) Reach the mill.'), false);
  assert.equal(statesNoSceneToReach('   '), true);
});

test('a summary is about 320 characters of whole sentences', () => {
  assert.equal(SUMMARY_LIMIT_CHARACTERS, 320);
  const sentence = 'The miller carries the sack of barley down to the ford in the rain. ';
  const summary = summaryOf(sentence.repeat(10));
  assert.ok(summary.length <= 320, `${summary.length}`);
  assert.match(summary, /rain\.$/);
  const long = summaryOf('word '.repeat(300));
  assert.ok(long.length <= 324);
  assert.match(long, / \.\.\.$/);
});

test('a waypoint written wholly in parentheses is still a waypoint, unless its parentheses say it is held outside the files', () => {
  for (const real of [
    '(The miller meets the baker at the ford at dusk.)',
    '(The miller (and the baker) meet at the ford.)',
    '("The ferry is late," the miller says.)',
    '~~(The miller crosses the ford.)~~',
    '(the miller meets the baker at dusk)',
  ]) assert.equal(statesNoSceneToReach(real), false, real);
  const run = runOfState(`# State

## Authored waypoints
- (The miller meets the baker at the ford at dusk.)
- ~~(The miller crosses the ford.)~~
`);
  assert.deepEqual(run.waypoints, [
    { text: '(The miller meets the baker at the ford at dusk.)', reached: false },
    { text: '~~(The miller crosses the ford.)~~', reached: true },
  ]);
});

test('the held-outside-the-files note is read in its near shapes too', () => {
  for (const placeholder of [
    '(held author-side; kept out of narration)',
    '(held author-side) (kept out of narration)',
    '(held author-side; kept out of narration) \u2026',
    '(held author-side; kept out of narration) (see notes)',
    '[held author-side; kept out of narration]',
    'Waypoint 1: (held author-side; kept out of narration)',
  ]) assert.equal(statesNoSceneToReach(placeholder), true, placeholder);
  // A waypoint beside a note that it is held stays a waypoint: its scene is written in the files.
  assert.equal(statesNoSceneToReach('(The miller meets the baker.) (held by the author)'), false);
  assert.equal(statesNoSceneToReach('Waypoint 1: the miller meets the baker.'), false);
});
