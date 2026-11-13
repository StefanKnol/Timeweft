/**
 * A made-up demo world for the tests: a miller, a ferry, a ford, a lantern. Nothing here is from
 * any real story. There is a small hand-built run for the readers, and a seeded generator that
 * builds runs of any size for the budget's property tests.
 */
import type {
  ClockRecord, EntryNoteRecord, EntryRecord, FactRecord, JourneyLegRecord, RulingRecord, RunSnapshot, SceneRecord,
  ThreadRecord, WaypointRecord,
} from '@timeweft/contract';

const MOMENT = '2026-01-01T00:00:00.000Z';

/** A time a fixed number of seconds after the demo's first moment, so records sort as written. */
export function momentAfter(seconds: number): string {
  return new Date(Date.parse(MOMENT) + seconds * 1000).toISOString();
}

export function scene(fields: Partial<SceneRecord> & { id: string; number: number }): SceneRecord {
  return {
    runId: 'run-demo', title: `Scene ${fields.number}`, starred: false, whenTyped: `day ${fields.number}`,
    placeEntryId: null, summary: `Things happen in scene ${fields.number}.`, record: '', steer: '',
    situationAfter: `After scene ${fields.number}, all is quiet.`, status: 'standing', readings: [],
    createdAt: momentAfter(fields.number * 10), ...fields,
  };
}

export function entry(fields: Partial<EntryRecord> & { id: string; name: string }): EntryRecord {
  return {
    runId: 'run-demo', kind: 'person', alsoKnownAs: [], pronoun: '', introducedInSceneId: null, source: 'story',
    visibility: 'open', createdAt: MOMENT, ...fields,
  };
}

export function fact(fields: Partial<FactRecord> & { id: string; entryId: string; property: string; value: string }): FactRecord {
  return {
    aboutEntryId: null, fromSceneId: null, untilSceneId: null, source: 'story', visibility: 'open', note: '',
    createdAt: MOMENT, ...fields,
  };
}

export function note(fields: Partial<EntryNoteRecord> & { id: string; entryId: string; sceneId: string; text: string }): EntryNoteRecord {
  return { visibility: 'open', createdAt: MOMENT, ...fields };
}

export function ruling(fields: Partial<RulingRecord> & { id: string; number: number; text: string }): RulingRecord {
  return {
    runId: 'run-demo', source: 'author', scope: 'run', topics: [], aboutEntryIds: [], sceneId: null,
    withdrawnInSceneId: null, createdAt: momentAfter(fields.number), ...fields,
  };
}

/**
 * A thread for a demo run. Where the scene it was last touched in is not given, it is the scene that
 * closed it, else the one that opened it, which is what the store derives for a thread with no touches.
 */
export function thread(fields: Partial<ThreadRecord> & { id: string; text: string }): ThreadRecord {
  return {
    runId: 'run-demo', aboutEntryIds: [], openedInSceneId: null, closedInSceneId: null, resolution: '',
    touches: [], createdAt: MOMENT, ...fields,
    lastTouchedInSceneId: fields.lastTouchedInSceneId !== undefined
      ? fields.lastTouchedInSceneId
      : (fields.closedInSceneId ?? fields.openedInSceneId ?? null),
  };
}

export function leg(fields: Partial<JourneyLegRecord> & { id: string; fromPlace: string; toPlace: string }): JourneyLegRecord {
  return { runId: 'run-demo', duration: 'a day', note: '', sceneId: null, createdAt: MOMENT, ...fields };
}

