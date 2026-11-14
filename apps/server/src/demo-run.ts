/**
 * The plan of a large made-up run, to look at the pages with: a river valley, a mill, a ford, a
 * ferry. Everything here is pure and decided by the scene's index alone, so the same request
 * always plans the same run, and a test can check it without a database.
 *
 * The sizes follow a long real run: by default 420 scenes whose prose runs from 300 to 1500 words,
 * about 300 entries, about 750 rulings, about 210 threads of which 60 are closed. The command in
 * seed-demo-run-command.ts writes the plan through the store's own doors.
 */
import type { EntryKind } from '@timeweft/contract';

export const DEFAULT_DEMO_SCENES = 420;
export const DEFAULT_DEMO_SLUG = 'the-long-valley';

/** What the default 420 scenes aim at; a shorter run is scaled down from these. */
const SIZES_AT_420_SCENES = { entries: 300, rulings: 750, threadsOpened: 210, threadsClosed: 60, authorOnlyEntries: 8, collisions: 3, redoneScenes: 6 };

export const SHORTEST_PROSE_WORDS = 300;
export const LONGEST_PROSE_WORDS = 1500;

export const DEMO_CLOCKS = [
  { name: 'days since the flood', countsFrom: 'the morning the river rose over the ford' },
  { name: 'market weeks', countsFrom: 'the first market held after the flood' },
] as const;

const PARTS_OF_DAY = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'] as const;

/**
 * A small fast generator of numbers from 0 to 1, seeded by a whole number. Never the clock: the
 * seed is always a scene's index or an entry's, so every run planned is the same run.
 */
