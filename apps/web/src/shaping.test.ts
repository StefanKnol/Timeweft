import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CollisionRecord, EntryNoteRecord, EntryRecord, FactRecord, RulingRecord, RunSnapshot, SceneRecord,
  ThreadRecord,
} from '@timeweft/contract';
import {
  budgetFromText, collisionsWithBothSides, entriesGroupedByKind, factsOfEntryByProperty, hashOfRoute,
  heldSpanInWords, isAuthorOnly, outcomeOfResponse, readingsWithClockNames, routeFromHash,
  routeOfOperation, rulingsMatching, scenesByNumber, sizeInWords, threadsOpenFirst, trailOfEntry,
  upcomingNamesFromText, waypointsAheadFirst, journeysInSceneOrder, whatASceneEstablished,
} from './shaping.ts';

// A made-up demo world: a miller, a ferry, a ford and a lantern.

function scene(id: string, number: number, status: 'standing' | 'struck', createdAt: string): SceneRecord {
  return {
    id, runId: 'run', number, title: `Scene ${id}`, starred: false, whenTyped: 'morning', placeEntryId: null,
    summary: '', record: '', steer: '', situationAfter: '', status, readings: [], createdAt,
  };
}

function entry(id: string, name: string, kind: EntryRecord['kind'], introducedInSceneId: string | null = null): EntryRecord {
  return {
    id, runId: 'run', kind, name, alsoKnownAs: [], pronoun: '', introducedInSceneId, source: 'story',
    visibility: 'open', createdAt: '2026-01-01T00:00:00Z',
  };
}

function fact(id: string, entryId: string, property: string, value: string, fromSceneId: string | null, untilSceneId: string | null, createdAt: string, aboutEntryId: string | null = null): FactRecord {
  return {
    id, entryId, property, value, aboutEntryId, fromSceneId, untilSceneId, source: 'story',
    visibility: 'open', note: '', createdAt,
  };
}

function note(id: string, entryId: string, sceneId: string, text: string, createdAt: string): EntryNoteRecord {
  return { id, entryId, sceneId, text, visibility: 'open', createdAt };
}

function ruling(id: string, number: number, text: string, topics: string[], sceneId: string | null = null): RulingRecord {
  return {
    id, runId: 'run', number, text, source: 'author', scope: 'run', topics, aboutEntryIds: [], sceneId,
    withdrawnInSceneId: null, createdAt: '2026-01-01T00:00:00Z',
  };
}

function thread(id: string, text: string, openedInSceneId: string | null, closedInSceneId: string | null, createdAt: string): ThreadRecord {
  return {
    id, runId: 'run', text, aboutEntryIds: [], openedInSceneId, closedInSceneId, resolution: closedInSceneId ? 'It was settled.' : '',
    touches: [], lastTouchedInSceneId: closedInSceneId ?? openedInSceneId, createdAt,
  };
}