/** The small run the readers are tested against. */
export function millerRun(): RunSnapshot {
  const clocks: ClockRecord[] = [
    { id: 'clock-days', runId: 'run-demo', name: 'Days since the flood', countsFrom: 'the night the river rose' },
    { id: 'clock-mill', runId: 'run-demo', name: 'Days at the mill', countsFrom: 'the miller taking the ferry keeper in' },
  ];
  const scenes: SceneRecord[] = [
    scene({ id: 'scene-1', number: 1, title: 'The flood', starred: true, placeEntryId: 'entry-ford',
      readings: [{ clockId: 'clock-days', count: '0', partOfDay: 'night' }] }),
    scene({ id: 'scene-2-struck', number: 2, title: 'The first take of the ferry', status: 'struck',
      summary: 'A take the author threw away, where the lantern was lost in the water.' }),
    scene({ id: 'scene-2', number: 2, title: 'The ferry', createdAt: momentAfter(25),
      readings: [{ clockId: 'clock-days', count: '3', partOfDay: 'dusk' }] }),
    scene({ id: 'scene-3', number: 3, title: 'The mill', placeEntryId: 'entry-mill',
      situationAfter: 'The ferry keeper sleeps in the mill loft. The lantern hangs by the door.',
      readings: [{ clockId: 'clock-mill', count: '1', partOfDay: '' }] }),
  ];
  const entries: EntryRecord[] = [
    entry({ id: 'entry-miller', name: 'Wenna the miller', alsoKnownAs: ['the miller'], pronoun: 'she', introducedInSceneId: 'scene-1' }),
    entry({ id: 'entry-keeper', name: 'Bram', alsoKnownAs: ['the ferry keeper'], pronoun: 'he', introducedInSceneId: 'scene-1' }),
    entry({ id: 'entry-ford', name: 'The ford', kind: 'place' }),
    entry({ id: 'entry-mill', name: 'The mill', kind: 'place', introducedInSceneId: 'scene-3' }),
    entry({ id: 'entry-lantern', name: 'The lantern', kind: 'item' }),
    entry({ id: 'entry-ferry-one', name: 'Ferry', kind: 'item', alsoKnownAs: ['the boat'] }),
    entry({ id: 'entry-ferry-two', name: 'The old raft', kind: 'item', alsoKnownAs: ['The Boat '] }),
  ];
  const facts: FactRecord[] = [
    fact({ id: 'fact-keeper-where-1', entryId: 'entry-keeper', property: 'where', value: 'at the ford',
      aboutEntryId: 'entry-ford', fromSceneId: 'scene-1', untilSceneId: 'scene-3', createdAt: momentAfter(1) }),
    fact({ id: 'fact-keeper-where-2', entryId: 'entry-keeper', property: 'where', value: 'in the mill loft',
      aboutEntryId: 'entry-mill', fromSceneId: 'scene-3', createdAt: momentAfter(3) }),
    fact({ id: 'fact-keeper-standing', entryId: 'entry-keeper', property: 'standing', value: 'grateful to the miller',
      aboutEntryId: 'entry-miller', fromSceneId: 'scene-2', createdAt: momentAfter(2) }),
    fact({ id: 'fact-keeper-struck', entryId: 'entry-keeper', property: 'state', value: 'soaked through and shaking',
      fromSceneId: 'scene-2-struck', createdAt: momentAfter(2) }),
    fact({ id: 'fact-lantern-held', entryId: 'entry-lantern', property: 'held by', value: 'hangs by the door',
      aboutEntryId: 'entry-mill', fromSceneId: 'scene-3', createdAt: momentAfter(3) }),
    fact({ id: 'fact-miller-who', entryId: 'entry-miller', property: 'who', value: 'grinds grain for the valley',
      fromSceneId: 'scene-1', source: 'author', createdAt: momentAfter(1) }),
  ];
  const notes: EntryNoteRecord[] = [
    note({ id: 'note-keeper-1', entryId: 'entry-keeper', sceneId: 'scene-1', text: 'Pulled from the water at the ford.', createdAt: momentAfter(1) }),
    note({ id: 'note-keeper-struck', entryId: 'entry-keeper', sceneId: 'scene-2-struck', text: 'Dropped the lantern in the river.', createdAt: momentAfter(2) }),
    note({ id: 'note-keeper-2', entryId: 'entry-keeper', sceneId: 'scene-2', text: 'Mended the ferry rope.', createdAt: momentAfter(2) }),
    note({ id: 'note-keeper-3', entryId: 'entry-keeper', sceneId: 'scene-3', text: 'Climbed to the loft to sleep.', createdAt: momentAfter(3) }),
  ];
  const rulings: RulingRecord[] = [
    ruling({ id: 'ruling-1', number: 1, text: 'Tell it in the past tense, close on the miller.', topics: ['narration'] }),
    ruling({ id: 'ruling-2', number: 2, text: 'The ferry keeper never swims.', aboutEntryIds: ['entry-keeper'], topics: ['practice'] }),
    ruling({ id: 'ruling-3', number: 3, text: 'No talk of the flood at meals.', withdrawnInSceneId: 'scene-3', topics: ['practice'] }),
    ruling({ id: 'ruling-4', number: 4, text: 'The lantern was lost.', sceneId: 'scene-2-struck', aboutEntryIds: ['entry-lantern'] }),
  ];
  const threads: ThreadRecord[] = [
    thread({ id: 'thread-rope', text: 'Who cut the ferry rope?', aboutEntryIds: ['entry-keeper'], openedInSceneId: 'scene-1', createdAt: momentAfter(1) }),
    thread({ id: 'thread-flour', text: 'Will the flour last the winter?', aboutEntryIds: ['entry-miller'], openedInSceneId: 'scene-2', createdAt: momentAfter(2) }),
    thread({ id: 'thread-lantern', text: 'Whose lantern is it?', aboutEntryIds: ['entry-lantern'], openedInSceneId: 'scene-1',
      closedInSceneId: 'scene-3', resolution: 'It was the miller\'s mother\'s.', createdAt: momentAfter(1) }),
    thread({ id: 'thread-struck', text: 'Can the lantern be found?', openedInSceneId: 'scene-2-struck', createdAt: momentAfter(2) }),
  ];
  const waypoints: WaypointRecord[] = [
    { id: 'waypoint-fair', runId: 'run-demo', text: 'The autumn fair at the ford.', reachedInSceneId: null, createdAt: MOMENT },
    { id: 'waypoint-reached', runId: 'run-demo', text: 'The ferry keeper is taken in.', reachedInSceneId: 'scene-3', createdAt: MOMENT },
  ];
  const legs: JourneyLegRecord[] = [
    leg({ id: 'leg-bank-market', fromPlace: 'the far bank', toPlace: 'the market town', duration: 'two days by cart',
      sceneId: 'scene-2', createdAt: momentAfter(2) }),
    leg({ id: 'leg-struck', fromPlace: 'The ford', toPlace: 'the far bank', duration: 'an hour by raft',
      note: 'swept downstream', sceneId: 'scene-2-struck', createdAt: momentAfter(2) }),
    leg({ id: 'leg-ford-mill', fromPlace: 'The ford', toPlace: 'The mill', duration: 'half a day on foot',
      note: 'carrying the ferry keeper', sceneId: 'scene-3', createdAt: momentAfter(3) }),
  ];
  return {
    run: {
      id: 'run-demo', slug: 'the-mill', title: 'The mill by the ford', setting: 'A river valley, the year after the flood.',
      status: 'binding', continuesRunId: null, register: 'Plain past tense. Close third person on the miller.', createdAt: MOMENT,
    },
    clocks, scenes, entries, facts, notes, rulings, threads, waypoints, legs, collisions: [],
  };
}

