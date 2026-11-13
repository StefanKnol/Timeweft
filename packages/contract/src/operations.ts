/**
 * Every action the app can take, written once.
 *
 * The web route, the MCP tool and its description, and the tests that hold them are all made from
 * this list. Nothing is reachable that is not in it, so a route and a tool cannot disagree about
 * what an action takes, and an action nobody classified cannot exist.
 */
import { z } from 'zod';
import { ENTRY_KINDS, RULING_SCOPES, RUN_STATUSES, VISIBILITIES } from './records.ts';

/** What an operation does to the store. */
export const EFFECTS = ['reads', 'writes'] as const;
export type Effect = (typeof EFFECTS)[number];

/**
 * Who an operation answers. A `story` operation is what a chat writing a story calls: it never
 * returns anything marked author-only. An `author` operation is the author's own view.
 */
export const AUDIENCES = ['story', 'author'] as const;
export type Audience = (typeof AUDIENCES)[number];

const runHandle = z.string().min(1).describe("The run's slug, as list_runs gives it.");
const sceneNumber = z.number().int().min(1).describe("The scene's number in the run.");

const clockReadingInput = z.object({
  clock: z.string().min(1).describe('The name of one of the run\'s clocks.'),
  count: z.union([z.number(), z.string()]).describe('The count on that clock at this scene, exact.'),
  partOfDay: z.string().default('').describe("The part of the day, in the setting's own words."),
});

const entryInput = z.object({
  name: z.string().min(1).describe('The name it is known by. Two things may share a name.'),
  kind: z.enum(ENTRY_KINDS).describe('What it is: a person, a group of people, a place, an item, or other.'),
  alsoKnownAs: z.array(z.string()).default([]).describe('Other names it goes by, so it can be found under them.'),
  pronoun: z.string().default('').describe('For a person: how the narration refers to them.'),
});

const factInput = z.object({
  entry: z.string().min(1).describe('The name of the entry the fact is about.'),
  property: z.string().min(1).describe('What is being said: who, standing, state, voice, where, what, held by, or any other.'),
  value: z.string().describe('What is so, in a sentence or less.'),
  about: z.string().optional().describe('The name of another entry the fact points at, such as who holds an item.'),
  statedByAuthor: z.boolean().default(false).describe('True only where the author said this in so many words. The author\'s word outranks a story\'s.'),
  alongside: z.boolean().default(false).describe('True to add this beside what the property already holds. Left false, it replaces what was so and the earlier fact is kept as history.'),
  note: z.string().default('').describe('A remark on the fact, where one is needed.'),
});

const noteInput = z.object({
  entry: z.string().min(1).describe('The name of the entry the note is about.'),
  text: z.string().min(1).describe('What happened to or with them in this scene, in a sentence or two.'),
});

const rulingInput = z.object({
  text: z.string().min(1).describe('Word for word, as given.'),
  statedByAuthor: z.boolean().default(true).describe('True where the author gave it, which is the usual case and what is assumed when left out. False where the story itself settled it.'),
  scope: z.enum(RULING_SCOPES).default('run').describe('`world` where it says how things are everywhere, `run` where it is about how this story is played.'),
  topics: z.array(z.string()).default([]).describe('What it bears on: narration, time, naming, a practice, a theme.'),
  about: z.array(z.string()).default([]).describe('The names of the entries it is about.'),
});

const threadInput = z.object({
  text: z.string().min(1).describe('What is left open: a question, a promise, a tension.'),
  about: z.array(z.string()).default([]).describe('The names of the entries it touches.'),
});

const legInput = z.object({
  from: z.string().min(1).describe('The place the journey starts at.'),
  to: z.string().min(1).describe('The place it ends at.'),
  duration: z.string().min(1).describe("How long it took, in the setting's own words."),
  note: z.string().default('').describe('Who travelled and how, where that matters.'),
});

const sceneInput = z.object({
  run: runHandle,
  title: z.string().min(1).describe('A short title for the scene.'),
  starred: z.boolean().default(false).describe('A scene a later story could lean on: a first, an only, a turning point.'),
  when: z.string().min(1).describe('When it happens, as the setting says it.'),
  place: z.string().optional().describe('The name of the place it happens at.'),
  summary: z.string().min(1).describe('Two to four sentences. This is what every later resume reads.'),
  record: z.string().default('').describe('Everything worth keeping that the summary leaves out: who was there, what changed, anchors, lines as spoken.'),
  steer: z.string().default('').describe('What the author directed at this scene, in their words.'),
  situationAfter: z.string().min(1).describe('Where things stand now, in a short paragraph. Only the present: the store keeps what came before.'),
  readings: z.array(clockReadingInput).default([]).describe("Where each of the run's clocks stands at this scene."),
  entries: z.array(entryInput).default([]).describe('Anyone and anything named for the first time.'),
  facts: z.array(factInput).default([]).describe('What this scene established or changed.'),
  notes: z.array(noteInput).default([]).describe('What happened to or with each entry in this scene: its trail.'),
  rulings: z.array(rulingInput).default([]).describe('Instructions given at this scene, kept word for word.'),
  threadsOpened: z.array(threadInput).default([]).describe('What this scene left open.'),
  threadsClosed: z.array(z.object({ thread: z.string().min(1).describe('The id of the thread.'), resolution: z.string().min(1).describe('How it closed, in a sentence.') })).default([]).describe('Threads this scene closed.'),
  waypointsReached: z.array(z.string()).default([]).describe('The ids of waypoints this scene reached.'),
  legs: z.array(legInput).default([]).describe('Journeys travelled for the first time in this scene.'),
});