function demoSnapshot(): RunSnapshot {
  const scenes = [
    scene('s1', 1, 'standing', '2026-01-01T00:00:01Z'),
    scene('s2-old', 2, 'struck', '2026-01-01T00:00:02Z'),
    scene('s2', 2, 'standing', '2026-01-01T00:00:03Z'),
    scene('s3', 3, 'standing', '2026-01-01T00:00:04Z'),
  ];
  const entries = [
    entry('miller', 'the miller', 'person', 's1'),
    entry('ford', 'the ford', 'place', 's1'),
    entry('ferry', 'the ferry', 'place'),
    entry('lantern', 'a lantern', 'item', 's2'),
  ];
  const facts = [
    fact('f1', 'lantern', 'held by', 'the miller', 's2', 's3', '2026-01-01T00:00:10Z', 'miller'),
    fact('f2', 'lantern', 'held by', 'left at the ford', 's3', null, '2026-01-01T00:00:12Z', 'ford'),
    fact('f0', 'lantern', 'state', 'cracked', null, 's2', '2026-01-01T00:00:09Z'),
    fact('f3', 'lantern', 'state', 'mended', 's2', null, '2026-01-01T00:00:11Z'),
    fact('f4', 'miller', 'standing', 'owes the ferry a toll', 's1', null, '2026-01-01T00:00:05Z'),
  ];
  return {
    run: {
      id: 'run', slug: 'the-mill', title: 'The mill', setting: 'A river valley', status: 'binding',
      continuesRunId: null, register: 'plain', createdAt: '2026-01-01T00:00:00Z',
    },
    clocks: [{ id: 'days', runId: 'run', name: 'days at the mill', countsFrom: 'arrival' }],
    scenes,
    entries,
    facts,
    notes: [
      note('n2', 'lantern', 's3', 'Left at the ford.', '2026-01-01T00:00:20Z'),
      note('n1', 'lantern', 's2', 'Found in the loft.', '2026-01-01T00:00:19Z'),
    ],
    rulings: [
      ruling('r2', 2, 'Tolls are paid in grain.', ['practice'], 's1'),
      ruling('r1', 1, 'Narrate in the past tense.', ['narration']),
    ],
    threads: [
      thread('t-closed', 'Will the toll be paid?', 's1', 's3', '2026-01-01T00:00:06Z'),
      thread('t-later', 'Who cracked the lantern?', 's2', null, '2026-01-01T00:00:13Z'),
      thread('t-early', 'Where does the ferry go at night?', 's1', null, '2026-01-01T00:00:07Z'),
    ],
    waypoints: [
      { id: 'w-reached', runId: 'run', text: 'The miller pays the toll.', reachedInSceneId: 's3', createdAt: '2026-01-01T00:00:30Z' },
      { id: 'w-ahead', runId: 'run', text: 'The ford floods.', reachedInSceneId: null, createdAt: '2026-01-01T00:00:31Z' },
      { id: 'w-struck', runId: 'run', text: 'The lantern breaks.', reachedInSceneId: 's2-old', createdAt: '2026-01-01T00:00:32Z' },
    ],
    legs: [
      { id: 'leg-later', runId: 'run', fromPlace: 'the ford', toPlace: 'the ferry', duration: 'an hour', note: '', sceneId: 's3', createdAt: '2026-01-01T00:00:41Z' },
      { id: 'leg-early', runId: 'run', fromPlace: 'the mill', toPlace: 'the ford', duration: 'half a morning', note: 'on foot', sceneId: 's2', createdAt: '2026-01-01T00:00:40Z' },
      { id: 'leg-struck', runId: 'run', fromPlace: 'the mill', toPlace: 'the ferry', duration: 'a day', note: '', sceneId: 's2-old', createdAt: '2026-01-01T00:00:39Z' },
      { id: 'leg-undated', runId: 'run', fromPlace: 'the ferry', toPlace: 'the sea', duration: 'a week', note: '', sceneId: null, createdAt: '2026-01-01T00:00:38Z' },
    ],
    collisions: [],
  };
}

test('scenes by number keep a struck take under its number and the standing take on top', () => {
  const slots = scenesByNumber(demoSnapshot().scenes);
  assert.deepEqual(slots.map((slot) => slot.number), [1, 2, 3]);
  assert.equal(slots[1]?.standing?.id, 's2');
  assert.deepEqual(slots[1]?.struck.map((scene) => scene.id), ['s2-old']);
  assert.deepEqual(slots[0]?.struck, []);
});

test('scenes by number leave the standing take empty where every take was struck', () => {
  const slots = scenesByNumber([scene('a', 4, 'struck', '2026-01-01T00:00:01Z'), scene('b', 4, 'struck', '2026-01-01T00:00:02Z')]);
  assert.equal(slots[0]?.standing, null);
  assert.deepEqual(slots[0]?.struck.map((scene) => scene.id), ['a', 'b']);
});

test('scenes by number order by number whatever order they arrive in', () => {
  const slots = scenesByNumber([scene('c', 10, 'standing', '2026-01-01T00:00:01Z'), scene('d', 9, 'standing', '2026-01-01T00:00:02Z')]);
  assert.deepEqual(slots.map((slot) => slot.number), [9, 10]);
});

