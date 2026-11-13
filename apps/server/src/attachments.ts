/**
 * What a chat may attach from the connector's menu: each run's briefing, each run's main
 * characters, and one prompt that starts a chat continuing a run.
 *
 * Every resource is a copy of an answer a story operation gives, made by the operation's own path
 * with the story audience: the briefing is what resume_run answers, and a person is what look_up
 * answers for them. Nothing here reads the store but through the story operations' snapshot, so
 * nothing author-only can reach an attachment that could not reach the tool (see
 * docs/decisions/0002). A person is reached by id where look_up reaches by name, so a person every
 * one of whose names another entry shares is readable here while look_up refuses each name; the
 * copy says so. A copy goes stale the
 * moment the story moves on, so each says so in its first line and names the tool for the present.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { ErrorCode, McpError, type ReadResourceResult, type Resource } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Refusal, type EntryRecord, type RunSnapshot, type Store } from '@timeweft/contract';
import { byteLengthOf, cutToFit, factsHoldingFor, lookUpEntryById, mainCharactersOf, onOneLine, resolveEntryByName } from '@timeweft/briefing';
import { entryLookupInWords, namesInTheRun } from './in-words.ts';
import { parseOperationInput, runOperation, snapshotForOperation } from './operations.ts';
import { resumeRunWithinItsWholeBudget } from './resume-run-over-mcp.ts';

export const BRIEFING_URI_TEMPLATE = 'timeweft://runs/{run}/briefing';
export const PERSON_URI_TEMPLATE = 'timeweft://runs/{run}/people/{entry}';

export const BRIEFING_COPY_LINE = 'This is a copy of the briefing, made when it was attached. resume_run gives the present.';
export const PERSON_COPY_LINE = 'This is a copy of what look_up answered, made when it was attached. look_up gives the present.';
/** The copy line for a person look_up cannot reach, since every name they go by is shared. */
export const PERSON_NOT_REACHED_BY_NAME_COPY_LINE = 'This is a copy of what look_up gives for this person, made by their id when it was attached. look_up cannot reach them by name now, since another entry shares every name they go by.';

/** The most a person's attached text may hold. A chat attaches several at once. */
export const LONGEST_ATTACHED_PERSON_BYTES = 60_000;

/** How long the line saying who somebody is may run in the menu. */
export const LONGEST_PERSON_DESCRIPTION_BYTES = 160;

export function briefingUri(runSlug: string): string {
  return `timeweft://runs/${runSlug}/briefing`;
}

export function personUri(runSlug: string, entryId: string): string {
  return `timeweft://runs/${runSlug}/people/${entryId}`;
}

/** A refusal said to the chat as a plain sentence; anything else is logged and said in general. */
function asProtocolError(error: unknown, whatWasAsked: string): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof Refusal) return new McpError(ErrorCode.InvalidParams, error.message);
  console.error(`Reading ${whatWasAsked} failed:`, error);
  return new McpError(ErrorCode.InternalError, 'The server failed while reading that. Try again, and tell the author if it keeps happening.');
}

