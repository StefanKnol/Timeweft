/**
 * Reading a whole run, and filtering it for who it is served to.
 *
 * The filter is the one place the rule "author-only material never reaches a story" is kept for
 * whole-run reads. It works on what is served rather than on what is hidden: an id is only ever
 * passed on where the entry it names is itself served, so nothing can point a story at an entry
 * it was not given.
 *
 * Waypoints are served to a story. They are never shown in the narration, but they are what the
 * writer steers by, and a story chat is the writer. A withdrawn one is not.
 *
 * What the author changed in place (the run, an entry, a waypoint's words) keeps its earlier values
 * as history rows. Those are the author's: a story reads each thing as it is now.
 */
import type { Kysely } from 'kysely';
import type { ClockReading, RunSnapshot, ThreadRecord } from '@timeweft/contract';
import type { Database } from './database.ts';
import { normaliseName } from './names.ts';
import {
  clockFromRow, collisionFromRow, entryEditFromRow, entryFromRow, factFromRow, legFromRow, noteFromRow,
  rulingFromRow, runEditFromRow, runFromRow, sceneFromRow, threadFromRow, waypointFromRow,
  waypointRewordingFromRow, type RunRow,
} from './rows.ts';

export async function readWholeRun(database: Kysely<Database>, run: RunRow): Promise<RunSnapshot> {
  const runId = run.id;
  const clocks = await database.selectFrom('clocks').selectAll().where('run_id', '=', runId).orderBy('position').execute();
  const scenes = await database.selectFrom('scenes').selectAll().where('run_id', '=', runId)
    .orderBy('number').orderBy('written_order').execute();
  const readings = await database.selectFrom('scene_readings')
    .innerJoin('scenes', 'scenes.id', 'scene_readings.scene_id')
    .select(['scene_readings.scene_id', 'scene_readings.clock_id', 'scene_readings.count', 'scene_readings.part_of_day'])
    .where('scenes.run_id', '=', runId).orderBy('scene_readings.position').execute();
  const entries = await database.selectFrom('entries').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const facts = await database.selectFrom('facts').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const notes = await database.selectFrom('entry_notes').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const rulings = await database.selectFrom('rulings').selectAll().where('run_id', '=', runId).orderBy('number').execute();
  const rulingAbout = await database.selectFrom('ruling_about_entries')
    .innerJoin('rulings', 'rulings.id', 'ruling_about_entries.ruling_id')
    .select(['ruling_about_entries.ruling_id as owner', 'ruling_about_entries.entry_id'])
    .where('rulings.run_id', '=', runId).orderBy('ruling_about_entries.position').execute();
  const threads = await readThreadRecords(database, runId);
  const waypoints = await database.selectFrom('waypoints').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const legs = await database.selectFrom('journey_legs').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const collisions = await database.selectFrom('collisions').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const runEdits = await database.selectFrom('run_edits').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const entryEdits = await database.selectFrom('entry_edits').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const waypointRewordings = await database.selectFrom('waypoint_rewordings').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();

  const readingsByScene = groupBy(readings, (reading) => reading.scene_id, (reading): ClockReading => ({
    clockId: reading.clock_id, count: reading.count, partOfDay: reading.part_of_day,
  }));
  const rulingAboutByRuling = groupBy(rulingAbout, (row) => row.owner, (row) => row.entry_id);

  return {
    run: runFromRow(run),
    clocks: clocks.map(clockFromRow),
    scenes: scenes.map((row) => sceneFromRow(row, readingsByScene.get(row.id) ?? [])),
    entries: entries.map(entryFromRow),
    facts: facts.map(factFromRow),
    notes: notes.map(noteFromRow),
    rulings: rulings.map((row) => rulingFromRow(row, rulingAboutByRuling.get(row.id) ?? [])),
    threads,
    waypoints: waypoints.map(waypointFromRow),
    legs: legs.map(legFromRow),
    collisions: collisions.map(collisionFromRow),
    runEdits: runEdits.map(runEditFromRow),
    entryEdits: entryEdits.map(entryEditFromRow),
    waypointRewordings: waypointRewordings.map(waypointRewordingFromRow),
  };
}

/**
 * A run's threads as served, in the order written, each with what it is about, its standing touches
 * and the scene it was last touched in. Given ids, only those threads, still in the order written.
 */
