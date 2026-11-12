import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ImportedRun, Store } from '@timeweft/contract';
import { openStoreForTests } from './index.ts';
import { sceneInput, stateFactInput } from './demo-world.ts';

let store: Store;
let dispose: () => Promise<void>;

before(async () => {
  ({ store, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

const MARKER = 'HIDDEN-MARKER-7f3a';

function runWithAHiddenEntry(slug: string): ImportedRun {
  return {
    slug, title: 'The Ford', setting: 'A river valley.', status: 'binding', register: '',
    clocks: [], scenes: [
      { number: 1, title: 'The flood', starred: false, whenTyped: 'day one', place: `the ${MARKER} cellar`, summary: 'Water rose.', record: '', steer: '', situationAfter: '', readings: [] },
    ],
    entries: [
      { name: 'Wren the baker', kind: 'person', alsoKnownAs: [], pronoun: 'she', introducedInScene: 1, visibility: 'open',
        facts: [{ property: 'state', value: 'baking', fromScene: 1, source: 'import', note: '' }],
        trail: [{ scene: 1, text: 'She baked through the flood.' }] },
      { name: `the ${MARKER} cellar`, kind: 'place', alsoKnownAs: [], pronoun: '', introducedInScene: 1, visibility: 'author-only',
        facts: [{ property: 'what', value: `a vault ${MARKER}`, fromScene: 1, source: 'author', note: MARKER }],
        trail: [{ scene: 1, text: `Something waits ${MARKER}.` }] },
    ],
    rulings: [{ text: 'Keep it plain.', source: 'author', scope: 'run', topics: [], about: ['Wren the baker', `the ${MARKER} cellar`], scene: 1 }],
    threads: [{ text: 'What is below the mill?', about: [`the ${MARKER} cellar`, 'Wren the baker'], openedInScene: 1, closed: false, resolution: '' }],
    waypoints: [{ text: 'The baker finds the door.', reached: false }],
    legs: [], unplaced: [],
  };
}

test('a story snapshot holds nothing author-only, and the author snapshot holds all of it', async () => {
  const slug = 'hidden-cellar';
  await store.importRun(runWithAHiddenEntry(slug));
  await store.stateFact(stateFactInput({ run: slug, entry: 'Wren the baker', property: 'secret', value: `knows the ${MARKER}`, visibility: 'author-only', note: MARKER }));
  await store.stateFact(stateFactInput({ run: slug, entry: 'Wren the baker', property: 'kin', value: 'sister of the cellar', about: `the ${MARKER} cellar` }));
  const saved = await store.saveScene(sceneInput({ run: slug, facts: [
    { entry: 'Wren the baker', property: 'secret', value: 'nothing' },
    { entry: 'Wren the baker', property: 'kin', value: 'nobody' },
  ] }));
  assert.equal(saved.collisions.length, 1, 'only the open author fact collides; the author-only lane is out of a story\'s sight');
  assert.equal(saved.collisions[0]!.property, 'kin');
  assert.deepEqual(saved.factsWritten.map((fact) => [fact.property, fact.value, fact.visibility]), [['secret', 'nothing', 'open']]);

  const story = await store.snapshotOf(slug, 'story');
  const author = await store.snapshotOf(slug, 'author');
  assert.ok(!JSON.stringify(story).includes(MARKER), 'the marker reached the story');
  assert.ok(JSON.stringify(author).includes(MARKER));

  const hiddenId = author.entries.find((entry) => entry.visibility === 'author-only')!.id;
  assert.ok(!JSON.stringify(story).includes(hiddenId), 'no id of the hidden entry reaches the story');
  assert.equal(story.collisions.length, 0);
  assert.equal(author.collisions.length, 1);
  assert.equal(story.rulings[0]!.aboutEntryIds.length, 1);
  assert.equal(story.threads[0]!.aboutEntryIds.length, 1);
  assert.equal(story.scenes[0]!.placeEntryId, null);
  assert.equal(story.waypoints.length, 1, 'waypoints steer the writer, so a story gets them');
});

test('a story save cannot name an author-only entry', async () => {
  const slug = 'hidden-cellar-two';
  await store.importRun(runWithAHiddenEntry(slug));
  await assert.rejects(store.saveScene(sceneInput({ run: slug, notes: [{ entry: `the ${MARKER} cellar`, text: 'Found it.' }] })),
    /Nothing in this run is called/);
});