/** The one value a URI template variable carries; a list is never a name here. */
function singleVariable(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** The runs a story may see, by the story operation that lists them. */
async function runsAStoryMaySee(store: Store): Promise<Array<{ slug: string; title: string }>> {
  const listings = await runOperation(store, 'list_runs', {}, 'story');
  return listings.map((listing) => ({ slug: listing.run.slug, title: listing.run.title }));
}

/** The line in the menu saying who somebody is, from the `who` fact that holds for them. */
function whoTheyAre(snapshot: RunSnapshot, person: EntryRecord, isTheMainCharacter: boolean): string {
  const who = factsHoldingFor(snapshot, person.id).find((fact) => fact.property === 'who');
  const said = who === undefined ? '' : onOneLine(who.value);
  const lead = isTheMainCharacter ? 'The main character. ' : '';
  const room = LONGEST_PERSON_DESCRIPTION_BYTES - byteLengthOf(lead);
  const body = said === '' ? `A person in ${onOneLine(snapshot.run.title)}; nothing yet says who they are.` : said;
  return `${lead}${byteLengthOf(body) <= room ? body : cutToFit(body, room) ?? ''}`;
}

async function listBriefings(store: Store): Promise<Resource[]> {
  return (await runsAStoryMaySee(store)).map((run) => ({
    uri: briefingUri(run.slug),
    name: `Briefing: ${run.title}`,
    description: `Where ${run.title} stands, as resume_run answers it.`,
    mimeType: 'text/markdown',
  }));
}

async function listMainCharacters(store: Store): Promise<Resource[]> {
  const resources: Resource[] = [];
  for (const run of await runsAStoryMaySee(store)) {
    const snapshot = await snapshotForOperation(store, 'look_up', run.slug);
    // Asked with no one beside, the list is the main character alone, where they are a person.
    const mainCharacterId = mainCharactersOf(snapshot, 0)[0]?.id;
    mainCharactersOf(snapshot).forEach((person) => {
      resources.push({
        uri: personUri(run.slug, person.id),
        name: `${person.name} (${run.title})`,
        description: whoTheyAre(snapshot, person, person.id === mainCharacterId),
        mimeType: 'text/markdown',
      });
    });
  }
  return resources;
}

export async function readBriefing(store: Store, runSlug: string): Promise<string> {
  const result = await resumeRunWithinItsWholeBudget(store, { run: runSlug });
  const text = (result.content as Array<{ type: string; text: string }>).map((part) => part.text).join('\n');
  return `${BRIEFING_COPY_LINE}\n\n${text}`;
}

/**
 * What look_up answers for one person of the run, by their id. Allowed for any open person of the
 * run, listed or not, so an attached pointer keeps working when the top ten changes; refused, in
 * one sentence that says nothing of what else exists, for anything else.
 */
export async function readPerson(store: Store, runSlug: string, entryId: string): Promise<string> {
  const snapshot = await snapshotForOperation(store, 'look_up', runSlug);
  const person = snapshot.entries.find((candidate) => candidate.id === entryId && candidate.kind === 'person');
  if (person === undefined) throw new Refusal(`No person of the run "${runSlug}" has the id "${entryId}". The list of resources says who may be attached.`);
  const asked = parseOperationInput('look_up', { run: runSlug, name: person.name }, 'story');
  const copyLine = lookUpReachesByName(snapshot, person) ? PERSON_COPY_LINE : PERSON_NOT_REACHED_BY_NAME_COPY_LINE;
  return `${copyLine}\n\n${lookUpWordsThatFit(snapshot, entryId, { withHistory: asked.withHistory, trail: asked.trail }, copyLine)}`;
}

/** Whether look_up, asked by some name the person goes by, answers with them rather than refusing. */
function lookUpReachesByName(snapshot: RunSnapshot, person: EntryRecord): boolean {
  return [person.name, ...person.alsoKnownAs].some((name) => {
    try {
      return resolveEntryByName(snapshot, name) !== null;
    } catch (error) {
      if (error instanceof Refusal) return false;
      throw error;
    }
  });
}

/**
 * look_up in words for one entry, no larger than LONGEST_ATTACHED_PERSON_BYTES. Where the answer
 * as look_up gives it is larger, the trail is cut to its newest part, a note at a time, and the
 * text says how many were left out; where even no trail is too large, the text itself is cut and
 * says so. Either way it names look_up as where the whole is.
 */
export function lookUpWordsThatFit(
  snapshot: RunSnapshot, entryId: string, options: { withHistory: boolean; trail: number }, copyLine: string = PERSON_COPY_LINE,
): string {
  const names = namesInTheRun(snapshot);
  const inWords = (trail: number): { text: string; trailServed: number } => {
    const lookup = lookUpEntryById(snapshot, entryId, { withHistory: options.withHistory, trail });
    if (lookup === null) throw new Refusal(`No entry of this run has the id "${entryId}".`);
    return { text: entryLookupInWords(lookup, names), trailServed: lookup.trail.length };
  };
  const asLookUpAnswers = inWords(options.trail);
  const room = LONGEST_ATTACHED_PERSON_BYTES - byteLengthOf(copyLine) - 2;
  if (byteLengthOf(asLookUpAnswers.text) <= room) return asLookUpAnswers.text;
  for (let trail = asLookUpAnswers.trailServed - 1; trail >= 0; trail -= 1) {
    const leftOut = asLookUpAnswers.trailServed - trail;
    const sentence = `\nTo keep this copy under ${LONGEST_ATTACHED_PERSON_BYTES} bytes, ${leftOut} of the newest ${asLookUpAnswers.trailServed} trail notes look_up gives were left out of it; look_up gives them whole.`;
    const fitted = inWords(trail).text + sentence;
    if (byteLengthOf(fitted) <= room) return fitted;
  }
  const sentence = `\nThe rest was cut to keep this copy under ${LONGEST_ATTACHED_PERSON_BYTES} bytes, the trail with it; look_up gives it whole.`;
  return (cutToFit(inWords(0).text, room - byteLengthOf(sentence)) ?? '') + sentence;
}

/** The message continue_run starts a chat with. Plain words, and nothing about the run itself. */
export function continueRunMessage(runSlug: string): string {
  return [
    `Continue the run "${runSlug}".`,
    `Before anything else, call resume_run with run "${runSlug}", and name in upcoming who and where the next scene involves, so the right detail is served.`,
    'Then confirm the pick-up point in two or three sentences: where things stand and what comes next.',
    'Write on from there, and save each finished scene with save_scene before starting the next.',
  ].join('\n');
}

export function registerTheAttachments(server: McpServer, store: Store): void {
  server.registerResource('briefing', new ResourceTemplate(BRIEFING_URI_TEMPLATE, { list: async () => ({ resources: await listBriefings(store) }) }), {
    title: 'A run\'s briefing',
    description: 'A copy of what resume_run answers for a run, made when it is attached.',
    mimeType: 'text/markdown',
  }, async (uri, variables): Promise<ReadResourceResult> => {
    const runSlug = singleVariable(variables['run']);
    try {
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readBriefing(store, runSlug) }] };
    } catch (error) {
      throw asProtocolError(error, uri.href);
    }
  });
  server.registerResource('person', new ResourceTemplate(PERSON_URI_TEMPLATE, { list: async () => ({ resources: await listMainCharacters(store) }) }), {
    title: 'A person of a run',
    description: 'A copy of what look_up answers for one person of a run, made when it is attached.',
    mimeType: 'text/markdown',
  }, async (uri, variables): Promise<ReadResourceResult> => {
    try {
      const text = await readPerson(store, singleVariable(variables['run']), singleVariable(variables['entry']));
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    } catch (error) {
      throw asProtocolError(error, uri.href);
    }
  });
  server.registerPrompt('continue_run', {
    title: 'Continue a run',
    description: 'Start a chat that picks a run up where it stands.',
    argsSchema: {
      run: completable(z.string().min(1).describe("The run's slug, as list_runs gives it."), async (typed) => {
        const runs = await runsAStoryMaySee(store);
        return runs.map((run) => run.slug).filter((slug) => slug.startsWith(typed.trim().toLowerCase()));
      }),
    },
  }, async ({ run }) => {
    const runSlug = run.trim();
    const known = (await runsAStoryMaySee(store)).some((candidate) => candidate.slug === runSlug);
    if (!known) throw new McpError(ErrorCode.InvalidParams, `There is no run called "${runSlug}".`);
    return {
      description: `Continue the run "${runSlug}".`,
      messages: [{ role: 'user', content: { type: 'text', text: continueRunMessage(runSlug) } }],
    };
  });
}