test('facts by property put the open fact in holding and closed ones in history, oldest held first', () => {
  const properties = factsOfEntryByProperty('lantern', demoSnapshot());
  assert.deepEqual(properties.map((property) => property.property), ['state', 'held by']);
  const heldBy = properties.find((property) => property.property === 'held by');
  assert.deepEqual(heldBy?.holding.map((item) => item.fact.id), ['f2']);
  assert.deepEqual(heldBy?.history.map((item) => item.fact.id), ['f1']);
  assert.equal(heldBy?.holding[0]?.aboutName, 'the ford');
  assert.equal(heldBy?.history[0]?.fromSceneNumber, 2);
  assert.equal(heldBy?.history[0]?.untilSceneNumber, 3);
});

test('history is oldest to newest by the scene it held from, a fact from before the scenes first', () => {
  const snapshot = demoSnapshot();
  snapshot.facts.push(
    fact('g2', 'ferry', 'where', 'at the far bank', 's3', 's3', '2026-01-01T00:00:01Z'),
    fact('g1', 'ferry', 'where', 'at the near bank', 's1', 's3', '2026-01-01T00:00:30Z'),
    fact('g0', 'ferry', 'where', 'sunk', null, 's1', '2026-01-01T00:00:40Z'),
  );
  const where = factsOfEntryByProperty('ferry', snapshot)[0];
  assert.deepEqual(where?.history.map((item) => item.fact.id), ['g0', 'g1', 'g2']);
  assert.deepEqual(where?.holding, []);
});

test('several facts standing alongside under one property all hold', () => {
  const snapshot = demoSnapshot();
  snapshot.facts.push(fact('h1', 'miller', 'voice', 'gruff', 's1', null, '2026-01-01T00:01:00Z'), fact('h2', 'miller', 'voice', 'kind', 's1', null, '2026-01-01T00:01:01Z'));
  const voice = factsOfEntryByProperty('miller', snapshot).find((property) => property.property === 'voice');
  assert.deepEqual(voice?.holding.map((item) => item.fact.id), ['h1', 'h2']);
});

test('the held span is said by scene numbers', () => {
  assert.equal(heldSpanInWords(2, 3), 'from scene 2 until scene 3');
  assert.equal(heldSpanInWords(null, 2), 'from before the scenes until scene 2');
  assert.equal(heldSpanInWords(4, null), 'from scene 4, still holding');
});

test('entries are grouped in the contract order of kinds and by name within a kind', () => {
  const groups = entriesGroupedByKind(demoSnapshot().entries);
  assert.deepEqual(groups.map((group) => group.kind), ['person', 'place', 'item']);
  assert.deepEqual(groups[1]?.entries.map((entry) => entry.name), ['the ferry', 'the ford']);
});

test('the trail of an entry runs by scene number, oldest first', () => {
  const trail = trailOfEntry('lantern', demoSnapshot());
  assert.deepEqual(trail.map((item) => [item.sceneNumber, item.note.text]), [[2, 'Found in the loft.'], [3, 'Left at the ford.']]);
});

test('what a scene established is read out of the run by the scene id', () => {
  const established = whatASceneEstablished('s2', demoSnapshot());
  assert.deepEqual(established.entriesIntroduced.map((entry) => entry.id), ['lantern']);
  assert.deepEqual(established.factsEstablished.map((fact) => fact.id).sort(), ['f1', 'f3']);
  assert.deepEqual(established.notes.map((note) => note.id), ['n1']);
  assert.deepEqual(established.threadsOpened.map((thread) => thread.id), ['t-later']);
  const third = whatASceneEstablished('s3', demoSnapshot());
  assert.deepEqual(third.threadsClosed.map((thread) => thread.id), ['t-closed']);
});

