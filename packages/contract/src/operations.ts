/**
 * Every action the app can take, written once.
 *
 * The web route, the MCP tool and its description, and the tests that hold them are all made from
 * this list. Nothing is reachable that is not in it, so a route and a tool cannot disagree about
 * what an action takes, and an action nobody classified cannot exist.
 */
import { z } from 'zod';
import { ENTRY_KINDS, RULING_SCOPES, RUN_STATUSES, VISIBILITIES } from './records.ts';
import { RUN_EXPORT_FORMAT_NAME, RUN_SLUG_PATTERN } from './run-export.ts';

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
  threadsTouched: z.array(z.object({
    thread: z.string().min(1).describe('The id of an open thread of this run.'),
    note: z.string().default('').describe('What moved, in a sentence or less. Served with the thread.'),
  })).default([]).describe('Open threads this scene moved on without opening or closing them, so a resume ranks them as live. A thread closed here counts as touched without being named here.'),
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
      slug: z.string().regex(RUN_SLUG_PATTERN).describe('A short handle in lower case with hyphens.'),
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
      'Save a finished scene and what it established. What a story establishes is canon at once and kept with the scene it came from. One thing is held back: a fact that would replace something the author stated. That is kept as a collision for the author, and the answer says so. Give only what is new or changed; the store keeps everything said before. Name in threadsTouched each open thread the scene moved on without closing it, so a resume ranks it by its latest move rather than by the scene it opened in.',
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
    description: 'What is still open in a run, optionally only what touches the named entries. The thread a scene moved last comes first: by the scene that last opened, touched or closed it, newest first, then by the scene it opened in, then the latest written.',
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
    description:
      "State what is so, in the author's name. It replaces what the property held in its own lane (open, or author-only) and outranks anything a story said; the author's own earlier fact is replaced without a collision. Name the entry by id (entryId) or by name (entry), one of the two. Dated to the newest standing scene.",
    effect: 'writes',
    audience: 'author',
    input: z.object({
      run: runHandle,
      entry: z.string().min(1).optional().describe('The name of the entry the fact is about. Give this or entryId, not both.'),
      entryId: z.string().min(1).optional().describe('The id of the entry the fact is about. Give this or entry, not both.'),
      property: z.string().min(1).describe('What is being said: who, standing, state, voice, where, what, held by, or any other.'),
      value: z.string().describe('What is so, in a sentence or less.'),
      about: z.string().optional().describe('The name of another entry the fact points at, such as who holds an item. Give this or aboutEntryId, or neither.'),
      aboutEntryId: z.string().min(1).optional().describe('The id of another entry the fact points at. Give this or about, or neither.'),
      visibility: z.enum(VISIBILITIES).default('open').describe('`open`, the usual case: a story is told it. `author-only`: only the author\'s pages show it.'),
      note: z.string().default('').describe('A remark on the fact, where one is needed.'),
    }),
  }),
  end_fact: operation({
    name: 'end_fact',
    title: 'End a fact',
    description:
      'Say that a fact simply stops holding, with nothing in its place. The fact is closed as of the newest standing scene and kept as history. Refused where the fact is closed already, or the run has no scene yet for it to stop at.',
    effect: 'writes',
    audience: 'author',
    input: z.object({ fact: z.string().min(1).describe('The id of the fact that stops holding.') }),
  }),
  withdraw_ruling: operation({
    name: 'withdraw_ruling',
    title: 'Withdraw a ruling',
    description:
      'Say that a ruling no longer applies. It is withdrawn as of the newest standing scene, kept word for word, and no longer told to a story. Refused where it is withdrawn already, or the run has no scene yet.',
    effect: 'writes',
    audience: 'author',
    input: z.object({ ruling: z.string().min(1).describe('The id of the ruling that no longer applies.') }),
  }),
  add_waypoint: operation({
    name: 'add_waypoint',
    title: 'Add a waypoint',
    description: 'Add a scene the author wants the run to reach. A story is told to steer towards it and never to narrate it.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      run: runHandle,
      text: z.string().min(1).describe('The scene to reach, in a sentence or two.'),
    }),
  }),
  reword_waypoint: operation({
    name: 'reword_waypoint',
    title: 'Reword a waypoint',
    description: 'Give a waypoint new words. It keeps its id, and what it said before is kept as history. Refused for a withdrawn waypoint, or where the words are the same.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      waypoint: z.string().min(1).describe('The id of the waypoint.'),
      text: z.string().min(1).describe('The new words for it.'),
    }),
  }),
  mark_waypoint_reached: operation({
    name: 'mark_waypoint_reached',
    title: 'Mark a waypoint reached',
    description: 'Say that a waypoint was reached at a scene the author names. A redo of that scene leaves it reached as of the new take. Refused where it is reached or withdrawn already.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      waypoint: z.string().min(1).describe('The id of the waypoint.'),
      scene: sceneNumber.describe('The number of the standing scene that reached it.'),
    }),
  }),
  withdraw_waypoint: operation({
    name: 'withdraw_waypoint',
    title: 'Withdraw a waypoint',
    description: 'Say that the run need no longer reach a waypoint. It is kept, readable on the author\'s pages, and no longer told to a story. Refused where it is withdrawn already, or the run has no scene yet.',
    effect: 'writes',
    audience: 'author',
    input: z.object({ waypoint: z.string().min(1).describe('The id of the waypoint.') }),
  }),
  edit_run: operation({
    name: 'edit_run',
    title: 'Edit a run',
    description: "Change a run's title, setting, register or status. Give only what changes. Each earlier value is kept with when it changed. Refused where nothing given differs from what the run holds.",
    effect: 'writes',
    audience: 'author',
    input: z.object({
      run: runHandle,
      title: z.string().min(1).optional().describe("The story's new title. Left out, it stays as it is."),
      setting: z.string().optional().describe('Where and when it is set, in a sentence or two. Left out, it stays as it is.'),
      register: z.string().optional().describe('How it is narrated: voice, spelling, point of view. Left out, it stays as it is.'),
      status: z.enum(RUN_STATUSES).optional().describe('`binding`: what the story establishes is canon at once. `telling`: its facts stay inside the run. Left out, it stays as it is.'),
    }),
  }),
  open_thread: operation({
    name: 'open_thread',
    title: 'Open a thread',
    description: 'Leave something open in the run: a question, a promise, a tension. Opened as of the newest standing scene. A thread is told to a story, so it may be about open entries only; an author-only one is refused.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      run: runHandle,
      text: z.string().min(1).describe('What is left open.'),
      aboutEntryIds: z.array(z.string().min(1)).default([]).describe('The ids of the open entries it touches.'),
    }),
  }),
  touch_thread: operation({
    name: 'touch_thread',
    title: 'Touch a thread',
    description: 'Say that an open thread moved on, without opening or closing it, so a resume ranks it as live. Touched at the newest standing scene. Refused where the thread is closed, the run has no scene yet, or that scene touched it already.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      thread: z.string().min(1).describe('The id of an open thread.'),
      note: z.string().default('').describe('What moved, in a sentence or less.'),
    }),
  }),
  close_thread: operation({
    name: 'close_thread',
    title: 'Close a thread',
    description: 'Close an open thread with how it resolved, as of the newest standing scene. Refused where it is closed already, or the run has no scene yet.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      thread: z.string().min(1).describe('The id of an open thread.'),
      resolution: z.string().min(1).describe('How it resolved, in a sentence.'),
    }),
  }),
  add_entry: operation({
    name: 'add_entry',
    title: 'Add an entry',
    description: 'Add a person, group, place, item or other to a run, in the author\'s name. An author-only entry is never told to a story. Where the name already answers to an entry, it is added all the same and the answer says so.',
    effect: 'writes',
    audience: 'author',
    input: entryInput.extend({
      run: runHandle,
      visibility: z.enum(VISIBILITIES).default('open').describe('`open`, the usual case: a story is told of it. `author-only`: only the author\'s pages show it.'),
    }),
  }),
  edit_entry: operation({
    name: 'edit_entry',
    title: 'Edit an entry',
    description: "Change an entry's other names, pronoun or kind. Give only what changes; other names given replace the whole list. Each earlier value is kept with when it changed. Refused where nothing given differs.",
    effect: 'writes',
    audience: 'author',
    input: z.object({
      entry: z.string().min(1).describe('The id of the entry.'),
      kind: z.enum(ENTRY_KINDS).optional().describe('What it is now. Left out, it stays as it is.'),
      alsoKnownAs: z.array(z.string()).optional().describe('Every other name it goes by, as the whole new list. Left out, the list stays as it is.'),
      pronoun: z.string().optional().describe('For a person: how the narration refers to them. Left out, it stays as it is.'),
    }),
  }),
  rename_entry: operation({
    name: 'rename_entry',
    title: 'Rename an entry',
    description: 'Give an entry a new name. The old name joins its other names, so it is still found by it, and the change is kept with when it was made. Where the new name already answers to another entry, it is renamed all the same and the answer says so.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      entry: z.string().min(1).describe('The id of the entry.'),
      name: z.string().min(1).describe('The name it is known by from now on.'),
    }),
  }),
  set_entry_visibility: operation({
    name: 'set_entry_visibility',
    title: 'Turn an entry open or author-only',
    description: 'Turn an entry author-only, which takes it, its facts, its trail and every journey leg naming it out of every story answer at once, or open again, which puts them all back. Nothing else is changed, and the change is kept with when it was made.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      entry: z.string().min(1).describe('The id of the entry.'),
      visibility: z.enum(VISIBILITIES).describe('`open`: a story is told of it. `author-only`: only the author\'s pages show it.'),
    }),
  }),
  list_collisions: operation({
    name: 'list_collisions',
    title: 'List collisions',
    description: 'Every place a story tried to replace something the author stated, with both sides.',
    effect: 'reads',
    audience: 'author',
    input: z.object({ run: runHandle, waitingOnly: z.boolean().default(true).describe('True, the usual case, to list only those still waiting for the author.') }),
  }),
  settle_collision: operation({
    name: 'settle_collision',
    title: 'Settle a collision',
    description: "Decide one collision: keep the author's fact, or take the story's in its place.",
    effect: 'writes',
    audience: 'author',
    input: z.object({
      collision: z.string().min(1).describe('The id of the collision.'),
      take: z.enum(['author', 'story']).describe("`author` to keep the author's fact, `story` to take the story's in its place."),
    }),
  }),
  import_run: operation({
    name: 'import_run',
    title: 'Import a run kept by hand',
    description:
      'Read a run out of the five Markdown files a story kept by hand (log, state, cast, items, places) and write it as one run. A file the run did not keep is left empty; all five empty is refused. A slug already in the store is refused, unless replaceEarlierImport is true and that run holds nothing but an earlier import of it: then the earlier run is removed and the files are imported in its place, in one transaction. The answer counts what was read, and what was removed where an earlier import was replaced, and lists every line the reader could not place.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      slug: z.string().regex(RUN_SLUG_PATTERN).describe('A short handle in lower case with hyphens.'),
      title: z.string().optional().describe("Left out, the title is read from the files' own heading."),
      setting: z.string().optional().describe('Where and when it is set, in a sentence or two. Left out, empty.'),
      status: z.enum(RUN_STATUSES).optional().describe('`binding` or `telling`. Left out, binding.'),
      files: z.object({
        log: z.string().default('').describe('The text of log.md.'),
        state: z.string().default('').describe('The text of state.md.'),
        cast: z.string().default('').describe('The text of cast.md.'),
        items: z.string().default('').describe('The text of items.md.'),
        places: z.string().default('').describe('The text of places.md.'),
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
  export_run: operation({
    name: 'export_run',
    title: 'Export a run',
    description:
      'Everything a run holds, author-only material included, as one document a backup file holds: every scene with its struck takes, every fact with its whole history, the trail, rulings, threads and their touches, waypoints and their rewordings, journeys, clocks, collisions, and every change the author made, each row exactly as the store keeps it, ids, order written and times kept. For the author\'s backups; restore_run puts it back.',
    effect: 'reads',
    audience: 'author',
    input: z.object({ run: runHandle }),
  }),
  restore_run: operation({
    name: 'restore_run',
    title: 'Restore a run from a backup',
    description:
      'Put a run back exactly as an export of it held it, ids, order written and times kept, in one transaction. Refused where a run with the same id or the same slug is already in the store, unless replace is true; refused where the run it continues from is not in the store; refused for a document in a format version this server does not read, with a sentence saying which versions it reads.',
    effect: 'writes',
    audience: 'author',
    input: z.object({
      document: z.object({
        // Taken as given and checked by the backup's own reader, so a file whose format or version
        // is missing or of the wrong kind is refused in the same sentence on every door.
        formatName: z.unknown().describe(`What kind of document this is. A backup of a run says "${RUN_EXPORT_FORMAT_NAME}".`),
        formatVersion: z.unknown().describe('The version of the format it was written in, as a whole number.'),
      }).passthrough().describe('The whole content of a backup file, exactly as export_run answered it.'),
      replace: z.boolean().default(false).describe(
        'True to remove the run already in the store under this id or slug, with everything it holds, and put the backup in its place, in one transaction, so a refused or failed restore leaves that run as it was. Refused where the id and the slug belong to two different runs, or where another run continues from the run removed and the backup is a different run. Left false, a run already there is refused and nothing is changed.',
      ),
    }),
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
