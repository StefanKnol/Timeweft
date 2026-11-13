/**
 * A hand-kept state file keeps a thread alive by adding dated updates inside its bullet ("Scene 9:
 * the miller paid half"), long after the scene it opened in. Each scene a thread names after its
 * opening is a touch, so the scene it last moved in is the newest of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWeaverFiles } from './index.ts';
import { scenesAThreadNamesAfterItsOpening } from './read-state.ts';

test('every scene named after the opening counts once, oldest first', () => {
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: the miller owes the baker. Scene 7: half paid. Scene 5: asked again. Scene 7: still half.', 2), [5, 7]);
});

test('a range counts by its last scene, and every scene of a list counts', () => {
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Raised in Scene 1. Argued over in Scenes 3-6, and again in Scenes 8, 9 and 11.', 1), [6, 8, 9, 11]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 1: a debt. Talked of in Scenes 4 to 5.', 1), [5]);
});

test('a scene named only as a deadline is not a touch', () => {
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 1: the rope must be mended before Scene 10, or by Scene 12. Scene 4: it frayed.', 1), [4]);
});

test('a scene at or before the opening is not a touch, and where the opening is unknown every scene counts', () => {
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Echoes what was said in Scene 2. Opened in Scene 5. Scene 6: moved.', 5), [6]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Talked of in Scene 3 and Scene 4.', null), [3, 4]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Will the pond hold?', 1), []);
});

test('the reader gives each thread its touches on scenes the log has, and none where it names none', () => {
  const log = ['# The Mill', '', ...[1, 2, 3, 4].flatMap((number) => [`## Scene ${number}: Day ${number}`, 'The wheel turned.', ''])].join('\n');
  const state = [
    '# State', '', '## Open threads',
    '- Scene 1: who cracked the wheel? Scene 3: the baker saw a cart. Scene 40: a scene the log does not have.',
    '- Scene 2: will the pond hold?',
    '',
  ].join('\n');
  const run = readWeaverFiles({ log, state, cast: '', items: '', places: '' }, { slug: 'mill' });
  assert.deepEqual(run.threads.map((thread) => [thread.openedInScene, thread.touchedInScenes]), [[1, [3]], [2, []]]);
});

test('a number after a single scene is a count, not another scene: only "Scenes" makes a list', () => {
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: the miller owes rent. Update Scene 5, 8 coins paid.', 2), [5]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: a debt. Scene 6 and 30 riders came.', 2), [6]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: a debt. Scene 6 & 4 carts.', 2), [6]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 1: a debt. Talked of in Scene 4-6.', 1), [6], 'a range still reads after a single scene');
});

test('a scene joined to a deadline by "and" or "or" is a deadline too', () => {
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: rent due. Paid in part, Scene 4; rest due before Scene 6 and Scene 9.', 2), [4]);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: raised. Promised to return by Scene 6 or Scene 7.', 2), []);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: raised. Due by Scene 6, or Scene 7, or Scene 8.', 2), []);
  assert.deepEqual(scenesAThreadNamesAfterItsOpening('Scene 2: due by Scene 6. Scene 7: it was paid.', 2), [7], 'a scene after a full stop is not part of the deadline');
});
