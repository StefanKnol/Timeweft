/**
 * Every operation in the contract, run against the store. The web route and the MCP tool both
 * come through `runOperation`, so the two faces cannot disagree about what an operation takes or
 * answers.
 *
 * The handlers are a Record keyed by every operation name, so an operation added to the contract
 * without a handler here fails the typecheck rather than failing a caller.
 */
import {
  OPERATIONS, Refusal, readRunExportDocument,
  type AnswerByOperation, type Audience, type Id, type InputOf, type OperationName, type RunSnapshot, type Store,
} from '@timeweft/contract';
import {
  buildBriefing, findInRun, lookUpEntry, resolveEntryByName, rulingsBearingOn, sceneInFull, standingScenesOf,
  threadsOpenFor,
} from '@timeweft/briefing';
import type { ZodError } from 'zod';
import { importWeaverFiles, type ImportOptions } from './import-a-run.ts';

type Handler<Name extends OperationName> = (store: Store, input: InputOf<Name>) => Promise<AnswerByOperation[Name]>;

/**
 * Reads take the snapshot for the audience the contract gives the operation, never one chosen by
 * the caller. That is what keeps a story operation from ever seeing author-only material: the
 * store filters by audience where it reads.
 */
export function snapshotForOperation(store: Store, name: OperationName, runSlug: string): Promise<RunSnapshot> {
  return store.snapshotOf(runSlug, OPERATIONS[name].audience);
}

/** Names in a request turned into ids, refusing a name nothing in the run answers to. */
function entryIdsNamed(snapshot: RunSnapshot, names: string[]): Id[] {
  return names.map((name) => {
    const entry = resolveEntryByName(snapshot, name);
    if (entry === null) throw new Refusal(`Nothing in this run is called "${name.trim()}".`);
    return entry.id;
  });
}

