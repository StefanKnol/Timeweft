import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CollisionRecord, EntryNoteRecord, EntryRecord, FactRecord, RulingRecord, RunSnapshot, SceneRecord,
  ThreadRecord,
} from '@timeweft/contract';
import {
  budgetFromText, collisionsWithBothSides, entriesGroupedByKind, factsOfEntryByProperty, hashOfRoute,
  heldSpanInWords, isAuthorOnly, outcomeOfResponse, readingsWithClockNames, routeFromHash,
  routeOfOperation, rulingsMatching, scenesByNumber, sizeInWords, threadLastTouchInWords, threadsOpenFirst, trailOfEntry, quotedNamesInWords, quotedValueInWords, rowsForLinesOf, waypointMoveInWords,
  upcomingNamesFromText, waypointsAheadFirst, journeysInSceneOrder, whatASceneEstablished,
  asOfNowInWords, cautionsOfAnswer, entriesARulingMayName, entriesAThreadMayBeAbout, entryDetailsFormOf, entryEditToSend, entryHistoryInWords,
  factToSend, lastingActInWords, newEntryToSend, newestStandingScene, renameToSend, runDetailsFormOf, runEditToSend,
  runHistoryInWords, rulingToSend, rulingsSplitByWithdrawal, standingSceneNumbers, typedTextOrReason, whyAnActNeedsAScene,
  EMPTY_FACT_FORM,
  LARGEST_BACKUP_FILE_BYTES_READ, LARGEST_RESTORE_BODY_BYTES, REPLACE_ON_RESTORE_SENTENCE, bodyBytesOf, backupDownloadOf, restoreButtonText, restoreToSend,
  restoredInWords, runRowCountsInWords, whyBackupFileCannotStart,
  megabytesInWords,
} from './shaping.ts';
import { RUN_EXPORT_TABLE_NAMES, runExportDocumentAsText, type RestoredRunReport, type RunExportDocument, type RunExportRowCounts, type RunRecord } from '@timeweft/contract';

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
      { id: 'w-reached', runId: 'run', text: 'The miller pays the toll.', reachedInSceneId: 's3', withdrawnInSceneId: null, createdAt: '2026-01-01T00:00:30Z' },
      { id: 'w-ahead', runId: 'run', text: 'The ford floods.', reachedInSceneId: null, withdrawnInSceneId: null, createdAt: '2026-01-01T00:00:31Z' },
      { id: 'w-struck', runId: 'run', text: 'The lantern breaks.', reachedInSceneId: 's2-old', withdrawnInSceneId: null, createdAt: '2026-01-01T00:00:32Z' },
    ],
    legs: [
      { id: 'leg-later', runId: 'run', fromPlace: 'the ford', toPlace: 'the ferry', duration: 'an hour', note: '', sceneId: 's3', createdAt: '2026-01-01T00:00:41Z' },
      { id: 'leg-early', runId: 'run', fromPlace: 'the mill', toPlace: 'the ford', duration: 'half a morning', note: 'on foot', sceneId: 's2', createdAt: '2026-01-01T00:00:40Z' },
      { id: 'leg-struck', runId: 'run', fromPlace: 'the mill', toPlace: 'the ferry', duration: 'a day', note: '', sceneId: 's2-old', createdAt: '2026-01-01T00:00:39Z' },
      { id: 'leg-undated', runId: 'run', fromPlace: 'the ferry', toPlace: 'the sea', duration: 'a week', note: '', sceneId: null, createdAt: '2026-01-01T00:00:38Z' },
    ],
    collisions: [],
    runEdits: [],
    entryEdits: [],
    waypointRewordings: [],
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

