import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, Refusal, type RequestOf, type Store } from '@timeweft/contract';
import { openStoreForTests } from './index.ts';
import { beginDemoRun, redoInput, sceneInput } from './demo-world.ts';
import { excerptAround, likePatternHolding } from './scene-text.ts';
import { wordsIn } from './snapshot.ts';

let store: Store;
let dispose: () => Promise<void>;
let runCounter = 0;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

async function freshRun(): Promise<string> {
  runCounter += 1;
  const slug = `scene-text-${runCounter}`;
  await beginDemoRun(store, slug);
  return slug;
}

function searchInput(request: RequestOf<'search_scenes'>) {
  return OPERATIONS.search_scenes.input.parse(request);
}

test('the outline holds no record, and says how many words each record holds', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, title: 'The mill', record: 'The miller ground  the\nlast of the barley.' }));
  await store.saveScene(sceneInput({ run: slug, title: 'The ford', record: '' }));
  await store.saveScene(sceneInput({ run: slug, title: 'The bridge', record: '   ' }));

  const outline = await store.outlineOf(slug);
  assert.deepEqual(outline.scenes.map((scene) => [scene.title, scene.recordWords]), [['The mill', 8], ['The ford', 0], ['The bridge', 0]]);
  for (const scene of outline.scenes) assert.ok(!('record' in scene), `scene ${scene.number} still carries its record`);
  // Everything else is the author's whole snapshot, as it was.
  const whole = await store.snapshotOf(slug, 'author');
  assert.deepEqual({ ...outline, scenes: [] }, { ...whole, scenes: [] });
  assert.deepEqual(outline.scenes.map(({ recordWords: _words, ...rest }) => rest), whole.scenes.map(({ record: _record, ...rest }) => rest));
});

test('words are counted as runs of anything but white space', () => {
  assert.equal(wordsIn(''), 0);
  assert.equal(wordsIn(' \n\t '), 0);
  assert.equal(wordsIn('one'), 1);
  assert.equal(wordsIn('  the miller’s wheel,\nturning  '), 4);
});

test('the outline of a run the store lacks is refused', async () => {
  await assert.rejects(store.outlineOf('no-such-run'), Refusal);
});

test("a struck take's record is read, under its own number and status", async () => {
  const slug = await freshRun();
  const earlier = await store.saveScene(sceneInput({ run: slug, title: 'The flood', record: 'The water took the mill wheel.' }));
  const redone = await store.redoScene(redoInput({ run: slug, number: 1, title: 'The dry year', record: 'No rain came.' }));

  const struck = await store.sceneTextOf({ run: slug, sceneId: earlier.scene.id });
  assert.deepEqual(struck, { sceneId: earlier.scene.id, number: 1, status: 'struck', record: 'The water took the mill wheel.' });
  const standing = await store.sceneTextOf({ run: slug, sceneId: redone.scene.id });
  assert.deepEqual(standing, { sceneId: redone.scene.id, number: 1, status: 'standing', record: 'No rain came.' });
});

test("a scene of another run, an unknown id and a word that is not an id are each refused in the store's own words", async () => {
  const slug = await freshRun();
  const otherSlug = await freshRun();
  const elsewhere = await store.saveScene(sceneInput({ run: otherSlug, record: 'Elsewhere.' }));
  for (const sceneId of [elsewhere.scene.id, '00000000-0000-4000-8000-000000000000', 'scene-one']) {
    await assert.rejects(store.sceneTextOf({ run: slug, sceneId }), (error: unknown) => {
      assert.ok(error instanceof Refusal);
      assert.equal(error.message, `The run "${slug}" holds no scene with the id "${sceneId}".`);
      return true;
    });
  }
  await assert.rejects(store.sceneTextOf({ run: 'no-such-run', sceneId: elsewhere.scene.id }), Refusal);
});

test('a search finds a phrase that is only in a record, case-blind, with an excerpt around it', async () => {
  const slug = await freshRun();
  const longRecord = `${'The wheel turned and the sacks were filled one by one. '.repeat(4)}Then the Miller Sang of the old ford, slowly. ${'Flour drifted over the floor and settled on every beam. '.repeat(4)}`;
  const saved = await store.saveScene(sceneInput({ run: slug, title: 'The mill', summary: 'Work at the mill.', record: longRecord }));
  await store.saveScene(sceneInput({ run: slug, title: 'The ford', summary: 'Nobody sang.' }));

  const result = await store.searchScenes(searchInput({ run: slug, text: 'miller sang' }));
  assert.equal(result.total, 1);
  const match = result.matches[0]!;
  assert.equal(match.sceneId, saved.scene.id);
  assert.equal(match.field, 'record');
  assert.equal(match.excerpt.slice(match.matchStart, match.matchStart + match.matchLength), 'Miller Sang');
  assert.ok(match.excerpt.startsWith('…') && match.excerpt.endsWith('…'), match.excerpt);
  assert.ok(match.excerpt.length <= 170, `the excerpt is ${match.excerpt.length} characters`);
  // Cut on word boundaries: no word is cut in half at either end.
  const inner = match.excerpt.slice(1, -1);
  assert.ok(longRecord.includes(inner), inner);
  assert.ok(longRecord.includes(` ${inner} `), `the excerpt "${inner}" was cut inside a word`);
});

