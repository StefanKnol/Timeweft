import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';
import type { Briefing, RunSnapshot } from '@timeweft/contract';
import { buildBriefing } from './briefing.ts';
import { threadsOpenFor } from './readers.ts';
import { fact, generateRun, millerRun, momentAfter, note, scene, thread } from './demo-run.ts';

function sectionTextOf(briefing: Briefing, heading: string): string {
  const start = briefing.text.indexOf(`## ${heading}\n`);
  if (start < 0) return '';
  const next = briefing.text.indexOf('\n## ', start + 3);
  return briefing.text.slice(start, next < 0 ? undefined : next + 1);
}

/** The miller run with three later scenes, so that threads and trail notes can be newer than scene 3. */
function millerRunWithLaterScenes(): RunSnapshot {
  const snapshot = millerRun();
  snapshot.scenes.push(
    scene({ id: 'scene-4', number: 4, title: 'The bridge' }),
    scene({ id: 'scene-5', number: 5, title: 'The weir' }),
    scene({ id: 'scene-6', number: 6, title: 'The bakery' }),
  );
  return snapshot;
}

describe('the open threads, as a fresh chat meets them', () => {
  it('ranks threads about the upcoming entries first, then by the scene they were opened in, newest first', () => {
    const snapshot = millerRunWithLaterScenes();
    // All written in one batch, so that only the opening scene and the written order can tell them apart.
    const batch = momentAfter(1000);
    snapshot.threads = [
      thread({ id: 'aa-oldest', text: 'Was the ford ever bridged?', openedInSceneId: 'scene-1', createdAt: batch }),
      thread({ id: 'zz-newest', text: 'Who left bread on the weir?', openedInSceneId: 'scene-5', createdAt: batch }),
      thread({ id: 'mm-middle', text: 'Why is the bakery shut?', openedInSceneId: 'scene-3', createdAt: batch }),
      thread({ id: 'bb-about-the-miller', text: 'Will the millstone crack?', openedInSceneId: 'scene-2', aboutEntryIds: ['entry-miller'], createdAt: batch }),
    ];
    const threads = sectionTextOf(buildBriefing(snapshot, { upcoming: ['Wenna the miller'], budgetBytes: 20_000 }), 'Open threads');
    const order = ['millstone', 'bread on the weir', 'bakery shut', 'ever bridged'].map((words) => threads.indexOf(words));
    assert.ok(order.every((position) => position >= 0), threads);
    assert.deepEqual([...order].sort((left, right) => left - right), order, threads);
  });

  it('ranks a thread with no known opening scene after every dated one, the latest written first, never by id', () => {
    const snapshot = millerRunWithLaterScenes();
    const batch = momentAfter(1000);
    snapshot.threads = [
      thread({ id: 'dd-prologue', text: 'Who built the mill?', openedInSceneId: 'scene-0', createdAt: batch }),
      thread({ id: 'zz-undated-first', text: 'Who owns the mill pond?', openedInSceneId: null, createdAt: batch }),
      thread({ id: 'aa-dated', text: 'Where did the ferry go?', openedInSceneId: 'scene-1', createdAt: batch }),
      thread({ id: 'yy-undated-second', text: 'Will the baker marry?', openedInSceneId: 'scene-not-in-the-run', createdAt: batch }),
      thread({ id: 'bb-same-scene-first', text: 'What sank at the ford?', openedInSceneId: 'scene-4', createdAt: batch }),
      thread({ id: 'cc-same-scene-second', text: 'Who rang the bell?', openedInSceneId: 'scene-4', createdAt: batch }),
    ];
    snapshot.scenes.push(scene({ id: 'scene-0', number: 0, title: 'The prologue' }));
    const threads = sectionTextOf(buildBriefing(snapshot, { upcoming: [], budgetBytes: 20_000 }), 'Open threads');
    const order = ['rang the bell', 'sank at the ford', 'ferry go', 'built the mill', 'baker marry', 'mill pond'].map((words) => threads.indexOf(words));
    assert.ok(order.every((position) => position >= 0), threads);
    assert.deepEqual([...order].sort((left, right) => left - right), order, threads);
  });
});

