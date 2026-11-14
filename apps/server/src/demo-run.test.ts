/**
 * The demo run's plan is pure: the same count always plans the same run, at the sizes a long run
 * has, and every thread a scene closes or touches was opened earlier and is still open then.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Refusal } from '@timeweft/contract';
import { LONGEST_PROSE_WORDS, SHORTEST_PROSE_WORDS, entryOfIndex, planOfDemoRun, proseOfScene, shareOfScene } from './demo-run.ts';
import { seedRequestFromArguments } from './seed-demo-run-command.ts';

function wordsIn(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

test('the plan is the same every time it is made', () => {
  assert.deepEqual(planOfDemoRun(60), planOfDemoRun(60));
});

test('the default plan has the sizes of a long run', () => {
  const plan = planOfDemoRun();
  const scenes = plan.scenes;
  assert.equal(scenes.length, 420);
  const opened = scenes.flatMap((scene) => scene.threadsOpened).length;
  const closed = scenes.flatMap((scene) => scene.threadsClosed).length;
  assert.equal(opened, 210);
  assert.equal(closed, 60);
  assert.equal(scenes.flatMap((scene) => scene.rulings).length, 750);
  assert.equal(scenes.flatMap((scene) => scene.entries).length, 300);
  assert.ok(scenes.filter((scene) => scene.redone).length >= 5);
  assert.ok(scenes.filter((scene) => scene.starred).length >= 10);
  assert.ok(scenes.some((scene) => scene.afterwards.authorOnlyEntries.length > 0));
  assert.ok(scenes.some((scene) => scene.afterwards.authorFacts.length > 0));
});

test('every prose runs from 300 to 1500 words', () => {
  for (const scene of planOfDemoRun().scenes) {
    const words = wordsIn(scene.record);
    assert.ok(words >= SHORTEST_PROSE_WORDS && words <= LONGEST_PROSE_WORDS, `scene ${scene.number} has ${words} words`);
  }
  assert.equal(proseOfScene(7, ['Odo the miller']), proseOfScene(7, ['Odo the miller']));
});

test('entry names never repeat', () => {
  const names = Array.from({ length: 600 }, (_, index) => entryOfIndex(index).name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('a thread is closed or touched only after it was opened and while it is open', () => {
  const open = new Set<number>();
  for (const scene of planOfDemoRun().scenes) {
    for (const thread of [...scene.threadsClosed, ...scene.threadsTouched]) assert.ok(open.has(thread.ordinal), `scene ${scene.number}, thread ${thread.ordinal}`);
    const closedHere = new Set(scene.threadsClosed.map((thread) => thread.ordinal));
    for (const thread of scene.threadsTouched) assert.ok(!closedHere.has(thread.ordinal));
    for (const thread of scene.threadsClosed) open.delete(thread.ordinal);
    for (const thread of scene.threadsOpened) open.add(thread.ordinal);
  }
  assert.equal(open.size, 150);
});

test('the shares of a total add up to the total', () => {
  let sum = 0;
  for (let index = 0; index < 37; index += 1) sum += shareOfScene(index, 101, 37);
  assert.equal(sum, 101);
});

test('the command takes a slug and a count, and refuses a bad one', () => {
  assert.deepEqual(seedRequestFromArguments(['--', '--slug', 'a-test', '--scenes', '30']), { slug: 'a-test', scenes: 30 });
  assert.deepEqual(seedRequestFromArguments([]), { slug: 'the-long-valley', scenes: 420 });
  assert.throws(() => seedRequestFromArguments(['--scenes', 'many']), Refusal);
  assert.throws(() => seedRequestFromArguments(['--slug', 'Not A Slug']), Refusal);
});