/* ---------------------------------------------------------------- the generator */

/** A small seeded random source (mulberry32), so a generated run is the same on every run of the tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'miller', 'ferry', 'ford', 'lantern', 'river', 'grain', 'rope', 'loft', 'wheel', 'bank', 'reed', 'dawn',
  'barge', 'sack', 'flour', 'stone', 'mud', 'oar', 'gate', 'bell', 'kettle', 'smoke', 'frost', 'apple',
];

export interface GeneratedRunOptions {
  seed: number;
  scenes: number;
  entries: number;
  /** Facts and trail notes per entry, roughly. */
  factsPerEntry: number;
  notesPerEntry: number;
  rulings: number;
  threads: number;
  clocks: number;
  waypoints: number;
  /** Journey legs, between the generated entries' names and a few places nobody names. */
  legs?: number;
  /** One field of this many bytes, to prove a field larger than the whole budget is cut. */
  hugeField?: 'register' | 'situation' | 'title' | 'summary' | 'fact' | 'ruling';
  hugeFieldBytes?: number;
}

/**
 * A run of any size. Every closed fact's value says CLOSEDVALUE, every struck scene's text says
 * STRUCKTEXT, so a test can prove neither is ever served.
 */
export function generateRun(options: GeneratedRunOptions): RunSnapshot {
  const random = seededRandom(options.seed);
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)] as Item;
  const sentence = (wordCount: number): string => {
    const words = Array.from({ length: wordCount }, () => pick(WORDS));
    return `${words.join(' ')}.`.replace(/^./, (first) => first.toUpperCase());
  };
  const paragraph = (sentenceCount: number): string =>
    Array.from({ length: sentenceCount }, () => sentence(3 + Math.floor(random() * 9))).join(' ');
  const huge = (): string => {
    const wanted = options.hugeFieldBytes ?? 300_000;
    let text = '';
    while (text.length < wanted) text += `${paragraph(5)} `;
    return text;
  };

  const clocks: ClockRecord[] = Array.from({ length: options.clocks }, (_, clockIndex) => ({
    id: `clock-${clockIndex}`, runId: 'run-gen', name: `Clock ${clockIndex}`, countsFrom: sentence(4),
  }));
  const scenes: SceneRecord[] = [];
  for (let number = 1; number <= options.scenes; number += 1) {
    if (random() < 0.08) {
      scenes.push(scene({
        id: `scene-${number}-struck`, number, status: 'struck', title: `STRUCKTEXT title ${number}`,
        summary: `STRUCKTEXT summary ${number}.`, situationAfter: `STRUCKTEXT situation ${number}.`,
        createdAt: momentAfter(number * 10),
      }));
    }
    scenes.push(scene({
      id: `scene-${number}`, number, title: `${pick(WORDS)} ${number}`, starred: random() < 0.15,
      whenTyped: `day ${number}, ${pick(['dawn', 'noon', 'dusk', 'night'])}`,
      summary: paragraph(2 + Math.floor(random() * 3)), situationAfter: paragraph(3),
      readings: clocks.filter(() => random() < 0.5).map((clock) => ({ clockId: clock.id, count: String(number), partOfDay: pick(['dawn', '']) })),
      createdAt: momentAfter(number * 10 + 5),
    }));
  }
  const standing = scenes.filter((candidate) => candidate.status === 'standing');
  const struck = scenes.filter((candidate) => candidate.status === 'struck');
  const anyStanding = (): SceneRecord | undefined => (standing.length > 0 ? pick(standing) : undefined);

  const entries: EntryRecord[] = Array.from({ length: options.entries }, (_, entryIndex) => entry({
    id: `entry-${entryIndex}`, name: `${pick(WORDS)} keeper ${entryIndex}`, kind: pick(['person', 'place', 'item', 'group'] as const),
    pronoun: pick(['she', 'he', 'they', '']), alsoKnownAs: random() < 0.3 ? [`the ${pick(WORDS)} ${entryIndex}`] : [],
  }));
  const facts: FactRecord[] = [];
  const notes: EntryNoteRecord[] = [];
  let counter = 0;
  for (const subject of entries) {
    for (let factIndex = 0; factIndex < options.factsPerEntry; factIndex += 1) {
      counter += 1;
      const from = anyStanding();
      const closed = random() < 0.4;
      const fromStruck = !closed && struck.length > 0 && random() < 0.05;
      facts.push(fact({
        id: `fact-${counter}`, entryId: subject.id, property: pick(['where', 'state', 'standing', 'what', 'voice']) + (factIndex % 4),
        value: closed ? `CLOSEDVALUE ${counter} ${sentence(5)}` : fromStruck ? `STRUCKTEXT fact ${counter}` : `holds ${counter} ${sentence(6)}`,
        aboutEntryId: random() < 0.3 ? `entry-${Math.floor(random() * options.entries)}` : null,
        fromSceneId: fromStruck ? (pick(struck).id) : from?.id ?? null,
        untilSceneId: closed ? (anyStanding()?.id ?? 'scene-none') : null,
        createdAt: momentAfter(counter),
      }));
    }
    for (let noteIndex = 0; noteIndex < options.notesPerEntry; noteIndex += 1) {
      counter += 1;
      const inStruck = struck.length > 0 && random() < 0.05;
      const where = inStruck ? pick(struck) : anyStanding();
      if (!where) continue;
      notes.push(note({
        id: `note-${counter}`, entryId: subject.id, sceneId: where.id,
        text: inStruck ? `STRUCKTEXT note ${counter}` : sentence(8), createdAt: momentAfter(counter),
      }));
    }
  }
  const rulings: RulingRecord[] = Array.from({ length: options.rulings }, (_, rulingIndex) => ruling({
    id: `ruling-${rulingIndex}`, number: rulingIndex + 1,
    text: `Ruling text ${rulingIndex + 1}. ${paragraph(1 + Math.floor(random() * 6))}`,
    topics: random() < 0.3 ? ['narration'] : [pick(['time', 'naming', 'practice'])],
    aboutEntryIds: options.entries > 0 && random() < 0.4 ? [`entry-${Math.floor(random() * options.entries)}`] : [],
    withdrawnInSceneId: random() < 0.1 ? (anyStanding()?.id ?? null) : null,
  }));
  const threads: ThreadRecord[] = Array.from({ length: options.threads }, (_, threadIndex) => thread({
    id: `thread-${threadIndex}`, text: `Thread ${threadIndex}: ${sentence(7)}`,
    aboutEntryIds: options.entries > 0 && random() < 0.5 ? [`entry-${Math.floor(random() * options.entries)}`] : [],
    openedInSceneId: anyStanding()?.id ?? null, createdAt: momentAfter(threadIndex),
    closedInSceneId: random() < 0.3 ? (anyStanding()?.id ?? null) : null,
  }));
  const waypoints: WaypointRecord[] = Array.from({ length: options.waypoints }, (_, waypointIndex) => ({
    id: `waypoint-${waypointIndex}`, runId: 'run-gen', text: sentence(6),
    reachedInSceneId: random() < 0.3 ? (anyStanding()?.id ?? null) : null, createdAt: momentAfter(waypointIndex),
  }));
  const legs: JourneyLegRecord[] = Array.from({ length: options.legs ?? 0 }, (_, legIndex) => {
    const placeName = (): string => (entries.length > 0 && random() < 0.5 ? pick(entries).name : `the ${pick(WORDS)} road`);
    const inStruck = struck.length > 0 && random() < 0.05;
    return {
      id: `leg-${legIndex}`, runId: 'run-gen', fromPlace: placeName(), toPlace: placeName(),
      duration: inStruck ? `STRUCKTEXT leg ${legIndex}` : `${1 + Math.floor(random() * 9)} days`,
      note: random() < 0.5 ? sentence(5) : '', sceneId: inStruck ? pick(struck).id : (anyStanding()?.id ?? null),
      createdAt: momentAfter(legIndex),
    };
  });
  const snapshot: RunSnapshot = {
    run: {
      id: 'run-gen', slug: 'generated', title: `The ${pick(WORDS)} at the ${pick(WORDS)}`, setting: paragraph(2),
      status: random() < 0.5 ? 'binding' : 'telling', continuesRunId: null, register: paragraph(4), createdAt: MOMENT,
    },
    clocks, scenes, entries, facts, notes, rulings, threads, waypoints, legs, collisions: [],
  };
  const newest = standing[standing.length - 1];
  switch (options.hugeField) {
    case 'register': snapshot.run.register = huge(); break;
    case 'title': snapshot.run.title = huge(); break;
    case 'situation': if (newest) newest.situationAfter = huge(); break;
    case 'summary': if (newest) newest.summary = huge(); break;
    case 'fact': {
      const first = facts.find((candidate) => candidate.untilSceneId === null && !candidate.value.startsWith('STRUCKTEXT'));
      if (first) first.value = huge();
      break;
    }
    case 'ruling': if (rulings[0]) rulings[0].text = huge(); break;
    default: break;
  }
  return snapshot;
}

