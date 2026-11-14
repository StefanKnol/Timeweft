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

test('the author edits a handful of scenes once the run is written, each edit changing what it names', () => {
  const plan = planOfDemoRun();
  const byNumber = new Map(plan.scenes.map((scene) => [scene.number, scene]));
  assert.ok(plan.sceneEdits.length >= 6);
  const editedNumbers = new Set(plan.sceneEdits.map((edit) => edit.number));
  assert.ok(editedNumbers.size >= 6, 'a handful of scenes, one of them edited twice');
  assert.ok(editedNumbers.has(420), 'what stood after the newest scene is reworded');
  for (const { number, ...fields } of plan.sceneEdits) {
    const scene = byNumber.get(number);
    assert.ok(scene, `scene ${number} is in the plan`);
    assert.ok(Object.keys(fields).length > 0, `the edit of scene ${number} changes something`);
    for (const [field, value] of Object.entries(fields)) {
      assert.notEqual(value, (scene as unknown as Record<string, unknown>)[field], `scene ${number}: ${field} differs`);
    }
  }
  assert.ok(planOfDemoRun(2).sceneEdits.length >= 2, 'a short run is edited too');
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
