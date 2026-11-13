/**
 * The five readings that once filed a newer fact as older, left a closed thread open, or chained
 * additive records into one history. Each test here failed against the reader before its fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWeaverFiles } from './index.ts';
import { factsOfLabelledBullet, readCast } from './read-entries.ts';
import { sceneEndingSegment, splitStackedHistory } from './text-helpers.ts';
import type { WeaverFiles } from '@timeweft/contract';

function threadsOf(threadBullets: string[]) {
  const files: WeaverFiles = {
    log: '', cast: '', items: '', places: '',
    state: `# State\n\n## Open threads\n${threadBullets.map((bullet) => `- ${bullet}`).join('\n')}\n`,
  };
  return readWeaverFiles(files, { slug: 'threads' }).threads;
}

test('a thread is closed where the marker opens the text after a short leading label', () => {
  const [labelled, boldLabelled, plain] = threadsOf([
    "The baker's debt: resolved; she paid it in flour (Scene 9).",
    '**The broken wheel:** **done** (Scene 12). The miller fixed it.',
    'The broken wheel: still turning badly (Scene 12).',
  ]);
  assert.equal(labelled?.closed, true);
  assert.equal(labelled?.resolution, 'she paid it in flour (Scene 9).');
  assert.equal(boldLabelled?.closed, true);
  assert.equal(boldLabelled?.resolution, '(Scene 12). The miller fixed it.');
  assert.equal(plain?.closed, false);
});

test('a thread is closed where the marker ends the bullet as its own sentence', () => {
  const [ending, boldEnding, negated, inSentence] = threadsOf([
    'Who stole the ferry rope (Scene 3). The ferryman found it in the reeds. Closed.',
    'The toll at the ford: the wardens dropped it. **Resolved.**',
    'The quarrel over the weir is not resolved.',
    'The flour count was all done.',
  ]);
  assert.equal(ending?.closed, true);
  assert.equal(ending?.resolution, 'Who stole the ferry rope (Scene 3). The ferryman found it in the reeds.');
  assert.equal(boldEnding?.closed, true);
  assert.equal(boldEnding?.resolution, 'The toll at the ford: the wardens dropped it.');
  assert.equal(negated?.closed, false);
  assert.equal(inSentence?.closed, false);
});

test('a scene is read from the parenthetical that closes the leading phrase before the colon', () => {
  assert.equal(sceneEndingSegment('At the mill (Scene 7): grinding the barley'), 7);
  assert.equal(sceneEndingSegment('At the mill (day +3): grinding the barley'), null);
  // A trailing parenthetical still dates the segment first.
  assert.equal(sceneEndingSegment('At the mill (Scene 7): grinding, then the ford (Scene 9)'), 9);
  // A phrase that already holds a sentence before the colon is not a leading phrase.
  assert.equal(sceneEndingSegment('She left early. She came back (Scene 7): it rained'), null);
});

test('the present dated by its leading phrase is not left undated', () => {
  const facts = factsOfLabelledBullet('where', 'In the mill loft (Scene 20): asleep. Before: at the ford (Scene 15).');
  assert.deepEqual(facts.map((fact) => fact.fromScene), [15, 20]);
});

test('a clause after a history marker that dates itself after the present stays with the present', () => {
  const segments = splitStackedHistory(
    'At the mill (Scene 20): grinding. Earlier: at the ford (Scene 15). On the ferry (Scene 25): crossing back.',
  );
  assert.deepEqual(segments, [
    'At the mill (Scene 20): grinding. On the ferry (Scene 25): crossing back.',
    'at the ford (Scene 15).',
  ]);
  const facts = factsOfLabelledBullet('where', 'At the mill (Scene 20): grinding. Earlier: at the ford (Scene 15). On the ferry (Scene 25): crossing back.');
  // Nothing dated after the present is imported as older, so nothing newer is closed by it.
  const older = facts.slice(0, -1);
  assert.ok(older.every((fact) => (fact.fromScene ?? 0) <= 20));
  assert.equal(facts.at(-1)?.fromScene, 20);
});

test('an older segment ends at the next labelled clause, which stands as its own older segment', () => {
  const segments = splitStackedHistory(
    'At the mill (Scene 20): grinding. Before: at the ford (Scene 15). On the bank (Scene 12): waiting.',
  );
  assert.deepEqual(segments, [
    'At the mill (Scene 20): grinding.',
    'at the ford (Scene 15).',
    'On the bank (Scene 12): waiting.',
  ]);
});

test('separate dated bullets sharing a label are additive records, named "(each)"', () => {
  const cast = `# Cast

## Ada Brook (she)
- **History:** ground the first barley (Scene 2).
- **History:** crossed on the ferry (Scene 5).
- **Where:** at the ford (Scene 3).
- **Where:** in the mill (Scene 6).
- **Where:** at home.
- **Standing:** trusted (Scene 9). Before: wary (Scene 4).
`;
  const ada = readCast(cast).entries[0];
  assert.ok(ada);
  const history = ada.facts.filter((fact) => fact.property === 'history (each)');
  assert.deepEqual(history.map((fact) => fact.fromScene), [2, 5]);
  assert.equal(ada.facts.filter((fact) => fact.property === 'history').length, 0);
  // One of the "where" bullets is undated, so the three stay one superseding history.
  assert.equal(ada.facts.filter((fact) => fact.property === 'where').length, 3);
  // A single bullet stacking its history with markers stays one superseding property.
  assert.equal(ada.facts.filter((fact) => fact.property === 'standing').length, 2);
});

test('separate bullets that stack history with markers are not made additive', () => {
  const cast = `# Cast

## Ada Brook (she)
- **Where:** in the mill (Scene 8). Before: at the ford (Scene 3).
- **Where:** in the loft (Scene 9).
`;
  const ada = readCast(cast).entries[0];
  assert.ok(ada);
  assert.equal(ada.facts.filter((fact) => fact.property.endsWith('(each)')).length, 0);
});
