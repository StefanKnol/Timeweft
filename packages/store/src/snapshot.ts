/**
 * Reading a whole run, and filtering it for who it is served to.
 *
 * The filter is the one place the rule "author-only material never reaches a story" is kept for
 * whole-run reads. It works on what is served rather than on what is hidden: an id is only ever
 * passed on where the entry it names is itself served, so nothing can point a story at an entry
 * it was not given.
 *
 * Waypoints are served to a story. They are never shown in the narration, but they are what the
 * writer steers by, and a story chat is the writer.
 */
import type { Kysely } from 'kysely';
import type { ClockReading, RunSnapshot } from '@timeweft/contract';
import type { Database } from './database.ts';
import {
  clockFromRow, collisionFromRow, entryFromRow, factFromRow, legFromRow, noteFromRow,
  rulingFromRow, runFromRow, sceneFromRow, threadFromRow, waypointFromRow, type RunRow,
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
  const threads = await database.selectFrom('threads').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const threadAbout = await database.selectFrom('thread_about_entries')
    .innerJoin('threads', 'threads.id', 'thread_about_entries.thread_id')
    .select(['thread_about_entries.thread_id as owner', 'thread_about_entries.entry_id'])
    .where('threads.run_id', '=', runId).orderBy('thread_about_entries.position').execute();
  const waypoints = await database.selectFrom('waypoints').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const legs = await database.selectFrom('journey_legs').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();
  const collisions = await database.selectFrom('collisions').selectAll().where('run_id', '=', runId).orderBy('written_order').execute();

  const readingsByScene = groupBy(readings, (reading) => reading.scene_id, (reading): ClockReading => ({
    clockId: reading.clock_id, count: reading.count, partOfDay: reading.part_of_day,
  }));
  const rulingAboutByRuling = groupBy(rulingAbout, (row) => row.owner, (row) => row.entry_id);
  const threadAboutByThread = groupBy(threadAbout, (row) => row.owner, (row) => row.entry_id);

  return {
    run: runFromRow(run),
    clocks: clocks.map(clockFromRow),
    scenes: scenes.map((row) => sceneFromRow(row, readingsByScene.get(row.id) ?? [])),
    entries: entries.map(entryFromRow),
    facts: facts.map(factFromRow),
    notes: notes.map(noteFromRow),
    rulings: rulings.map((row) => rulingFromRow(row, rulingAboutByRuling.get(row.id) ?? [])),
    threads: threads.map((row) => threadFromRow(row, threadAboutByThread.get(row.id) ?? [])),
    waypoints: waypoints.map(waypointFromRow),
    legs: legs.map(legFromRow),
    collisions: collisions.map(collisionFromRow),
  };
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
 * entry that is not served is gone or has the pointer taken out; collisions are the author's.
 */
export function filterForStory(whole: RunSnapshot): RunSnapshot {
  const standingSceneIds = new Set(whole.scenes.filter((scene) => scene.status === 'standing').map((scene) => scene.id));
  const struckSceneIds = new Set(whole.scenes.filter((scene) => scene.status === 'struck').map((scene) => scene.id));
  const isStruck = (sceneId: string | null): boolean => sceneId !== null && struckSceneIds.has(sceneId);

  const entries = whole.entries.filter((entry) => entry.visibility === 'open' && !isStruck(entry.introducedInSceneId));
  const servedEntryIds = new Set(entries.map((entry) => entry.id));
  const isServed = (entryId: string | null): boolean => entryId === null || servedEntryIds.has(entryId);

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
    waypoints: whole.waypoints.map((waypoint) =>
      (isStruck(waypoint.reachedInSceneId) ? { ...waypoint, reachedInSceneId: null } : waypoint)),
    legs: whole.legs.filter((leg) => !isStruck(leg.sceneId)),
    collisions: [],
  };
}