export function seededRandom(seed: number): () => number {
  let state = (seed * 2654435761 + 1013904223) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<Item>(random: () => number, items: readonly Item[]): Item {
  return items[Math.floor(random() * items.length)]!;
}

/** How many of a total fall to the scene at this index, so that every scene's share adds up exactly. */
export function shareOfScene(index: number, total: number, scenes: number): number {
  return Math.floor(((index + 1) * total) / scenes) - Math.floor((index * total) / scenes);
}

const FIRST_NAMES = [
  'Odo', 'Mara', 'Tobin', 'Elsa', 'Brann', 'Wenna', 'Corin', 'Hild', 'Jory', 'Nell', 'Gil', 'Rune', 'Sela', 'Tam', 'Una', 'Wat',
  'Ada', 'Bert', 'Cass', 'Dunn', 'Edda', 'Finn', 'Gwen', 'Hob', 'Ivo', 'Jess', 'Kit', 'Lark', 'Moss', 'Ned', 'Orla', 'Pip',
  'Quin', 'Rook', 'Sorrel', 'Tilda', 'Ulf', 'Vera', 'Wren', 'Yarrow',
] as const;
const TRADES = [
  'the miller', 'the ferryman', 'the baker', 'the weaver', 'the smith', 'the thatcher', 'the cooper', 'the reeve', 'the shepherd',
  'the carter', 'the brewer', 'the potter', 'the tanner', 'the fisher', 'the chandler', 'the mason', 'the herbwife', 'the drover',
  'the tollkeeper', 'the boatwright',
] as const;
const PLACE_WORDS = ['ford', 'mill', 'weir', 'ferry landing', 'orchard', 'bridge', 'marsh', 'barn', 'crossroads', 'quarry', 'chapel', 'well', 'meadow', 'wharf', 'kiln'] as const;
const PLACE_ADJECTIVES = ['old', 'north', 'south', 'low', 'high', 'drowned', 'broken', 'willow', 'stone', 'reed', 'mossy', 'east', 'west', 'little', 'long', 'cold', 'red', 'grey', 'upper', 'lower'] as const;
const ITEM_WORDS = ['lantern', 'ledger', 'key', 'rope', 'millstone', 'bell', 'oar', 'knife', 'cloak', 'jar', 'ring', 'map', 'seal', 'net', 'kettle'] as const;
const ITEM_ADJECTIVES = ['copper', 'cracked', 'tarred', 'iron', 'oak', 'painted', 'blue', 'heavy', 'worn', 'silver', 'patched', 'green', 'small', 'old', 'bent', 'brass', 'clay', 'red', 'black', 'white'] as const;
const GROUP_WORDS = ['ferrymen', 'millers', 'drovers', 'weavers', 'tollmen', 'bargees', 'reed-cutters', 'carters', 'fishers', 'masons'] as const;
const GROUP_PLACES = ['of the north bank', 'of the south bank', 'of the upper valley', 'of the lower valley', 'of the marsh', 'of the crossroads', 'of the weir', 'of the quarry'] as const;
const OTHER_THINGS = ['the river rising', 'the long frost', 'the market charter', 'the toll dispute', 'the flood mark', 'the spring fair', 'the night ferry rule', 'the drowned bell'] as const;

/** The kinds in the order entries are made: mostly people, then places and items, then the rest. */
const KIND_CYCLE: EntryKind[] = ['person', 'place', 'person', 'item', 'person', 'group', 'place', 'person', 'item', 'other'];

export interface DemoEntry {
  name: string;
  kind: EntryKind;
  alsoKnownAs: string[];
  pronoun: string;
}

/**
 * The entry made k-th. Each kind walks its own word lists with a step that shares no factor with
 * their lengths, so the names stay unique far past the 300 a run needs.
 */
export function entryOfIndex(index: number): DemoEntry {
  const kind = KIND_CYCLE[index % KIND_CYCLE.length]!;
  const round = Math.floor(index / KIND_CYCLE.length);
  const ofKindIndex = index % KIND_CYCLE.length;
  switch (kind) {
    case 'person': {
      const personIndex = round * 4 + [0, 2, 4, 7].indexOf(ofKindIndex);
      const first = FIRST_NAMES[personIndex % FIRST_NAMES.length]!;
      const trade = TRADES[(personIndex * 7 + Math.floor(personIndex / FIRST_NAMES.length)) % TRADES.length]!;
      const name = `${first} ${trade}`;
      return { name, kind, alsoKnownAs: personIndex % 3 === 0 ? [first] : [], pronoun: personIndex % 2 === 0 ? 'she' : 'he' };
    }
    case 'place': {
      const placeIndex = round * 2 + (ofKindIndex === 1 ? 0 : 1);
      const word = PLACE_WORDS[placeIndex % PLACE_WORDS.length]!;
      const adjective = PLACE_ADJECTIVES[(placeIndex * 3 + Math.floor(placeIndex / PLACE_WORDS.length)) % PLACE_ADJECTIVES.length]!;
      return { name: `the ${adjective} ${word}`, kind, alsoKnownAs: [], pronoun: '' };
    }
    case 'item': {
      const itemIndex = round * 2 + (ofKindIndex === 3 ? 0 : 1);
      const word = ITEM_WORDS[itemIndex % ITEM_WORDS.length]!;
      const adjective = ITEM_ADJECTIVES[(itemIndex * 7 + Math.floor(itemIndex / ITEM_WORDS.length)) % ITEM_ADJECTIVES.length]!;
      return { name: `the ${adjective} ${word}`, kind, alsoKnownAs: [], pronoun: '' };
    }
    case 'group': {
      const word = GROUP_WORDS[round % GROUP_WORDS.length]!;
      const place = GROUP_PLACES[(round * 3 + Math.floor(round / GROUP_WORDS.length)) % GROUP_PLACES.length]!;
      return { name: `the ${word} ${place}`, kind, alsoKnownAs: [], pronoun: '' };
    }
    default: {
      const thing = OTHER_THINGS[round % OTHER_THINGS.length]!;
      return { name: round < OTHER_THINGS.length ? thing : `${thing}, telling ${round + 1}`, kind, alsoKnownAs: [], pronoun: '' };
    }
  }
}

/** An entry only the author's pages show, named so it can never clash with an ordinary one. */
export function authorOnlyEntryOfIndex(index: number): DemoEntry {
  const word = ['ledger', 'letter', 'grave', 'debt', 'vow', 'cellar', 'map', 'name'][index % 8]!;
  return { name: `the hidden ${word} number ${index + 1}`, kind: index % 2 === 0 ? 'item' : 'other', alsoKnownAs: [], pronoun: '' };
}

const SENTENCE_OPENINGS = [
  'In the grey light', 'Before the bell', 'By the time the kettle sang', 'Without a word', 'At the edge of the water',
  'While the wheel turned', 'Long after the others had gone', 'Under the dripping eaves', 'When the ferry knocked against the post', 'Halfway through the telling',
] as const;
const VERBS = [
  'set down', 'looked at', 'carried', 'counted', 'mended', 'asked about', 'turned over', 'argued over', 'hid', 'weighed',
  'remembered', 'traded', 'cleaned', 'listened for', 'waited by',
] as const;
const OBJECTS = [
  'a sack of barley', 'the wet rope', 'the price of salt', 'a letter nobody had opened', 'the ledger', 'the last loaf', 'a basket of eels',
  'the toll board', 'a split oar', 'the new millstone', 'the mud on the step', 'an old promise', 'the flood mark on the wall', 'the cart wheel',
] as const;
const CLOSINGS = [
  'and said nothing more about it.', 'as the river went on talking to itself.', 'though nobody asked why.', 'and the matter seemed settled.',
  'until the light went.', 'which was more than anyone expected.', 'and the dog lay down by the door.', 'and the rain came back.',
  'while the others pretended not to watch.', 'and that was the end of it for the day.',
] as const;
const SPEECH = [
  '"The ford will not hold another winter," someone said.', '"Count it again," came the answer.', '"I have heard that before," she said.',
  '"Then we wait for the ferry," he said.', '"Nobody crosses after dark," said the reeve.', '"It was never ours to sell," said the miller.',
] as const;

function wordsIn(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** How many words the prose of the scene at this index runs to, from 300 to 1500. */
export function proseWordTarget(index: number): number {
  const random = seededRandom(index * 31 + 7);
  return SHORTEST_PROSE_WORDS + Math.floor(random() * (LONGEST_PROSE_WORDS - SHORTEST_PROSE_WORDS + 1));
}

/**
 * The prose of a scene, in paragraphs, made of plain sentence parts and the names of people the
 * run already knows. It stops at the first sentence that reaches the target, and never runs past
 * the longest allowed.
 */
export function proseOfScene(index: number, namesKnown: readonly string[]): string {
  const random = seededRandom(index * 97 + 13);
  const target = proseWordTarget(index);
  const names = namesKnown.length > 0 ? namesKnown : ['the miller'];
  const paragraphs: string[] = [];
  let words = 0;
  while (words < target) {
    const sentences: string[] = [];
    const sentencesInParagraph = 4 + Math.floor(random() * 4);
    for (let count = 0; count < sentencesInParagraph && words < target; count += 1) {
      const sentence = random() < 0.18
        ? pick(random, SPEECH)
        : `${pick(random, SENTENCE_OPENINGS)}, ${pick(random, names)} ${pick(random, VERBS)} ${pick(random, OBJECTS)} ${pick(random, CLOSINGS)}`;
      const sentenceWords = wordsIn(sentence);
      if (words + sentenceWords > LONGEST_PROSE_WORDS) { words = target; break; }
      sentences.push(sentence);
      words += sentenceWords;
    }
    if (sentences.length > 0) paragraphs.push(sentences.join(' '));
  }
  return paragraphs.join('\n\n');
}

export interface DemoFact {
  entry: string;
  property: string;
  value: string;
  about?: string;
  alongside: boolean;
  statedByAuthor: boolean;
}

export interface DemoRuling {
  text: string;
  scope: 'world' | 'run';
  topics: string[];
  about: string[];
  statedByAuthor: boolean;
}

/** One scene of the plan. Threads are named by ordinal, the order they were opened in the run. */
export interface DemoScenePlan {
  number: number;
  title: string;
  when: string;
  place: string | null;
  starred: boolean;
  summary: string;
  record: string;
  steer: string;
  situationAfter: string;
  readings: Array<{ clock: string; count: string; partOfDay: string }>;
  entries: DemoEntry[];
  facts: DemoFact[];
  notes: Array<{ entry: string; text: string }>;
  rulings: DemoRuling[];
  threadsOpened: Array<{ ordinal: number; text: string; about: string[] }>;
  threadsClosed: Array<{ ordinal: number; resolution: string }>;
  threadsTouched: Array<{ ordinal: number; note: string }>;
  waypointsReached: number[];
  legs: Array<{ from: string; to: string; duration: string; note: string }>;
  /** Saved first as a short take and then redone, so a struck take exists. */
  redone: boolean;
  /** What the author does once the scene is saved. */
  afterwards: {
    authorOnlyEntries: DemoEntry[];
    authorOnlyFacts: Array<{ entry: string; property: string; value: string }>;
    /** An author fact a later scene's story fact will collide with. */
    authorFacts: Array<{ entry: string; property: string; value: string }>;
  };
}

export interface DemoRunPlan {
  title: string;
  setting: string;
  register: string;
  waypoints: string[];
  scenes: DemoScenePlan[];
}

const FACT_PROPERTIES = ['where', 'state', 'standing', 'mood', 'knows', 'owes', 'held by'] as const;
const FACT_VALUES = ['at the mill', 'by the ford', 'tired but steady', 'in debt to the reeve', 'trusted by the ferrymen', 'out of favour', 'waiting for news',
  'on the far bank', 'mending nets', 'keeping a secret', 'short of flour', 'newly married', 'unwell since the frost', 'counting the tolls'] as const;
const RULING_TOPICS = ['narration', 'time', 'naming', 'travel', 'the river', 'trade', 'speech', 'weather'] as const;
const RULING_PARTS = ['Narrate', 'Keep', 'Never show', 'Always name', 'Count', 'Let', 'Do not hurry', 'Describe'] as const;
const RULING_ENDS = ['the ford in plain words', 'the days by the flood clock', 'the ferry crossing only by day', 'speech without dialect spelling',
  'the market by its weeks', 'the miller as tired, never old', 'weather before people', 'tolls in copper, never silver'] as const;
const WAYPOINTS = [
  'The ferry crosses at night for the first time since the flood.', 'The new millstone is set and the wheel turns again.',
  'The toll dispute reaches the reeve\'s court.', 'Somebody finds the drowned bell.', 'The spring fair is held at the crossroads.',
  'The ford is paved with quarry stone.', 'A letter from the upper valley arrives.', 'The two banks share one market.',
];

function scaled(total: number, scenes: number): number {
  return Math.max(1, Math.round((total * scenes) / DEFAULT_DEMO_SCENES));
}

/** The scenes, by index, that a fixed share of the run falls at. Never the first scene. */
function scenesAtFractions(count: number, scenes: number, offset: number): Set<number> {
  const chosen = new Set<number>();
  for (let step = 0; step < count; step += 1) {
    const index = Math.min(scenes - 1, Math.max(1, Math.floor(((step + offset) * scenes) / (count + 1))));
    chosen.add(index);
  }
  return chosen;
}

/** The whole plan of a run of this many scenes. Pure: the same count always gives the same plan. */
export function planOfDemoRun(sceneCount: number = DEFAULT_DEMO_SCENES): DemoRunPlan {
  if (!Number.isInteger(sceneCount) || sceneCount < 2) throw new Error('A demo run needs at least 2 scenes.');
  const totals = {
    entries: scaled(SIZES_AT_420_SCENES.entries, sceneCount),
    rulings: scaled(SIZES_AT_420_SCENES.rulings, sceneCount),
    threadsOpened: scaled(SIZES_AT_420_SCENES.threadsOpened, sceneCount),
    threadsClosed: scaled(SIZES_AT_420_SCENES.threadsClosed, sceneCount),
    authorOnlyEntries: scaled(SIZES_AT_420_SCENES.authorOnlyEntries, sceneCount),
    collisions: scaled(SIZES_AT_420_SCENES.collisions, sceneCount),
    redoneScenes: scaled(SIZES_AT_420_SCENES.redoneScenes, sceneCount),
  };
  const redoneScenes = scenesAtFractions(totals.redoneScenes, sceneCount, 0.5);
  const authorOnlyScenes = [...scenesAtFractions(totals.authorOnlyEntries, sceneCount, 0.3)];
  // An author fact is stated after one scene and the story contradicts it in the next.
  const collisionAuthorScenes = [...scenesAtFractions(totals.collisions, sceneCount, 0.7)].filter((index) => index < sceneCount - 1);
  const waypointsReachedAt = new Map<number, number>();
  [0.2, 0.5, 0.8].forEach((fraction, ordinal) => waypointsReachedAt.set(Math.max(1, Math.floor(fraction * sceneCount)), ordinal));

  const known: DemoEntry[] = [];
  const openThreads: number[] = [];
  let nextEntryIndex = 0;
  let nextThreadOrdinal = 0;
  let authorOnlyMade = 0;
  const collisionPeople: string[] = [];
  const scenes: DemoScenePlan[] = [];

  for (let index = 0; index < sceneCount; index += 1) {
    const random = seededRandom(index * 7919 + 17);
    const number = index + 1;
    const placesBefore = known.filter((entry) => entry.kind === 'place');
    const entries: DemoEntry[] = [];
    // The first scene meets a handful at once, so the run has people and places from the start.
    const toMake = index === 0 ? Math.max(5, shareOfScene(0, totals.entries, sceneCount)) : shareOfScene(index, totals.entries, sceneCount);
    for (let count = 0; count < toMake && nextEntryIndex < totals.entries; count += 1) {
      entries.push(entryOfIndex(nextEntryIndex));
      nextEntryIndex += 1;
    }
    known.push(...entries);
    const people = known.filter((entry) => entry.kind === 'person');
    const peopleNames = people.map((entry) => entry.name);
    const places = known.filter((entry) => entry.kind === 'place');
    const place = placesBefore.length > 0 ? pick(random, placesBefore).name : null;
    const leading = people.length > 0 ? pick(random, people).name : known[0]!.name;

    const facts: DemoFact[] = [];
    for (let count = 0; count < 3; count += 1) {
      const entry = pick(random, known);
      const property = pick(random, FACT_PROPERTIES);
      if (property === 'held by') {
        if (entry.kind !== 'item' || people.length === 0) continue;
        const holder = pick(random, people).name;
        facts.push({ entry: entry.name, property, value: `held by ${holder}`, about: holder, alongside: false, statedByAuthor: false });
        continue;
      }
      facts.push({ entry: entry.name, property, value: pick(random, FACT_VALUES), alongside: property === 'knows', statedByAuthor: false });
    }
    // The story contradicts the age the author stated after the scene before.
    if (collisionAuthorScenes.includes(index - 1)) {
      const person = collisionPeople[collisionPeople.length - 1]!;
      facts.push({ entry: person, property: 'age', value: 'about forty, by the story', alongside: false, statedByAuthor: false });
    }

    const notes = [0, 1].map(() => {
      const entry = pick(random, known).name;
      return { entry, text: `${entry} ${pick(random, VERBS)} ${pick(random, OBJECTS)} at scene ${number}.` };
    });

    const rulingCount = shareOfScene(index, totals.rulings, sceneCount);
    const rulings: DemoRuling[] = [];
    for (let count = 0; count < rulingCount; count += 1) {
      const about = random() < 0.4 ? [pick(random, known).name] : [];
      rulings.push({
        text: `${pick(random, RULING_PARTS)} ${pick(random, RULING_ENDS)} (ruling ${index + 1}.${count + 1}).`,
        scope: random() < 0.25 ? 'world' : 'run',
        topics: [pick(random, RULING_TOPICS)],
        about,
        statedByAuthor: random() < 0.85,
      });
    }

    const threadsClosed: DemoScenePlan['threadsClosed'] = [];
    const closeCount = index < 5 ? 0 : shareOfScene(index, totals.threadsClosed, sceneCount);
    for (let count = 0; count < closeCount && openThreads.length > 1; count += 1) {
      const position = Math.floor(random() * Math.min(openThreads.length - 1, 25));
      const ordinal = openThreads.splice(position, 1)[0]!;
      threadsClosed.push({ ordinal, resolution: `It was settled at scene ${number}, quietly, by ${leading}.` });
    }
    const threadsTouched: DemoScenePlan['threadsTouched'] = [];
    const touchable = [...openThreads];
    for (let count = 0; count < 2 && touchable.length > 0; count += 1) {
      const fromNewest = count === 0;
      const position = fromNewest ? touchable.length - 1 - Math.floor(random() * Math.min(5, touchable.length)) : Math.floor(random() * touchable.length);
      const ordinal = touchable.splice(position, 1)[0]!;
      threadsTouched.push({ ordinal, note: `It moved a little at scene ${number}.` });
    }
    const threadsOpened: DemoScenePlan['threadsOpened'] = [];
    const openCount = shareOfScene(index, totals.threadsOpened, sceneCount);
    for (let count = 0; count < openCount; count += 1) {
      const ordinal = nextThreadOrdinal;
      nextThreadOrdinal += 1;
      const about = [pick(random, known).name];
      threadsOpened.push({ ordinal, text: `Thread ${ordinal + 1}: will ${about[0]} ${pick(random, VERBS)} ${pick(random, OBJECTS)} before the next market?`, about });
      openThreads.push(ordinal);
    }

    const legs: DemoScenePlan['legs'] = [];
    if (index % 10 === 9 && places.length >= 2) {
      const from = pick(random, places).name;
      const others = places.filter((candidate) => candidate.name !== from);
      legs.push({ from, to: pick(random, others).name, duration: `${1 + Math.floor(random() * 6)} hours on foot`, note: `${leading} went that way.` });
    }

    const afterwards: DemoScenePlan['afterwards'] = { authorOnlyEntries: [], authorOnlyFacts: [], authorFacts: [] };
    if (authorOnlyScenes.includes(index) && authorOnlyMade < totals.authorOnlyEntries) {
      const hidden = authorOnlyEntryOfIndex(authorOnlyMade);
      authorOnlyMade += 1;
      afterwards.authorOnlyEntries.push(hidden);
      afterwards.authorOnlyFacts.push({ entry: hidden.name, property: 'truth', value: `Only the author knows where it lies after scene ${number}.` });
    }
    if (collisionAuthorScenes.includes(index) && people.length > 0) {
      const person = people[collisionPeople.length % people.length]!.name;
      collisionPeople.push(person);
      afterwards.authorFacts.push({ entry: person, property: 'age', value: 'sixty, as the author says' });
    }

    const day = 1 + Math.floor((index * 2) / 3);
    scenes.push({
      number,
      title: `${pick(random, ['Morning', 'Rain', 'Toll', 'Bread', 'Rope', 'Ferry', 'Bell', 'Market', 'Frost', 'Flood'])} at ${place ?? 'the valley'} (${number})`,
      when: `day ${day} after the flood, ${PARTS_OF_DAY[index % PARTS_OF_DAY.length]}`,
      place,
      starred: index % 25 === 12,
      summary: `${leading} ${pick(random, VERBS)} ${pick(random, OBJECTS)}. ${entries.length > 0 ? `${entries[0]!.name} is met for the first time.` : 'Nobody new is met.'} The day ends ${pick(random, CLOSINGS)}`,
      record: proseOfScene(index, peopleNames),
      steer: index % 7 === 3 ? `Keep it quiet; let ${leading} carry the scene.` : '',
      situationAfter: `${leading} is ${pick(random, FACT_VALUES)}. ${openThreads.length} questions stay open in the valley.`,
      readings: [
        { clock: DEMO_CLOCKS[0].name, count: String(day), partOfDay: PARTS_OF_DAY[index % PARTS_OF_DAY.length]! },
        { clock: DEMO_CLOCKS[1].name, count: String(1 + Math.floor(day / 7)), partOfDay: '' },
      ],
      entries,
      facts,
      notes,
      rulings,
      threadsOpened,
      threadsClosed,
      threadsTouched,
      waypointsReached: waypointsReachedAt.has(index) ? [waypointsReachedAt.get(index)!] : [],
      legs,
      redone: redoneScenes.has(index),
      afterwards,
    });
  }

  return {
    title: 'The Long Valley',
    setting: 'A river valley after a flood: one ford, one mill, a ferry, and two banks that do not trust each other.',
    register: 'Plain past tense, close third person, no dialect spelling.',
    waypoints: WAYPOINTS,
    scenes,
  };
}