/* ---------------------------------------------------------------- a long run */

/** The one entry of a long run who is in every scene: the one the story is told through. */
export const LONG_RUN_POINT_OF_VIEW_ID = 'entry-baker';

/**
 * A long run shaped like a story kept for hundreds of scenes: one entry, the baker, has a trail
 * note in every scene; a few early facts about the baker were never replaced; the newest scenes
 * coin many small things, each with a world ruling; the author's standing instructions about how
 * the run is told are old and few; one clock's description has grown by stacking; some journeys
 * were never tied to a scene; and scene summaries are long. Every word is the demo world's.
 */
export function generateLongRun(options: { seed: number; scenes: number }): RunSnapshot {
  const random = seededRandom(options.seed);
  const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(random() * items.length)] as Item;
  const sentence = (wordCount: number): string => {
    const words = Array.from({ length: wordCount }, () => pick(WORDS));
    return `${words.join(' ')}.`.replace(/^./, (first) => first.toUpperCase());
  };
  const paragraph = (sentenceCount: number): string =>
    Array.from({ length: sentenceCount }, () => sentence(6 + Math.floor(random() * 8))).join(' ');

  const clocks: ClockRecord[] = [
    { id: 'clock-burned', runId: 'run-long', name: 'Days since the mill burned',
      countsFrom: Array.from({ length: 30 }, (_, layer) => `Layer ${layer + 1}: the count was taken up again after the ${pick(WORDS)} ${pick(WORDS)}.`).join(' ') },
    { id: 'clock-season', runId: 'run-long', name: 'Weeks of the harvest', countsFrom: 'the first sheaf cut' },
  ];
  const scenes: SceneRecord[] = [];
  for (let number = 1; number <= options.scenes; number += 1) {
    scenes.push(scene({
      id: `scene-${number}`, number, runId: 'run-long', title: `The ${pick(WORDS)} ${number}`, starred: random() < 0.1,
      whenTyped: `day ${number}`, summary: paragraph(10 + Math.floor(random() * 10)), situationAfter: paragraph(3),
      readings: [{ clockId: 'clock-burned', count: String(number), partOfDay: 'dusk' }],
      createdAt: momentAfter(number * 10),
    }));
  }
  const baker = entry({ id: LONG_RUN_POINT_OF_VIEW_ID, runId: 'run-long', name: 'Ada the baker', pronoun: 'she', introducedInSceneId: 'scene-1' });
  const regulars = Array.from({ length: 20 }, (_, regularIndex) => entry({
    id: `entry-regular-${regularIndex}`, runId: 'run-long', name: `${pick(WORDS)} hand ${regularIndex}`,
  }));
  const coined = Array.from({ length: 40 }, (_, coinedIndex) => entry({
    id: `entry-coined-${coinedIndex}`, runId: 'run-long', name: `the ${pick(WORDS)} charm ${coinedIndex}`, kind: 'item',
  }));
  const entries = [baker, ...regulars, ...coined];
  const facts: FactRecord[] = [];
  const notes: EntryNoteRecord[] = [];
  let counter = 0;
  const nextMoment = (): string => { counter += 1; return momentAfter(counter); };
  // Early facts about the baker, never replaced, and a few newer ones.
  for (const [property, value, from] of [
    ['state', 'a stranger in the valley whom nobody trusts', 'scene-2'],
    ['standing', 'owes the mill a winter of bread', 'scene-3'],
    ['where', 'at the bakehouse by the ford', 'scene-5'],
  ] as const) {
    facts.push(fact({ id: `fact-baker-${property}`, entryId: baker.id, property, value, fromSceneId: from, createdAt: nextMoment() }));
  }
  facts.push(fact({ id: 'fact-baker-who', entryId: baker.id, property: 'who', value: 'the valley baker', createdAt: nextMoment() }));
  // Newer facts, but none in the newest scene: there the baker has only a trail note.
  for (let number = options.scenes - 5; number < options.scenes; number += 1) {
    if (number < 1) continue;
    facts.push(fact({ id: `fact-baker-late-${number}`, entryId: baker.id, property: `mood ${number}`, value: sentence(6), fromSceneId: `scene-${number}`, createdAt: nextMoment() }));
  }
  for (const item of scenes) {
    notes.push(note({ id: `note-baker-${item.number}`, entryId: baker.id, sceneId: item.id, text: paragraph(1), createdAt: nextMoment() }));
    for (const regular of regulars) {
      if (random() < 0.15) notes.push(note({ id: `note-${regular.id}-${item.number}`, entryId: regular.id, sceneId: item.id, text: sentence(10), createdAt: nextMoment() }));
    }
  }
  for (const regular of regulars) {
    for (let factIndex = 0; factIndex < 4; factIndex += 1) {
      facts.push(fact({ id: `fact-${regular.id}-${factIndex}`, entryId: regular.id, property: pick(['where', 'state', 'standing']) + factIndex,
        value: sentence(7), fromSceneId: `scene-${1 + Math.floor(random() * options.scenes)}`, createdAt: nextMoment() }));
    }
  }
  // The newest scene coins many small things: a fact each, and a world ruling each.
  const newest = scenes[scenes.length - 1];
  const rulings: RulingRecord[] = [];
  let rulingNumber = 0;
  const addRuling = (fields: Partial<RulingRecord> & { text: string }): void => {
    rulingNumber += 1;
    rulings.push(ruling({ id: `ruling-${rulingNumber}`, number: rulingNumber, runId: 'run-long', ...fields }));
  };
  addRuling({ text: 'Tell it in the past tense, close on the baker, never inside anyone else.', topics: ['narration', 'point of view'], sceneId: 'scene-1' });
  addRuling({ text: 'Keep the narration plain: no long lists, and every scene ends on the baker.', topics: ['narration'], sceneId: 'scene-1' });
  for (let practice = 0; practice < 40; practice += 1) {
    addRuling({ text: `Practice ${practice + 1}. ${sentence(12)}`, topics: [pick(['time', 'practice', 'naming'])], sceneId: `scene-${1 + practice}` });
  }
  for (let worldIndex = 0; worldIndex < 700; worldIndex += 1) {
    const sceneNumber = Math.min(options.scenes, 1 + Math.floor((worldIndex * options.scenes) / 700));
    const about = worldIndex >= 660 ? coined[worldIndex - 660] : pick(coined);
    addRuling({ text: `It is so in the world: ${sentence(14)}`, source: 'story', scope: 'world', topics: ['coined'],
      aboutEntryIds: about ? [about.id] : [], sceneId: `scene-${sceneNumber}` });
  }
  if (newest) {
    for (const item of coined) {
      facts.push(fact({ id: `fact-${item.id}`, entryId: item.id, property: 'what', value: sentence(8), fromSceneId: newest.id, source: 'story', createdAt: nextMoment() }));
    }
  }
  const threads: ThreadRecord[] = Array.from({ length: 60 }, (_, threadIndex) => thread({
    id: `thread-${threadIndex}`, runId: 'run-long', text: sentence(9), openedInSceneId: `scene-${1 + Math.floor(random() * options.scenes)}`,
    aboutEntryIds: random() < 0.5 ? [pick(entries).id] : [], createdAt: nextMoment(),
  }));
  const legs: JourneyLegRecord[] = Array.from({ length: 30 }, (_, legIndex) => leg({
    id: `leg-${legIndex}`, runId: 'run-long', fromPlace: `the ${pick(WORDS)} road`, toPlace: `the ${pick(WORDS)} gate`,
    duration: `${1 + legIndex} days`, sceneId: legIndex % 3 === 0 ? null : `scene-${1 + Math.floor(random() * options.scenes)}`,
    note: legIndex % 2 === 0 ? 'by cart' : '', createdAt: momentAfter(legIndex),
  }));
  return {
    run: {
      id: 'run-long', slug: 'the-bakehouse', title: 'The bakehouse by the ford', setting: paragraph(2),
      status: 'binding', continuesRunId: null, register: paragraph(4), createdAt: MOMENT,
    },
    clocks, scenes, entries, facts, notes, rulings, threads, waypoints: [], legs, collisions: [],
  };
}
