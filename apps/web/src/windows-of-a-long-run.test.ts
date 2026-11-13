/**
 * A long run must not draw every scene and every ruling at once: on a run of 417 scenes that was
 * hundreds of thousands of characters on one page. The newest are drawn, and "Show older" adds
 * more a step at a time. The shaping that decides which are drawn is here, held by `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RulingRecord, SceneRecord } from '@timeweft/contract';
import {
  RULINGS_SHOWN_AT_A_TIME, SCENES_SHOWN_AT_A_TIME, newestShown, rulingsToDraw, scenesByNumber, shownAfterShowingOlder,
} from './shaping.ts';

// A made-up demo world: a ferry and its crossings.

function scene(number: number): SceneRecord {
  return {
    id: `scene-${number}`, runId: 'run', number, title: `Crossing ${number}`, starred: false, whenTyped: 'dawn',
    placeEntryId: null, summary: 'The ferry crosses.', record: '', steer: '', situationAfter: '', status: 'standing',
    readings: [], createdAt: `2026-01-01T00:00:00.${String(number).padStart(3, '0')}Z`,
  };
}

function ruling(number: number, text: string): RulingRecord {
  return {
    id: `ruling-${number}`, runId: 'run', number, text, source: 'author', scope: 'run', topics: [], aboutEntryIds: [],
    sceneId: null, withdrawnInSceneId: null, createdAt: '2026-01-01T00:00:00Z',
  };
}

const longRunScenes = Array.from({ length: 417 }, (_, index) => scene(index + 1));
const longRunRulings = Array.from({ length: 742 }, (_, index) => ruling(index + 1, `The ferry runs at tide ${index + 1}.`));

test('the scenes of a long run are drawn the newest fifty first, still in number order', () => {
  const window = newestShown(scenesByNumber(longRunScenes), SCENES_SHOWN_AT_A_TIME, SCENES_SHOWN_AT_A_TIME);
  assert.equal(SCENES_SHOWN_AT_A_TIME, 50);
  assert.deepEqual(window.shown.map((slot) => slot.number), Array.from({ length: 50 }, (_, index) => 368 + index));
  assert.equal(window.olderNotShown, 367);
  assert.equal(window.showOlderWouldAdd, 50);
});

test('showing older adds a step at a time, and the last step adds only what is left', () => {
  const slots = scenesByNumber(longRunScenes);
  let shownCount = SCENES_SHOWN_AT_A_TIME;
  shownCount = shownAfterShowingOlder(shownCount, SCENES_SHOWN_AT_A_TIME, slots.length);
  assert.equal(shownCount, 100);
  assert.equal(newestShown(slots, shownCount, SCENES_SHOWN_AT_A_TIME).shown[0]?.number, 318);
  for (let step = 0; step < 20; step += 1) shownCount = shownAfterShowingOlder(shownCount, SCENES_SHOWN_AT_A_TIME, slots.length);
  assert.equal(shownCount, 417, 'never more than there are');
  const all = newestShown(slots, shownCount, SCENES_SHOWN_AT_A_TIME);
  assert.equal(all.shown.length, 417);
  assert.equal(all.olderNotShown, 0);
  assert.equal(all.showOlderWouldAdd, 0);
  assert.equal(newestShown(slots, 400, SCENES_SHOWN_AT_A_TIME).showOlderWouldAdd, 17);
});

test('a short run is drawn whole, with nothing older to show', () => {
  const window = newestShown(scenesByNumber(longRunScenes.slice(0, 12)), SCENES_SHOWN_AT_A_TIME, SCENES_SHOWN_AT_A_TIME);
  assert.equal(window.shown.length, 12);
  assert.equal(window.olderNotShown, 0);
});

test('rulings are drawn a hundred at a time, the newest first shown', () => {
  const window = rulingsToDraw(longRunRulings, '', RULINGS_SHOWN_AT_A_TIME);
  assert.equal(window.matchingCount, 742);
  assert.equal(RULINGS_SHOWN_AT_A_TIME, 100);
  assert.equal(window.shown.length, 100);
  assert.equal(window.shown[0]?.number, 643);
  assert.equal(window.shown.at(-1)?.number, 742);
  assert.equal(window.olderNotShown, 642);
});

test('the filter searches every ruling, not only those drawn', () => {
  const rulings = [...longRunRulings, ruling(743, 'The ferry never runs in fog.')];
  rulings[0] = ruling(1, 'The ferryman keeps the lantern lit.');
  const window = rulingsToDraw(rulings, 'lantern', RULINGS_SHOWN_AT_A_TIME);
  assert.equal(window.matchingCount, 1);
  assert.deepEqual(window.shown.map((found) => found.number), [1]);
  assert.equal(window.olderNotShown, 0);
});