test('a search names the first field holding the text, and answers newest first', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, title: 'The ferry', summary: 'The ferry ran.' }));
  await store.saveScene(sceneInput({ run: slug, title: 'Morning', summary: 'A quiet start.', steer: 'Keep the ferry offstage.' }));
  await store.saveScene(sceneInput({ run: slug, title: 'Evening', summary: 'Rain.', situationAfter: 'The ferry is moored.' }));

  const result = await store.searchScenes(searchInput({ run: slug, text: 'FERRY' }));
  assert.deepEqual(result.matches.map((match) => [match.number, match.field]), [[3, 'situationAfter'], [2, 'steer'], [1, 'title']]);
});

test('a search leaves struck takes out unless they are asked for', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, title: 'The weir', record: 'The weir broke at dawn.' }));
  await store.redoScene(redoInput({ run: slug, number: 1, title: 'The weir holds', record: 'It held.' }));

  const standingOnly = await store.searchScenes(searchInput({ run: slug, text: 'broke' }));
  assert.deepEqual(standingOnly, { matches: [], total: 0 });
  const withStruck = await store.searchScenes(searchInput({ run: slug, text: 'broke', includeStruck: true }));
  assert.equal(withStruck.total, 1);
  assert.equal(withStruck.matches[0]!.status, 'struck');
  assert.equal(withStruck.matches[0]!.title, 'The weir');
});

test('a search honours its limit and still counts every match', async () => {
  const slug = await freshRun();
  for (let number = 1; number <= 5; number += 1) {
    await store.saveScene(sceneInput({ run: slug, title: `Bread ${number}`, summary: 'The baker baked.' }));
  }
  const result = await store.searchScenes(searchInput({ run: slug, text: 'baker', limit: 2 }));
  assert.equal(result.total, 5);
  assert.deepEqual(result.matches.map((match) => match.number), [5, 4]);
});

test('a search reads %, _ and \\ as themselves', async () => {
  const slug = await freshRun();
  await store.saveScene(sceneInput({ run: slug, title: 'The tithe', summary: 'A tithe of 10% was taken.' }));
  await store.saveScene(sceneInput({ run: slug, title: 'The ledger', summary: 'A tithe of 10 sacks was taken.' }));
  await store.saveScene(sceneInput({ run: slug, title: 'The mark', summary: 'He wrote mill_one and a\\b on the door.' }));

  assert.deepEqual((await store.searchScenes(searchInput({ run: slug, text: '10%' }))).matches.map((match) => match.title), ['The tithe']);
  assert.equal((await store.searchScenes(searchInput({ run: slug, text: '% w' }))).total, 1);
  assert.deepEqual((await store.searchScenes(searchInput({ run: slug, text: 'ti_he' }))).matches, []);
  assert.deepEqual((await store.searchScenes(searchInput({ run: slug, text: 'l_one' }))).matches.map((match) => match.title), ['The mark']);
  assert.deepEqual((await store.searchScenes(searchInput({ run: slug, text: 'a\\b' }))).matches.map((match) => match.title), ['The mark']);
  assert.deepEqual((await store.searchScenes(searchInput({ run: slug, text: 'a\\' }))).matches.map((match) => match.title), ['The mark']);
});

test('a search of a run the store lacks is refused', async () => {
  await assert.rejects(store.searchScenes(searchInput({ run: 'no-such-run', text: 'mill' })), Refusal);
});

test('the LIKE pattern escapes its three special characters', () => {
  assert.equal(likePatternHolding('a%b_c\\d'), '%a\\%b\\_c\\\\d%');
});

test('an excerpt of a short field is the whole field, and the match offset is kept', () => {
  assert.deepEqual(excerptAround('The miller sang.', 4, 6), { excerpt: 'The miller sang.', matchStart: 4, matchLength: 6 });
  const lineBroken = excerptAround('First line.\nThe miller sang.', 16, 6);
  assert.equal(lineBroken.excerpt, 'First line. The miller sang.');
  assert.equal(lineBroken.excerpt.slice(lineBroken.matchStart, lineBroken.matchStart + 6), 'miller');
});