test('a scene says the threads it touched with what moved, as read_scene does, and not one it closed', () => {
  const snapshot = demoSnapshot();
  snapshot.threads = snapshot.threads.map((each) => {
    if (each.id === 't-early') return { ...each, touches: [{ sceneId: 's2', note: 'Half paid in bread.' }, { sceneId: 's3', note: '' }], lastTouchedInSceneId: 's3' };
    if (each.id === 't-closed') return { ...each, touches: [{ sceneId: 's3', note: 'Paid at last.' }] };
    return each;
  });
  assert.deepEqual(whatASceneEstablished('s2', snapshot).threadsTouched.map((item) => [item.thread.id, item.note]), [['t-early', 'Half paid in bread.']]);
  assert.deepEqual(whatASceneEstablished('s3', snapshot).threadsTouched.map((item) => [item.thread.id, item.note]), [['t-early', '']]);
  assert.deepEqual(whatASceneEstablished('s1', snapshot).threadsTouched, []);
});

test('a scene establishes the journeys first travelled in it, and a struck take keeps its own', () => {
  assert.deepEqual(whatASceneEstablished('s2', demoSnapshot()).legs.map((leg) => leg.id), ['leg-early']);
  assert.deepEqual(whatASceneEstablished('s2-old', demoSnapshot()).legs.map((leg) => leg.id), ['leg-struck']);
});

test('waypoints are drawn ahead first, then reached in scene order, and one reached only in a struck take is still ahead', () => {
  const { ahead, reached } = waypointsAheadFirst(demoSnapshot());
  assert.deepEqual(ahead.map((item) => item.waypoint.id), ['w-ahead', 'w-struck']);
  assert.deepEqual(reached.map((item) => [item.waypoint.id, item.reachedInSceneNumber]), [['w-reached', 3]]);
});

test('journeys are drawn in scene order, those before the scenes first, and a struck take\'s journey is kept apart', () => {
  const { travelled, inStruckTakes } = journeysInSceneOrder(demoSnapshot());
  assert.deepEqual(travelled.map((item) => [item.leg.id, item.sceneNumber]), [['leg-undated', null], ['leg-early', 2], ['leg-later', 3]]);
  assert.deepEqual(inStruckTakes.map((item) => [item.leg.id, item.sceneNumber]), [['leg-struck', 2]]);
});

test('the journeys part of a run has its own address', () => {
  assert.deepEqual(routeFromHash('#/runs/the-mill/journeys'), { page: 'run', slug: 'the-mill', section: 'journeys', itemId: null });
});

test('a reading names its clock, and a clock the run lost is said as such', () => {
  const named = readingsWithClockNames([{ clockId: 'days', count: '3', partOfDay: 'dusk' }, { clockId: 'gone', count: '1', partOfDay: '' }], demoSnapshot().clocks);
  assert.equal(named[0]?.clockName, 'days at the mill');
  assert.equal(named[1]?.clockName, 'a clock the run no longer names');
});

test('only author-only is marked as author-only', () => {
  assert.equal(isAuthorOnly('author-only'), true);
  assert.equal(isAuthorOnly('open'), false);
});

test('rulings are by number, and a filter keeps those holding every word in text, topics or scope', () => {
  const rulings = demoSnapshot().rulings;
  assert.deepEqual(rulingsMatching(rulings, '').map((ruling) => ruling.number), [1, 2]);
  assert.deepEqual(rulingsMatching(rulings, 'GRAIN').map((ruling) => ruling.number), [2]);
  assert.deepEqual(rulingsMatching(rulings, 'narration').map((ruling) => ruling.number), [1]);
  assert.deepEqual(rulingsMatching(rulings, 'tolls narration').map((ruling) => ruling.number), []);
});

test('threads: open first, the one opened in the later scene first, closed after', () => {
  const snapshot = demoSnapshot();
  const { open, closed } = threadsOpenFirst(snapshot.threads, snapshot.scenes);
  assert.deepEqual(open.map((item) => item.thread.id), ['t-later', 't-early']);
  assert.deepEqual(closed.map((item) => item.thread.id), ['t-closed']);
  assert.equal(closed[0]?.closedInSceneNumber, 3);
});