export const OPERATION_HANDLERS: { [Name in OperationName]: Handler<Name> } = {
  list_runs: (store) => store.listRuns(),
  begin_run: (store, input) => store.beginRun(input),
  resume_run: async (store, input) => {
    const snapshot = await snapshotForOperation(store, 'resume_run', input.run);
    return buildBriefing(snapshot, { upcoming: input.upcoming, budgetBytes: input.budgetBytes });
  },
  save_scene: (store, input) => store.saveScene(input),
  redo_scene: (store, input) => store.redoScene(input),
  read_scene: async (store, input) => sceneInFull(await snapshotForOperation(store, 'read_scene', input.run), input.number),
  list_scenes: async (store, input) => {
    if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
      throw new Refusal(`The stretch from scene ${input.from} to scene ${input.to} runs backwards. Give the earlier number as "from".`);
    }
    const scenes = standingScenesOf(await snapshotForOperation(store, 'list_scenes', input.run));
    return scenes
      .filter((scene) => (input.from === undefined || scene.number >= input.from)
        && (input.to === undefined || scene.number <= input.to)
        && (!input.starredOnly || scene.starred))
      .map(({ record: _leftOutBecauseAListingIsShort, ...summary }) => summary);
  },
  look_up: async (store, input) => lookUpEntry(
    await snapshotForOperation(store, 'look_up', input.run), input.name, { withHistory: input.withHistory, trail: input.trail },
  ),
  find: async (store, input) => findInRun(await snapshotForOperation(store, 'find', input.run), input.text, input.limit),
  list_rulings: async (store, input) => {
    const snapshot = await snapshotForOperation(store, 'list_rulings', input.run);
    const filter: { topic?: string; aboutEntryIds: Id[] } = { aboutEntryIds: entryIdsNamed(snapshot, input.about) };
    if (input.topic !== undefined) filter.topic = input.topic;
    return rulingsBearingOn(snapshot, filter);
  },
  list_threads: async (store, input) => {
    const snapshot = await snapshotForOperation(store, 'list_threads', input.run);
    return threadsOpenFor(snapshot, { aboutEntryIds: entryIdsNamed(snapshot, input.about), includeClosed: input.includeClosed });
  },
  record_ruling: (store, input) => store.recordRuling(input),
  state_fact: (store, input) => store.stateFact(input),
  // The author's hand: each act goes to its own door in the store, which dates it by the rule in
  // docs/decisions/0003-the-authors-hand.md and refuses what that rule refuses.
  end_fact: (store, input) => store.endFact(input),
  withdraw_ruling: (store, input) => store.withdrawRuling(input),
  add_waypoint: (store, input) => store.addWaypoint(input),
  reword_waypoint: (store, input) => store.rewordWaypoint(input),
  mark_waypoint_reached: (store, input) => store.markWaypointReached(input),
  withdraw_waypoint: (store, input) => store.withdrawWaypoint(input),
  edit_run: (store, input) => store.editRun(input),
  open_thread: (store, input) => store.openThread(input),
  touch_thread: (store, input) => store.touchThread(input),
  close_thread: (store, input) => store.closeThread(input),
  add_entry: (store, input) => store.addEntry(input),
  edit_entry: (store, input) => store.editEntry(input),
  rename_entry: (store, input) => store.renameEntry(input),
  set_entry_visibility: (store, input) => store.setEntryVisibility(input),
  edit_scene: (store, input) => store.editScene(input),
  list_collisions: async (store, input) => {
    const snapshot = await snapshotForOperation(store, 'list_collisions', input.run);
    return snapshot.collisions.filter((collision) => !input.waitingOnly || collision.state === 'waiting');
  },
  settle_collision: (store, input) => store.settleCollision(input),
  // The author's run page: the run without the scenes' prose, which the two reads below fetch and
  // search. All three are the author's, so none is an MCP tool and a story caller is refused.
  read_run: (store, input) => store.outlineOf(input.run),
  read_scene_text: (store, input) => store.sceneTextOf(input),
  search_scenes: (store, input) => store.searchScenes(input),
  // The author is the only caller and the files are their own, so a refusal from the store, which
  // quotes them, goes back to them as it is.
  import_run: (store, input) => {
    const options: ImportOptions = { slug: input.slug };
    if (input.title !== undefined) options.title = input.title;
    if (input.setting !== undefined) options.setting = input.setting;
    if (input.status !== undefined) options.status = input.status;
    if (input.replaceEarlierImport) options.replaceEarlierImport = true;
    return importWeaverFiles(store, input.files, options);
  },
  // A backup is the author's alone and is never offered over MCP: the contract gives both
  // operations the author's audience, so a story caller is refused before either runs.
  export_run: (store, input) => store.exportRun(input.run),
  // The document's outer shape is read here; every row in it is the store's to check.
  restore_run: (store, input) => store.restoreRun(readRunExportDocument(input.document), { replace: input.replace }),
};

export function isOperationName(text: string): text is OperationName {
  return Object.hasOwn(OPERATIONS, text);
}

/** A parse failure said as one sentence per field, naming the field as the caller wrote it. */
export function inputRefusalSentence(name: OperationName, error: ZodError): string {
  const problems = error.issues.map((issue) => {
    const field = issue.path.length === 0 ? 'the input as a whole' : `"${issue.path.join('.')}"`;
    return `${field}: ${issue.message}`;
  });
  return `${name} could not take that input. ${problems.join('; ')}.`;
}

/**
 * Parses the input with the operation's own schema and runs it. `audienceAllowed` is who the
 * caller is: the author may run anything, and a story chat only the story operations.
 */
export async function runOperation<Name extends OperationName>(
  store: Store, name: Name, rawInput: unknown, audienceAllowed: Audience,
): Promise<AnswerByOperation[Name]> {
  const handler = OPERATION_HANDLERS[name] as Handler<Name>;
  return handler(store, parseOperationInput(name, rawInput, audienceAllowed));
}

/**
 * The one check every caller's input goes through: who may run the operation, and the input
 * parsed with the operation's own schema. A face that needs the parsed input before running
 * (the MCP briefing, sized to its whole tool result) asks this rather than parsing again.
 */
export function parseOperationInput<Name extends OperationName>(name: Name, rawInput: unknown, audienceAllowed: Audience): InputOf<Name> {
  const definition = OPERATIONS[name];
  if (definition.audience === 'author' && audienceAllowed !== 'author') {
    throw new Refusal(`${name} is the author's alone, and this caller is a story.`);
  }
  const parsed = definition.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new Refusal(inputRefusalSentence(name, parsed.error));
  return parsed.data as InputOf<Name>;
}
