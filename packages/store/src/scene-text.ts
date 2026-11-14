/**
 * The two author reads of a scene's words: one take's record, and a search of every scene's words.
 *
 * The author's run page reads the run without the records (`outlineOfSnapshot`), so the prose is
 * fetched here one take at a time, and searched here in the store rather than in the page. Both are
 * the author's alone: the contract gives them the author's audience, so a story caller is refused
 * before either runs, and neither is an MCP tool. They read struck takes, which a story never sees.
 */
import type { Kysely } from 'kysely';
import {
  Refusal, SEARCHED_SCENE_FIELDS,
  type InputOf, type SceneSearchMatch, type SceneSearchResult, type SceneStatus, type SceneText, type SearchedSceneField,
} from '@timeweft/contract';
import type { Database } from './database.ts';
import { looksLikeAnId } from './checks.ts';

/** About how long an excerpt is, in characters, before it is cut back to a word boundary. */
export const EXCERPT_LENGTH = 160;
/** How much of the excerpt, at most, comes before the match. */
const EXCERPT_LEAD = 60;
const ELLIPSIS = '…';

async function runIdOfSlug(database: Kysely<Database>, runSlug: string): Promise<string> {
  const run = await database.selectFrom('runs').select('id').where('slug', '=', runSlug).executeTakeFirst();
  if (run === undefined) throw new Refusal(`There is no run called "${runSlug}".`);
  return run.id;
}

export async function readSceneText(database: Kysely<Database>, input: InputOf<'read_scene_text'>): Promise<SceneText> {
  const runId = await runIdOfSlug(database, input.run);
  const noSuchScene = new Refusal(`The run "${input.run}" holds no scene with the id "${input.sceneId}".`);
  // An id that is not a uuid would make PostgreSQL itself refuse the query, in words of its own.
  if (!looksLikeAnId(input.sceneId)) throw noSuchScene;
  const scene = await database.selectFrom('scenes').select(['id', 'number', 'status', 'record'])
    .where('run_id', '=', runId).where('id', '=', input.sceneId).executeTakeFirst();
  if (scene === undefined) throw noSuchScene;
  return { sceneId: scene.id, number: scene.number, status: scene.status as SceneStatus, record: scene.record };
}

/** The text as a LIKE pattern matching it anywhere, with `%`, `_` and `\` read as themselves. */
export function likePatternHolding(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** A case-blind regular expression matching the text exactly as typed, every character read as itself. */
function caseBlindExpressionFor(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
}

/**
 * About `EXCERPT_LENGTH` characters of a field around a match, cut on word boundaries, with an
 * ellipsis where it was cut, and where the match now starts in it. Every white space character is
 * read as one space, so a record's line breaks do not break the excerpt and no offset moves.
 */
export function excerptAround(fieldText: string, matchStart: number, matchLength: number): { excerpt: string; matchStart: number; matchLength: number } {
  const text = fieldText.replace(/\s/gu, ' ');
  const matchEnd = matchStart + matchLength;
  let start = Math.max(0, matchStart - EXCERPT_LEAD);
  let end = Math.min(text.length, Math.max(matchEnd, start + EXCERPT_LENGTH));
  // Move each cut to a word boundary without cutting into the match.
  if (start > 0) {
    const nextSpace = text.indexOf(' ', start);
    start = nextSpace !== -1 && nextSpace < matchStart ? nextSpace + 1 : start;
  }
  if (end < text.length) {
    const previousSpace = text.lastIndexOf(' ', end);
    end = previousSpace >= matchEnd ? previousSpace : end;
  }
  const leading = start > 0 ? ELLIPSIS : '';
  const trailing = end < text.length ? ELLIPSIS : '';
  const body = text.slice(start, end);
  const trimmedBody = body.replace(/^ +/u, '');
  const trimmedAtStart = body.length - trimmedBody.length;
  return {
    excerpt: `${leading}${trimmedBody.replace(/ +$/u, '')}${trailing}`,
    matchStart: leading.length + matchStart - start - trimmedAtStart,
    matchLength,
  };
}

const COLUMN_OF_FIELD: Record<SearchedSceneField, 'title' | 'summary' | 'record' | 'steer' | 'situation_after'> = {
  title: 'title', summary: 'summary', record: 'record', steer: 'steer', situationAfter: 'situation_after',
};

export async function searchScenesIn(database: Kysely<Database>, input: InputOf<'search_scenes'>): Promise<SceneSearchResult> {
  const runId = await runIdOfSlug(database, input.run);
  const pattern = likePatternHolding(input.text);
  let query = database.selectFrom('scenes')
    .select(['id', 'number', 'status', 'title', 'summary', 'record', 'steer', 'situation_after'])
    .where('run_id', '=', runId)
    .where((builder) => builder.or(SEARCHED_SCENE_FIELDS.map((field) => builder(COLUMN_OF_FIELD[field], 'ilike', pattern))));
  if (!input.includeStruck) query = query.where('status', '=', 'standing');
  const rows = await query.orderBy('number', 'desc').orderBy('written_order', 'desc').execute();

  const expression = caseBlindExpressionFor(input.text);
  const matches: SceneSearchMatch[] = rows.slice(0, input.limit).map((row) => {
    for (const field of SEARCHED_SCENE_FIELDS) {
      const fieldText = row[COLUMN_OF_FIELD[field]];
      const found = expression.exec(fieldText);
      if (found !== null) {
        return { sceneId: row.id, number: row.number, status: row.status as SceneStatus, title: row.title, field, ...excerptAround(fieldText, found.index, found[0].length) };
      }
    }
    // PostgreSQL's case-blind match found it and JavaScript's did not (a letter the two fold
    // differently). The scene is still a match; its summary is shown, with no match marked.
    return { sceneId: row.id, number: row.number, status: row.status as SceneStatus, title: row.title, field: 'summary', ...excerptAround(row.summary, 0, 0) };
  });
  return { matches, total: rows.length };
}