test('threads: one opened early and touched in a later scene ranks by its touch, with what moved', () => {
  const snapshot = demoSnapshot();
  snapshot.threads = snapshot.threads.map((each) => (each.id === 't-early'
    ? { ...each, touches: [{ sceneId: 's3', note: 'The ferry was seen at the ford.' }], lastTouchedInSceneId: 's3' }
    : each));
  const { open } = threadsOpenFirst(snapshot.threads, snapshot.scenes);
  assert.deepEqual(open.map((item) => item.thread.id), ['t-early', 't-later']);
  assert.equal(open[0]?.lastTouchedInSceneNumber, 3);
  assert.equal(open[0]?.lastTouchNote, 'The ferry was seen at the ford.');
});

test('threads: of two last touched in one scene, the one opened in the newer scene first, as the briefing ranks them', () => {
  const snapshot = demoSnapshot();
  snapshot.threads = [
    thread('opened-in-three', 'Who left bread on the weir?', 's3', null, '2026-01-01T00:01:00Z'),
    { ...thread('opened-in-one', 'Who owes the miller?', 's1', null, '2026-01-01T00:01:00Z'), touches: [{ sceneId: 's3', note: 'Asked at the weir.' }], lastTouchedInSceneId: 's3' },
  ];
  assert.deepEqual(threadsOpenFirst(snapshot.threads, snapshot.scenes).open.map((item) => item.thread.id), ['opened-in-three', 'opened-in-one']);
});

test('threads: of two alike in their scenes, the later written first, as list_threads and the briefing put them', () => {
  const snapshot = demoSnapshot();
  snapshot.threads = [
    thread('written-first', 'Who mends the nets?', 's2', null, '2026-01-01T00:01:00Z'),
    thread('written-second', 'Who feeds the geese?', 's2', null, '2026-01-01T00:01:00Z'),
  ];
  assert.deepEqual(threadsOpenFirst(snapshot.threads, snapshot.scenes).open.map((item) => item.thread.id), ['written-second', 'written-first']);
});

test('threads: one with no known scene ranks after one opened in a scene numbered 0', () => {
  const snapshot = demoSnapshot();
  snapshot.scenes.push(scene('s0', 0, 'standing', '2026-01-01T00:00:00Z'));
  snapshot.threads = [
    thread('opened-in-the-prologue', 'Who built the mill?', 's0', null, '2026-01-01T00:01:00Z'),
    thread('undated', 'Who owns the pond?', null, null, '2026-01-01T00:01:00Z'),
  ];
  assert.deepEqual(threadsOpenFirst(snapshot.threads, snapshot.scenes).open.map((item) => item.thread.id), ['opened-in-the-prologue', 'undated']);
});

test('a collision is drawn with the author fact and the story side, waiting ones first', () => {
  const snapshot = demoSnapshot();
  snapshot.facts.push({ ...fact('author-fact', 'miller', 'where', 'at the mill', 's1', null, '2026-01-01T00:02:00Z', 'ford'), source: 'author' });
  const base: CollisionRecord = {
    id: 'c1', runId: 'run', sceneId: 's3', entryId: 'miller', property: 'where', standingFactId: 'author-fact',
    proposedValue: 'on the ferry', proposedAboutEntryId: 'ferry', state: 'author-kept', createdAt: '2026-01-01T00:03:00Z',
  };
  snapshot.collisions.push(base, { ...base, id: 'c2', state: 'waiting', createdAt: '2026-01-01T00:04:00Z' });
  const { waiting, settled } = collisionsWithBothSides(snapshot);
  assert.deepEqual(waiting.map((item) => item.collision.id), ['c2']);
  assert.deepEqual(settled.map((item) => item.collision.id), ['c1']);
  assert.equal(waiting[0]?.entryName, 'the miller');
  assert.equal(waiting[0]?.authorsValue, 'at the mill');
  assert.equal(waiting[0]?.authorsAboutName, 'the ford');
  assert.equal(waiting[0]?.storysValue, 'on the ferry');
  assert.equal(waiting[0]?.storysAboutName, 'the ferry');
  assert.equal(waiting[0]?.sceneNumber, 3);
});

test('upcoming names are split on commas and lines, trimmed, and kept once whatever the case', () => {
  assert.deepEqual(upcomingNamesFromText(' the miller, the ford\nThe Miller\n\n a lantern '), ['the miller', 'the ford', 'a lantern']);
  assert.deepEqual(upcomingNamesFromText('   '), []);
});