test('threads: a touch at the scene the thread opened in is still drawn, with its note', () => {
  const snapshot = demoSnapshot();
  snapshot.threads = snapshot.threads.map((each) => (each.id === 't-later'
    ? { ...each, touches: [{ sceneId: each.openedInSceneId!, note: 'The baker promises coin by market day.' }], lastTouchedInSceneId: each.openedInSceneId }
    : each));
  const { open } = threadsOpenFirst(snapshot.threads, snapshot.scenes);
  const touched = open.find((item) => item.thread.id === 't-later')!;
  assert.equal(touched.openedInSceneNumber, touched.lastTouch?.sceneNumber);
  assert.equal(threadLastTouchInWords(touched), `Last touched at scene ${touched.openedInSceneNumber}: The baker promises coin by market day.`);
  const untouched = open.find((item) => item.thread.id === 't-early')!;
  assert.equal(threadLastTouchInWords(untouched), '');
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

// ---------------------------------------------------------------------------------------------
// The author's hand

test('an act outside a scene is dated to the newest standing scene, and a struck take is never it', () => {
  const snapshot = demoSnapshot();
  snapshot.scenes.push(scene('s4-struck', 4, 'struck', '2026-01-01T00:00:05Z'));
  assert.equal(newestStandingScene(snapshot)?.id, 's3');
  assert.equal(asOfNowInWords(snapshot), 'as of scene 3');
  assert.equal(whyAnActNeedsAScene(snapshot), null);
  assert.deepEqual(standingSceneNumbers(snapshot), [1, 2, 3]);
});

test('with no standing scene, an act that must stop at a scene says why it waits', () => {
  const snapshot = demoSnapshot();
  snapshot.scenes = [scene('only-struck', 1, 'struck', '2026-01-01T00:00:01Z')];
  assert.equal(newestStandingScene(snapshot), null);
  assert.equal(asOfNowInWords(snapshot), 'before the scenes');
  assert.match(whyAnActNeedsAScene(snapshot) ?? '', /no scene yet/);
  assert.deepEqual(standingSceneNumbers(snapshot), []);
});

test('a withdrawn waypoint leaves ahead and reached for its own list, with its earlier wordings oldest first', () => {
  const snapshot = demoSnapshot();
  snapshot.waypoints.push({ id: 'w-withdrawn', runId: 'run', text: 'The ferry sinks.', reachedInSceneId: 's1', withdrawnInSceneId: 's2', createdAt: '2026-01-01T00:00:33Z' });
  snapshot.waypointRewordings = [
    { id: 'rw2', runId: 'run', waypointId: 'w-withdrawn', earlierText: 'The ferry tips.', laterText: 'The ferry sinks.', afterSceneId: 's1', createdAt: '2026-01-01T00:00:35Z' },
    { id: 'rw1', runId: 'run', waypointId: 'w-withdrawn', earlierText: 'The ferry leaks.', laterText: 'The ferry tips.', afterSceneId: null, createdAt: '2026-01-01T00:00:34Z' },
  ];
  const { ahead, reached, withdrawn } = waypointsAheadFirst(snapshot);
  assert.deepEqual(ahead.map((item) => item.waypoint.id), ['w-ahead', 'w-struck']);
  assert.deepEqual(reached.map((item) => item.waypoint.id), ['w-reached']);
  assert.deepEqual(withdrawn.map((item) => [item.waypoint.id, item.withdrawnInSceneNumber, item.reachedInSceneNumber]), [['w-withdrawn', 2, 1]]);
  assert.deepEqual(withdrawn[0]?.earlierWordings, [
    { text: 'The ferry leaks.', changedAfterSceneNumber: null },
    { text: 'The ferry tips.', changedAfterSceneNumber: 1 },
  ]);
});

test('editing the run sends only what changed, keeps the setting and register as typed, and refuses an empty title', () => {
  const { run } = demoSnapshot();
  const form = runDetailsFormOf(run);
  assert.deepEqual(runEditToSend('the-mill', run, form), { ok: false, reason: 'Nothing here differs from what the run holds.' });
  const changed = runEditToSend('the-mill', run, { ...form, title: '  The mill race ', setting: '  A valley.\n', register: ' plain,\npast tense\n' });
  assert.deepEqual(changed, { ok: true, input: { run: 'the-mill', title: 'The mill race', setting: '  A valley.\n', register: ' plain,\npast tense\n' } });
  assert.deepEqual(runEditToSend('the-mill', run, { ...form, status: 'telling' }), { ok: true, input: { run: 'the-mill', status: 'telling' } });
  assert.equal(runEditToSend('the-mill', run, { ...form, title: '   ' }).ok, false);
});

test('the run\'s history is oldest first, with both values and the scene it changed after', () => {
  const snapshot = demoSnapshot();
  snapshot.runEdits = [
    { id: 'e2', runId: 'run', field: 'status', earlierValue: 'binding', laterValue: 'telling', afterSceneId: 's3', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'e1', runId: 'run', field: 'title', earlierValue: 'A mill', laterValue: 'The mill', afterSceneId: null, createdAt: '2026-01-01T00:00:00Z' },
  ];
  assert.deepEqual(runHistoryInWords(snapshot), [
    { label: 'Title', earlier: '\u201cA mill\u201d', later: '\u201cThe mill\u201d', changedAfterSceneNumber: null },
    { label: 'Status', earlier: '\u201cbinding\u201d', later: '\u201ca telling\u201d', changedAfterSceneNumber: 3 },
  ]);
});

test('an entry\'s history reads a list of other names written as JSON, and a visibility in words', () => {
  const snapshot = demoSnapshot();
  snapshot.entryEdits = [
    { id: 'x1', runId: 'run', entryId: 'miller', field: 'alsoKnownAs', earlierValue: '[]', laterValue: '["the old miller","Wynn, the elder"]', afterSceneId: 's1', createdAt: '2026-01-01T00:00:01Z' },
    { id: 'x2', runId: 'run', entryId: 'miller', field: 'visibility', earlierValue: 'open', laterValue: 'author-only', afterSceneId: 's2', createdAt: '2026-01-01T00:00:02Z' },
    { id: 'x3', runId: 'run', entryId: 'ford', field: 'pronoun', earlierValue: '', laterValue: 'it', afterSceneId: null, createdAt: '2026-01-01T00:00:03Z' },
  ];
  assert.deepEqual(entryHistoryInWords('miller', snapshot), [
    { label: 'Other names', earlier: 'nothing recorded', later: '\u201cthe old miller\u201d, \u201cWynn, the elder\u201d', changedAfterSceneNumber: 1 },
    { label: 'Who sees it', earlier: '\u201copen\u201d', later: '\u201cauthor only\u201d', changedAfterSceneNumber: 2 },
  ]);
  // A pronoun that was empty is said as nothing recorded, never as a typed word in quotation marks.
  assert.deepEqual(entryHistoryInWords('ford', snapshot).map((change) => [change.earlier, change.later]), [['nothing recorded', '\u201cit\u201d']]);
});

test('other names are each in their own quotation marks, so a name holding a comma reads as one name', () => {
  assert.equal(quotedNamesInWords(['the wheel', 'Old Paddle, the slow one']), '\u201cthe wheel\u201d, \u201cOld Paddle, the slow one\u201d');
  assert.equal(quotedNamesInWords([]), 'nothing recorded');
  assert.equal(quotedValueInWords(''), 'nothing recorded');
});

test('a box of names one per line has a row for every line and one more, never fewer than two', () => {
  assert.equal(rowsForLinesOf(''), 2);
  assert.equal(rowsForLinesOf('the wheel'), 2);
  assert.equal(rowsForLinesOf('the wheel\nOld Paddle, the slow one\nThe Mill Wheel'), 4);
});

test('a waypoint moved to another list is named, with the list it went to', () => {
  assert.equal(
    waypointMoveInWords({ kind: 'withdrawn', text: 'The baker pays the toll.' }),
    '\u201cThe baker pays the toll.\u201d is withdrawn. It is kept among the waypoints withdrawn below, with what it said.',
  );
  assert.equal(
    waypointMoveInWords({ kind: 'reached', text: 'The ford floods.', sceneNumber: 3 }),
    '\u201cThe ford floods.\u201d is marked reached at scene 3. It is kept under Waypoints reached below.',
  );
});

test('editing an entry sends only what changed, the other names as the whole list', () => {
  const miller = { ...demoSnapshot().entries[0]!, alsoKnownAs: ['the old miller'], pronoun: 'he' };
  const form = entryDetailsFormOf(miller);
  assert.equal(form.alsoKnownAsText, 'the old miller');
  assert.deepEqual(entryEditToSend(miller, form), { ok: false, reason: 'Nothing here differs from what the entry holds.' });
  assert.deepEqual(entryEditToSend(miller, { ...form, alsoKnownAsText: 'the old miller\n Wynn ' }), { ok: true, input: { entry: 'miller', alsoKnownAs: ['the old miller', 'Wynn'] } });
  assert.deepEqual(entryEditToSend(miller, { ...form, alsoKnownAsText: '' }), { ok: true, input: { entry: 'miller', alsoKnownAs: [] } });
  assert.deepEqual(entryEditToSend(miller, { ...form, kind: 'group', pronoun: ' they ' }), { ok: true, input: { entry: 'miller', kind: 'group', pronoun: 'they' } });
});

test('an other name holding a comma is kept whole when only the pronoun or the kind is changed', () => {
  const miller = { ...demoSnapshot().entries[0]!, alsoKnownAs: ['Odo, the miller', 'Wynn'], pronoun: 'he' };
  const form = entryDetailsFormOf(miller);
  assert.equal(form.alsoKnownAsText, 'Odo, the miller\nWynn');
  assert.deepEqual(entryEditToSend(miller, { ...form, pronoun: 'they' }), { ok: true, input: { entry: 'miller', pronoun: 'they' } });
  assert.deepEqual(entryEditToSend(miller, { ...form, kind: 'group' }), { ok: true, input: { entry: 'miller', kind: 'group' } });
});

test('a thread is offered only open entries to be about, by name', () => {
  const [first, second] = demoSnapshot().entries;
  const hidden = { ...first!, name: 'a hidden heir', visibility: 'author-only' as const };
  const shown = { ...second!, name: 'a baker' };
  assert.deepEqual(entriesAThreadMayBeAbout([hidden, shown]).map((entry) => entry.name), ['a baker']);
});

test('a rename is refused when empty or unchanged, and trimmed when sent', () => {
  const miller = demoSnapshot().entries[0]!;
  assert.equal(renameToSend(miller, '  ').ok, false);
  assert.deepEqual(renameToSend(miller, 'the miller'), { ok: false, reason: 'It is called the miller already.' });
  assert.deepEqual(renameToSend(miller, ' Wynn the miller '), { ok: true, input: { entry: 'miller', name: 'Wynn the miller' } });
});

test('a new entry is sent with its other names one per line, and may be author only', () => {
  assert.deepEqual(
    newEntryToSend('the-mill', { name: ' the baker ', kind: 'person', alsoKnownAsText: 'Bryn\nthe baker\nbryn\nBryn, of the oven', pronoun: 'she', visibility: 'author-only' }),
    { ok: true, input: { run: 'the-mill', name: 'the baker', kind: 'person', alsoKnownAs: ['Bryn', 'the baker', 'Bryn, of the oven'], pronoun: 'she', visibility: 'author-only' } },
  );
  assert.equal(newEntryToSend('the-mill', { name: '', kind: 'item', alsoKnownAsText: '', pronoun: '', visibility: 'open' }).ok, false);
});

test('a fact names its entry and what it points at by id, and needs a property and a value', () => {
  assert.deepEqual(
    factToSend('the-mill', 'lantern', { property: ' Held by ', value: ' the miller ', aboutEntryId: 'miller', visibility: 'open', note: '' }),
    { ok: true, input: { run: 'the-mill', entryId: 'lantern', property: 'Held by', value: 'the miller', aboutEntryId: 'miller', visibility: 'open', note: '' } },
  );
  const pointingNowhere = factToSend('the-mill', 'lantern', { ...EMPTY_FACT_FORM, property: 'state', value: 'lit', visibility: 'author-only' });
  assert.ok(pointingNowhere.ok);
  assert.equal(pointingNowhere.ok && 'aboutEntryId' in pointingNowhere.input, false);
  assert.equal(pointingNowhere.ok && pointingNowhere.input.visibility, 'author-only');
  assert.equal(factToSend('the-mill', 'lantern', { ...EMPTY_FACT_FORM, property: 'state' }).ok, false);
  assert.equal(factToSend('the-mill', 'lantern', { ...EMPTY_FACT_FORM, value: 'lit' }).ok, false);
});

test('a ruling may name only open entries, marks one whose name another shares, and is sent word for word', () => {
  const snapshot = demoSnapshot();
  snapshot.entries.push({ ...snapshot.entries[0]!, id: 'secret', name: 'the hermit', visibility: 'author-only' });
  snapshot.entries.push({ ...snapshot.entries[0]!, id: 'miller-two', name: 'the elder', alsoKnownAs: ['The Miller'] });
  const nameable = entriesARulingMayName(snapshot);
  assert.equal(nameable.some((item) => item.entry.id === 'secret'), false);
  assert.equal(nameable.find((item) => item.entry.id === 'miller')?.sharesItsName, true);
  assert.equal(nameable.find((item) => item.entry.id === 'ford')?.sharesItsName, false);
  const sent = rulingToSend('the-mill', { text: '  Tolls are paid\nat dusk. ', scope: 'world', topicsText: 'practice, time', aboutEntryIds: ['ford', 'gone'] }, snapshot);
  assert.deepEqual(sent, {
    ok: true,
    input: { run: 'the-mill', text: '  Tolls are paid\nat dusk. ', statedByAuthor: true, scope: 'world', topics: ['practice', 'time'], about: ['the ford'] },
  });
  assert.equal(rulingToSend('the-mill', { text: '  ', scope: 'run', topicsText: '', aboutEntryIds: [] }, snapshot).ok, false);
});

test('rulings in force and withdrawn are kept apart, each by number', () => {
  const snapshot = demoSnapshot();
  snapshot.rulings.push({ ...snapshot.rulings[0]!, id: 'r3', number: 3, withdrawnInSceneId: 's3' });
  const { inForce, withdrawn } = rulingsSplitByWithdrawal(snapshot.rulings);
  assert.deepEqual(inForce.map((ruling) => ruling.id), ['r1', 'r2']);
  assert.deepEqual(withdrawn.map((ruling) => ruling.id), ['r3']);
});

test('each lasting act says when it takes effect and that nothing is deleted', () => {
  const snapshot = demoSnapshot();
  for (const act of ['end-fact', 'withdraw-ruling', 'withdraw-waypoint', 'close-thread', 'turn-author-only'] as const) {
    const words = lastingActInWords(act, snapshot);
    assert.match(words, /Nothing is deleted/, act);
  }
  for (const act of ['end-fact', 'withdraw-ruling', 'withdraw-waypoint', 'close-thread'] as const) {
    assert.match(lastingActInWords(act, snapshot), /as of scene 3/, act);
  }
  assert.match(lastingActInWords('turn-author-only', snapshot), /facts and its trail/);
});

test('cautions are read from an entry write, and any other answer has none', () => {
  assert.deepEqual(cautionsOfAnswer({ entry: {}, cautions: ['Two entries answer to the miller.'] }), ['Two entries answer to the miller.']);
  assert.deepEqual(cautionsOfAnswer({ id: 'w1', text: 'The ford floods.' }), []);
  assert.deepEqual(cautionsOfAnswer(null), []);
});

test('typed text is trimmed, and nothing but spaces is a reason', () => {
  assert.deepEqual(typedTextOrReason('  the ford  ', 'a name'), { ok: true, input: 'the ford' });
  assert.deepEqual(typedTextOrReason(' \n ', 'a name'), { ok: false, reason: 'Write a name first.' });
});

// ---------------------------------------------------------------------------------------------
// Backing up a run and restoring one. A made-up demo run: the mill by the ford.

function aBackupOfTheMill(): RunExportDocument {
  const tables = Object.fromEntries(RUN_EXPORT_TABLE_NAMES.map((name) => [name, []])) as unknown as RunExportDocument['tables'];
  tables.runs = [{
    id: 'run-mill', slug: 'the-mill', title: 'The Mill', setting: 'by the ford', status: 'binding',
    continues_run_id: null, register: '', created_at: '2026-11-13T09:30:00.123456Z', imported_through: null,
  }];
  return {
    formatName: 'timeweft-run-export', formatVersion: 1, exportedAt: '2026-11-13T10:00:00.000001Z',
    runSlug: 'the-mill', continuesRun: null, tables,
  };
}

function countsOf(value: number): RunExportRowCounts {
  return Object.fromEntries(RUN_EXPORT_TABLE_NAMES.map((name) => [name, value])) as RunExportRowCounts;
}

function runRecord(slug: string, title: string): RunRecord {
  return { id: `run-${slug}`, slug, title, setting: '', status: 'binding', continuesRunId: null, register: '', createdAt: '2026-11-13T09:30:00Z' } as RunRecord;
}

test('a downloaded backup is named as the server names its backups and written as the command writes it', () => {
  const document = aBackupOfTheMill();
  const download = backupDownloadOf(document, new Date('2026-11-13T09:30:00.456Z'));
  assert.equal(download.fileName, 'the-mill--20261113T093000Z.timeweft-run.json');
  assert.equal(download.text, runExportDocumentAsText(document), 'the same backup taken from the page and by pnpm export-run is the same file');
  assert.ok(download.text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(download.text), document);
});

test('a backup file is asked for, refused when empty and refused when over the restore limit', () => {
  assert.equal(whyBackupFileCannotStart(null), 'Pick a backup file.');
  assert.match(whyBackupFileCannotStart({ name: 'the-mill.timeweft-run.json', size: 0 }) ?? '', /is empty/);
  assert.equal(whyBackupFileCannotStart({ name: 'the-mill.timeweft-run.json', size: LARGEST_RESTORE_BODY_BYTES }), null);
  // A file a little over the limit may fit once its spacing is dropped, so it is read and measured.
  assert.equal(whyBackupFileCannotStart({ name: 'the-mill.timeweft-run.json', size: LARGEST_RESTORE_BODY_BYTES + 10 * 1024 * 1024 }), null);
  assert.equal(whyBackupFileCannotStart({ name: 'the-mill.timeweft-run.json', size: LARGEST_BACKUP_FILE_BYTES_READ }), null);
  assert.match(whyBackupFileCannotStart({ name: 'big.json', size: LARGEST_BACKUP_FILE_BYTES_READ + 1 }) ?? '', /still be over 200 MB, which is the most a restore takes/);
});

test('a backup file over the limit on disk but under it as sent is sent', () => {
  const document = aBackupOfTheMill();
  // Rows of short fields, as many tables hold: their spacing is a large part of the file.
  document.tables.scenes = Array.from({ length: 200 }, () => ({ ...(document.tables.scenes[0] ?? {}) })) as typeof document.tables.scenes;
  const fileText = runExportDocumentAsText(document);
  const sent = restoreToSend(fileText, false);
  assert.ok(sent.ok);
  assert.ok(bodyBytesOf(sent.input) < new TextEncoder().encode(fileText).length * 0.9, 'the body sent is smaller than the file');
});

test('a backup file is sent whole with the replace box as ticked', () => {
  const document = aBackupOfTheMill();
  const plain = restoreToSend(JSON.stringify(document, null, 2), false);
  assert.ok(plain.ok);
  assert.deepEqual(plain.input, { document, replace: false });
  assert.equal(plain.runSlug, 'the-mill');
  const replacing = restoreToSend(JSON.stringify(document), true);
  assert.ok(replacing.ok);
  assert.equal(replacing.input.replace, true);
});

test('a file that is not a backup is refused in the contract\'s words, and nothing is sent', () => {
  const notJson = restoreToSend('{ "formatName": "timeweft-run-ex', false);
  assert.equal(notJson.ok, false);
  assert.match(notJson.ok ? '' : notJson.reason, /not readable as JSON.*Nothing was sent\./);

  const otherKind = restoreToSend(JSON.stringify({ formatName: 'something-else', formatVersion: 1 }), false);
  assert.match(otherKind.ok ? '' : otherKind.reason, /not a Timeweft backup of a run.*Nothing was sent\./);

  const laterVersion = restoreToSend(JSON.stringify({ ...aBackupOfTheMill(), formatVersion: 99 }), false);
  assert.match(laterVersion.ok ? '' : laterVersion.reason, /format version 99, and this server reads version 1 only/);

  const cutShort = aBackupOfTheMill() as unknown as { tables: Record<string, unknown> };
  delete cutShort.tables['collisions'];
  const missing = restoreToSend(JSON.stringify(cutShort), false);
  assert.match(missing.ok ? '' : missing.reason, /missing the list for collisions/);
});

test('a backup that would travel larger than the server takes is not sent, saying both figures', () => {
  const document = aBackupOfTheMill();
  // Quotes escape to two characters each, so this file is under the limit and its body is not.
  const firstRun = document.tables.runs[0];
  assert.ok(firstRun !== undefined);
  firstRun.setting = '"'.repeat(Math.ceil(LARGEST_RESTORE_BODY_BYTES / 2) + 10);
  const toSend = restoreToSend(JSON.stringify(document), false);
  assert.equal(toSend.ok, false);
  assert.match(toSend.ok ? '' : toSend.reason, /server takes at most 200 MB\. Nothing was sent\./);
});

test('the restore button and the replace sentence say what each does', () => {
  assert.equal(restoreButtonText(false, false), 'Restore');
  assert.equal(restoreButtonText(false, true), 'Restore, replacing the run already here');
  assert.equal(restoreButtonText(true, false), 'Restoring…');
  assert.equal(restoreButtonText(true, true), 'Replacing…');
  assert.match(REPLACE_ON_RESTORE_SENTENCE, /left as it was/);
});

test('a restore is told in counts and in the order the tables are written, naming any run it replaced', () => {
  const counts = runRowCountsInWords({ ...countsOf(0), scenes: 4, collisions: 2 });
  assert.equal(counts.length, RUN_EXPORT_TABLE_NAMES.length);
  assert.equal(counts[0]?.label, 'The run itself');
  assert.deepEqual(counts.find((each) => each.label === 'Scenes, struck takes included')?.count, 4);
  assert.deepEqual(counts.at(-1), { label: 'Collisions', count: 2 });
  assert.equal(new Set(counts.map((each) => each.label)).size, counts.length);

  const fresh: RestoredRunReport = { run: runRecord('the-mill', 'The Mill'), rowsRestored: countsOf(1), replaced: null };
  assert.equal(restoredInWords(fresh), 'Restored The Mill (the-mill).');
  const replacing: RestoredRunReport = { ...fresh, replaced: { run: runRecord('the-mill', 'The Old Mill'), rowsRemoved: countsOf(2) } };
  assert.match(restoredInWords(replacing), /in place of The Old Mill \(the-mill\), which was removed/);
});

test('a size is said whole where it is whole, and to one place where it is not', () => {
  assert.equal(megabytesInWords(200 * 1024 * 1024), '200 MB');
  assert.equal(megabytesInWords(1.25 * 1024 * 1024), '1.3 MB');
});