describe('the threads a reader lists', () => {
  it('keeps two threads of one scene and one batch in the order they were written, never by id', () => {
    const snapshot = millerRun();
    const batch = momentAfter(1000);
    snapshot.threads = [
      thread({ id: 'zz-written-first', text: 'Who mends the nets?', openedInSceneId: 'scene-3', createdAt: batch }),
      thread({ id: 'aa-written-second', text: 'Who feeds the geese?', openedInSceneId: 'scene-3', createdAt: batch }),
    ];
    assert.deepEqual(threadsOpenFor(snapshot, { aboutEntryIds: [], includeClosed: false }).map((each) => each.id), ['zz-written-first', 'aa-written-second']);
  });
});

describe('a last seen fact the trail has gone on from', () => {
  /** The ferry keeper last seen at the bridge in scene 4, his newest fact, with a trail note on to scene 6. */
  function keeperWithAnOldLastSeen(): RunSnapshot {
    const snapshot = millerRunWithLaterScenes();
    snapshot.facts.push(fact({ id: 'fact-keeper-last-seen', entryId: 'entry-keeper', property: 'Last seen',
      value: 'scene 4, at the bridge', fromSceneId: 'scene-4', createdAt: momentAfter(4) }));
    snapshot.notes.push(note({ id: 'note-keeper-6', entryId: 'entry-keeper', sceneId: 'scene-6',
      text: 'Bought a loaf at the bakery.', createdAt: momentAfter(6) }));
    return snapshot;
  }

  it('says the trail goes on past it, so it is never read as where the entry is now', () => {
    const page = sectionTextOf(buildBriefing(keeperWithAnOldLastSeen(), { upcoming: ['Bram'], budgetBytes: 20_000 }), 'On the page next');
    assert.match(page, /- Last seen \(since scene 4; its trail goes on to scene 6\): scene 4, at the bridge/);
    assert.ok(page.includes('Bought a loaf at the bakery.'));
  });

  it('serves the newest trail note before the overtaken fact when room is short', () => {
    const snapshot = keeperWithAnOldLastSeen();
    let sawOnlyTheNote = false;
    for (let budgetBytes = 1200; budgetBytes <= 6000; budgetBytes += 50) {
      const page = sectionTextOf(buildBriefing(snapshot, { upcoming: ['Bram'], budgetBytes }), 'On the page next');
      const hasFact = page.includes('- Last seen (');
      const hasNote = page.includes('Bought a loaf');
      assert.ok(!hasFact || hasNote, `at ${budgetBytes} bytes the overtaken fact was served without the newer note:\n${page}`);
      if (hasNote && !hasFact) sawOnlyTheNote = true;
    }
    assert.ok(sawOnlyTheNote, 'some budget serves the newest note and not the overtaken fact');
  });

  it('says nothing more where the last seen fact is as new as the trail', () => {
    const snapshot = millerRunWithLaterScenes();
    snapshot.facts.push(fact({ id: 'fact-keeper-last-seen', entryId: 'entry-keeper', property: 'last seen',
      value: 'scene 3, in the loft', fromSceneId: 'scene-3', createdAt: momentAfter(3) }));
    const page = sectionTextOf(buildBriefing(snapshot, { upcoming: ['Bram'], budgetBytes: 20_000 }), 'On the page next');
    assert.match(page, /- last seen \(since scene 3\): scene 3, in the loft/);
    assert.ok(!page.includes('trail goes on'));
  });

  it('leaves another property alone however old it is', () => {
    const page = sectionTextOf(buildBriefing(keeperWithAnOldLastSeen(), { upcoming: ['Bram'], budgetBytes: 20_000 }), 'On the page next');
    assert.match(page, /- standing \(since scene 2\): grateful/);
  });

  it('keeps every briefing within its budget', () => {
    const snapshot = generateRun({ scenes: 120, entries: 30, factsPerEntry: 12, notesPerEntry: 10, rulings: 20, threads: 40, clocks: 2, waypoints: 4, seed: 31 });
    for (const generatedEntry of snapshot.entries.slice(0, 10)) {
      snapshot.facts.push(fact({ id: `fact-last-seen-${generatedEntry.id}`, entryId: generatedEntry.id, property: 'Last seen',
        value: 'long ago, by the ford', fromSceneId: null }));
    }
    for (const budgetBytes of [2000, 3000, 6000, 20_000, 80_000]) {
      for (const upcoming of [[], snapshot.entries.slice(0, 4).map((each) => each.name)]) {
        const briefing = buildBriefing(snapshot, { upcoming, budgetBytes });
        assert.ok(Buffer.byteLength(briefing.text, 'utf8') <= budgetBytes, `${budgetBytes}: ${Buffer.byteLength(briefing.text, 'utf8')}`);
      }
    }
  });
});