test('the budget defaults when empty and refuses what resume_run would refuse', () => {
  assert.deepEqual(budgetFromText(''), { ok: true, budgetBytes: 20000 });
  assert.deepEqual(budgetFromText('12,000'), { ok: true, budgetBytes: 12000 });
  assert.deepEqual(budgetFromText('2000'), { ok: true, budgetBytes: 2000 });
  assert.equal(budgetFromText('1999').ok, false);
  assert.equal(budgetFromText('200001').ok, false);
  assert.equal(budgetFromText('12.5').ok, false);
  assert.equal(budgetFromText('lots').ok, false);
});

test('a size is said in bytes or kilobytes', () => {
  assert.equal(sizeInWords(512), '512 bytes');
  assert.equal(sizeInWords(19840), '19.8 kB (19,840 bytes)');
});

test('the operation route is the wire prefix and the name', () => {
  assert.equal(routeOfOperation('read_run'), '/api/operations/read_run');
});

test('a response is read as an answer, a refusal, a need for the token, or a fault', () => {
  assert.deepEqual(outcomeOfResponse(200, JSON.stringify({ ok: true, answer: [1] })), { kind: 'answer', answer: [1] });
  assert.deepEqual(outcomeOfResponse(400, JSON.stringify({ ok: false, refusal: 'No run is called that.' })), { kind: 'refusal', refusal: 'No run is called that.' });
  assert.deepEqual(outcomeOfResponse(401, 'whatever'), { kind: 'access-needed' });
  assert.equal(outcomeOfResponse(500, JSON.stringify({ ok: false, refusal: 'boom' })).kind, 'fault');
  assert.equal(outcomeOfResponse(404, JSON.stringify({ ok: false, refusal: 'no such operation' })).kind, 'fault');
  assert.equal(outcomeOfResponse(502, '<html>bad gateway</html>').kind, 'fault');
  // A body too large is said in the server's own sentence, not as a fault with a status in it.
  assert.deepEqual(
    outcomeOfResponse(413, JSON.stringify({ ok: false, refusal: 'The request body is larger than 24 MB, which is the most this route takes.' })),
    { kind: 'refusal', refusal: 'The request body is larger than 24 MB, which is the most this route takes.' },
  );
  assert.equal(outcomeOfResponse(200, JSON.stringify({ answer: 1 })).kind, 'fault');
});

test('routes read and write the address after the hash, and anything strange is the run list', () => {
  assert.deepEqual(routeFromHash(''), { page: 'runs' });
  assert.deepEqual(routeFromHash('#/nonsense'), { page: 'runs' });
  assert.deepEqual(routeFromHash('#/runs/the-mill'), { page: 'run', slug: 'the-mill', section: 'scenes', itemId: null });
  assert.deepEqual(routeFromHash('#/runs/the-mill/rulings'), { page: 'run', slug: 'the-mill', section: 'rulings', itemId: null });
  assert.deepEqual(routeFromHash('#/runs/the-mill/unknown'), { page: 'run', slug: 'the-mill', section: 'scenes', itemId: null });
  const route = { page: 'run', slug: 'the-mill', section: 'scenes', itemId: 'a b/c' } as const;
  assert.deepEqual(routeFromHash(hashOfRoute(route)), route);
  assert.equal(hashOfRoute({ page: 'runs' }), '#/runs');
});

test('a thread is closed by the scene that closed it, not by having a resolution written', () => {
  const snapshot = demoSnapshot();
  const closedWithoutWords = { ...thread('t-quiet', 'Will the ford freeze?', 's1', 's2', '2026-01-01T00:00:08Z'), resolution: '' };
  const openWithWords = { ...thread('t-noted', 'Who rows the ferry?', 's1', null, '2026-01-01T00:00:09Z'), resolution: 'A draft answer.' };
  const { open, closed } = threadsOpenFirst([closedWithoutWords, openWithWords], snapshot.scenes);
  assert.deepEqual(open.map((item) => item.thread.id), ['t-noted']);
  assert.deepEqual(closed.map((item) => item.thread.id), ['t-quiet']);
});