export interface OperationDefinition<Input extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** A short title a person reads. */
  title: string;
  /** What it does, for the model that will call it. */
  description: string;
  effect: Effect;
  audience: Audience;
  input: Input;
}

function operation<Input extends z.ZodTypeAny>(definition: OperationDefinition<Input>): OperationDefinition<Input> {
  return definition;
}

export const OPERATIONS = {
  list_runs: operation({
    name: 'list_runs',
    title: 'List the runs',
    description: 'Every run the store holds, with its slug, how many scenes it has and where it stands.',
    effect: 'reads',
    audience: 'story',
    input: z.object({}),
  }),
  begin_run: operation({
    name: 'begin_run',
    title: 'Begin a run',
    description: 'Start a new story. Name its clocks here: each is one exact count the story keeps, such as days since an event.',
    effect: 'writes',
    audience: 'story',
    input: z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe('A short handle in lower case with hyphens.'),
      title: z.string().min(1).describe("The story's title."),
      setting: z.string().default('').describe('Where and when it is set, in a sentence or two.'),
      status: z.enum(RUN_STATUSES).default('binding').describe('`binding`, the usual case: what the story establishes is canon at once. `telling`: its facts stay inside the run.'),
      continues: z.string().optional().describe('The slug of the run this one follows on from.'),
      register: z.string().default('').describe('How it is narrated: voice, spelling, point of view.'),
      clocks: z.array(z.object({
        name: z.string().min(1).describe("The clock's name, such as the name of a count of days."),
        countsFrom: z.string().default('').describe('What it counts and from what, in words.'),
      })).default([]).describe('The exact counts the story keeps side by side.'),
      waypoints: z.array(z.string()).default([]).describe('Scenes the author wants the run to reach.'),
    }),
  }),
  resume_run: operation({
    name: 'resume_run',
    title: 'Resume a run',
    description:
      'Read this first in any chat that continues a story. It answers with the present of the run, sized to fit: the clocks, where things stand, who and what is about to be on the page, the threads and rulings that bear on them, and the last few scenes. It says what it left out and which operation fetches it. Name who and where the next scene is likely to involve, so the right detail is served.',
    effect: 'reads',
    audience: 'story',
    input: z.object({
      run: runHandle,
      upcoming: z.array(z.string()).default([]).describe('Names of people, places and things the next scene is likely to involve.'),
      budgetBytes: z.number().int().min(2000).max(200000).default(20000).describe('How large the answer may be.'),
    }),
  }),
  save_scene: operation({
    name: 'save_scene',
    title: 'Save a scene',
    description:
      'Save a finished scene and what it established. What a story establishes is canon at once and kept with the scene it came from. One thing is held back: a fact that would replace something the author stated. That is kept as a collision for the author, and the answer says so. Give only what is new or changed; the store keeps everything said before.',
    effect: 'writes',
    audience: 'story',
    input: sceneInput,
  }),
  redo_scene: operation({
    name: 'redo_scene',
    title: 'Redo a scene',
    description: 'Replace a scene the author had redone. The earlier take is struck and kept, never served again, and what it established is taken back with it.',
    effect: 'writes',
    audience: 'story',
    input: sceneInput.extend({ number: sceneNumber.describe('The number of the scene being redone.') }),
  }),
  read_scene: operation({
    name: 'read_scene',
    title: 'Read a scene',
    description: 'One scene in full: its summary, its record, the steer and what it established.',
    effect: 'reads',
    audience: 'story',
    input: z.object({ run: runHandle, number: sceneNumber }),
  }),
  list_scenes: operation({
    name: 'list_scenes',
    title: 'List scenes',
    description: 'The summaries of a stretch of scenes, in order. Use it to look back further than a resume shows.',
    effect: 'reads',
    audience: 'story',
    input: z.object({
      run: runHandle,
      from: sceneNumber.optional().describe('The first scene to list. Left out, the first of the run.'),
      to: sceneNumber.optional().describe('The last scene to list. Left out, the newest.'),
      starredOnly: z.boolean().default(false).describe('True to list only the starred scenes.'),
    }),
  }),
  look_up: operation({
    name: 'look_up',
    title: 'Look somebody or something up',
    description: 'What is so now of a person, place or thing: every fact that still holds, and the last things that happened to them. Ask with history to see what was so before.',
    effect: 'reads',
    audience: 'story',
    input: z.object({
      run: runHandle,
      name: z.string().min(1).describe('The name, or another name it goes by.'),
      withHistory: z.boolean().default(false).describe('True to include what was so before, newest first.'),
      trail: z.number().int().min(0).max(200).default(8).describe('How many of the latest trail notes to include.'),
    }),
  }),
  find: operation({
    name: 'find',
    title: 'Find',
    description: 'Search a run for a word or phrase across names, facts, trail notes, scenes, rulings and threads. Use it before inventing anything that may already exist.',
    effect: 'reads',
    audience: 'story',
    input: z.object({ run: runHandle, text: z.string().min(2).describe('The word or phrase to look for.'), limit: z.number().int().min(1).max(100).default(30).describe('The most results to answer with.') }),
  }),
  list_rulings: operation({
    name: 'list_rulings',
    title: 'List rulings',
    description: 'The rulings that bear on a topic or on named entries, word for word. With neither given, every ruling still in force.',
    effect: 'reads',
    audience: 'story',
    input: z.object({ run: runHandle, topic: z.string().optional().describe('A topic to narrow to, such as narration.'), about: z.array(z.string()).default([]).describe('Names of entries to narrow to.') }),
  }),
  list_threads: operation({
    name: 'list_threads',
    title: 'List threads',
    description: 'What is still open in a run, optionally only what touches the named entries.',
    effect: 'reads',
    audience: 'story',
    input: z.object({ run: runHandle, about: z.array(z.string()).default([]).describe('Names of entries to narrow to.'), includeClosed: z.boolean().default(false).describe('True to list closed threads as well.') }),
  }),
  record_ruling: operation({
    name: 'record_ruling',
    title: 'Record a ruling',
    description: 'Keep an instruction from the author word for word, outside a scene save.',
    effect: 'writes',
    audience: 'story',
    input: rulingInput.extend({ run: runHandle }),
  }),
  state_fact: operation({
    name: 'state_fact',
    title: 'State a fact',
    description: "State what is so, in the author's name. It replaces what the property held and outranks anything a story said.",
    effect: 'writes',
    audience: 'author',
    input: z.object({
      run: runHandle,
      entry: z.string().min(1),
      property: z.string().min(1),
      value: z.string(),
      about: z.string().optional(),
      visibility: z.enum(VISIBILITIES).default('open'),
      note: z.string().default(''),
    }),
  }),
  list_collisions: operation({
    name: 'list_collisions',
    title: 'List collisions',
    description: 'Every place a story tried to replace something the author stated, with both sides.',
    effect: 'reads',
    audience: 'author',
    input: z.object({ run: runHandle, waitingOnly: z.boolean().default(true) }),
  }),
  settle_collision: operation({
    name: 'settle_collision',
    title: 'Settle a collision',
    description: "Decide one collision: keep the author's fact, or take the story's in its place.",
    effect: 'writes',
    audience: 'author',
    input: z.object({ collision: z.string().min(1), take: z.enum(['author', 'story']) }),
  }),
  import_run: operation({
    name: 'import_run',
    title: 'Import a run kept by hand',
    description:
      'Read a run out of the five Markdown files a story kept by hand (log, state, cast, items, places) and write it as one run. A file the run did not keep is left empty; all five empty is refused. A slug already in the store is refused, unless replaceEarlierImport is true and that run holds nothing but an earlier import of it: then the earlier run is removed and the files are imported in its place, in one transaction. The answer counts what was read, and what was removed where an earlier import was replaced, and lists every line the reader could not place.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe('A short handle in lower case with hyphens.'),
      title: z.string().optional().describe("Left out, the title is read from the files' own heading."),
      setting: z.string().optional(),
      status: z.enum(RUN_STATUSES).optional(),
      files: z.object({
        log: z.string().default(''),
        state: z.string().default(''),
        cast: z.string().default(''),
        items: z.string().default(''),
        places: z.string().default(''),
      }).describe('The text of each of the five files.'),
      replaceEarlierImport: z.boolean().default(false).describe(
        'True to replace a run of this slug that an earlier import made, with everything it holds, by what these files say. Refused where that run holds anything written after it was imported (a scene saved, a fact or ruling stated, a collision) or where another run continues from it, so nothing but an import is ever removed. Left false, a slug already in the store is refused.',
      ),
    }),
  }),
  read_run: operation({
    name: 'read_run',
    title: 'Read a whole run',
    description: 'Everything a run holds, author-only material included. For the author\'s own pages.',
    effect: 'reads',
    audience: 'author',
    input: z.object({ run: runHandle }),
  }),
} as const;

export type OperationName = keyof typeof OPERATIONS;
export type InputOf<Name extends OperationName> = z.infer<(typeof OPERATIONS)[Name]['input']>;
/** What a caller may send: defaults not yet filled in. */
export type RequestOf<Name extends OperationName> = z.input<(typeof OPERATIONS)[Name]['input']>;

export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

export type SceneInput = z.infer<typeof sceneInput>;
export type FactInput = z.infer<typeof factInput>;
export type EntryInput = z.infer<typeof entryInput>;
export type RulingInput = z.infer<typeof rulingInput>;