export async function readThreadRecords(database: Kysely<Database>, runId: string, onlyThreadIds?: string[]): Promise<ThreadRecord[]> {
  if (onlyThreadIds !== undefined && onlyThreadIds.length === 0) return [];
  let threadQuery = database.selectFrom('threads').selectAll().where('run_id', '=', runId);
  if (onlyThreadIds !== undefined) threadQuery = threadQuery.where('id', 'in', onlyThreadIds);
  const threads = await threadQuery.orderBy('written_order').execute();
  if (threads.length === 0) return [];
  const threadIds = threads.map((thread) => thread.id);
  const about = await database.selectFrom('thread_about_entries')
    .select(['thread_id as owner', 'entry_id'])
    .where('thread_id', 'in', threadIds).orderBy('position').execute();
  const touches = await database.selectFrom('thread_touches')
    .innerJoin('scenes', 'scenes.id', 'thread_touches.scene_id')
    .select(['thread_touches.thread_id as owner', 'thread_touches.scene_id', 'thread_touches.note', 'scenes.number', 'scenes.status'])
    .where('thread_touches.thread_id', 'in', threadIds).orderBy('thread_touches.written_order').execute();
  const standingScenes = await database.selectFrom('scenes').select(['id', 'number'])
    .where('run_id', '=', runId).where('status', '=', 'standing').execute();
  const standing = new Map(standingScenes.map((scene) => [scene.id, scene.number]));
  const aboutByThread = groupBy(about, (row) => row.owner, (row) => row.entry_id);
  const touchesByThread = groupBy(touches, (row) => row.owner, (row) => ({
    sceneId: row.scene_id, note: row.note, sceneNumber: row.number, sceneStanding: row.status === 'standing',
  }));
  return threads.map((row) => threadFromRow(row, aboutByThread.get(row.id) ?? [], touchesByThread.get(row.id) ?? [], standing));
}

function groupBy<Row, Value>(rows: Row[], keyOf: (row: Row) => string, valueOf: (row: Row) => Value): Map<string, Value[]> {
  const groups = new Map<string, Value[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(valueOf(row));
    groups.set(key, group);
  }
  return groups;
}

/**
 * What a story may be served of a whole run. Struck scenes and everything they established are
 * gone; author-only entries, facts and notes are gone; anything belonging to or pointing at an
 * entry that is not served is gone or has the pointer taken out; a journey leg naming an author-only
 * entry is gone; collisions, the author's history
 * rows and withdrawn waypoints are the author's.
 */
export function filterForStory(whole: RunSnapshot): RunSnapshot {
  const standingSceneIds = new Set(whole.scenes.filter((scene) => scene.status === 'standing').map((scene) => scene.id));
  const struckSceneIds = new Set(whole.scenes.filter((scene) => scene.status === 'struck').map((scene) => scene.id));
  const isStruck = (sceneId: string | null): boolean => sceneId !== null && struckSceneIds.has(sceneId);

  const entries = whole.entries.filter((entry) => entry.visibility === 'open' && !isStruck(entry.introducedInSceneId));
  const servedEntryIds = new Set(entries.map((entry) => entry.id));
  const isServed = (entryId: string | null): boolean => entryId === null || servedEntryIds.has(entryId);
  // A journey leg names its places by text, not by id, so a leg is kept only where neither end is a
  // name of an author-only entry that no served entry also goes by: otherwise the leg would tell a
  // story the hidden entry's name.
  const namesOf = (entry: { name: string; alsoKnownAs: string[] }): string[] => [entry.name, ...entry.alsoKnownAs].map(normaliseName);
  const servedNames = new Set(entries.flatMap(namesOf));
  const hiddenNames = new Set(whole.entries.filter((entry) => entry.visibility !== 'open').flatMap(namesOf));
  const namesAHiddenEntry = (place: string): boolean => {
    const name = normaliseName(place);
    return hiddenNames.has(name) && !servedNames.has(name);
  };

  return {
    run: whole.run,
    clocks: whole.clocks,
    scenes: whole.scenes
      .filter((scene) => standingSceneIds.has(scene.id))
      .map((scene) => (isServed(scene.placeEntryId) ? scene : { ...scene, placeEntryId: null })),
    entries,
    facts: whole.facts.filter((fact) =>
      fact.visibility === 'open' && servedEntryIds.has(fact.entryId) && isServed(fact.aboutEntryId)
      && !isStruck(fact.fromSceneId) && !isStruck(fact.untilSceneId)),
    notes: whole.notes.filter((note) =>
      note.visibility === 'open' && servedEntryIds.has(note.entryId) && standingSceneIds.has(note.sceneId)),
    rulings: whole.rulings
      .filter((ruling) => !isStruck(ruling.sceneId))
      .map((ruling) => ({ ...ruling, aboutEntryIds: ruling.aboutEntryIds.filter((id) => servedEntryIds.has(id)) })),
    threads: whole.threads
      .filter((thread) => !isStruck(thread.openedInSceneId))
      .map((thread) => ({ ...thread, aboutEntryIds: thread.aboutEntryIds.filter((id) => servedEntryIds.has(id)) })),
    waypoints: whole.waypoints
      .filter((waypoint) => waypoint.withdrawnInSceneId === null)
      .map((waypoint) => (isStruck(waypoint.reachedInSceneId) ? { ...waypoint, reachedInSceneId: null } : waypoint)),
    legs: whole.legs.filter((leg) => !isStruck(leg.sceneId) && !namesAHiddenEntry(leg.fromPlace) && !namesAHiddenEntry(leg.toPlace)),
    collisions: [],
    runEdits: [],
    entryEdits: [],
    waypointRewordings: [],
  };
}
