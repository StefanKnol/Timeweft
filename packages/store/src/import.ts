/**
 * Writing a whole run read from hand-kept files, in one transaction.
 *
 * Everything is checked before anything is written, and every problem found is named in one
 * refusal, so a file that needs fixing is fixed once rather than once per problem. Ids are made
 * here and rows are written in batches, which is what lets a run of hundreds of scenes and tens
 * of thousands of facts go in within seconds.
 *
 * Decisions the files cannot make for themselves:
 * - Facts are given oldest first within a property. Each one is closed at the scene of the next
 *   one along that has a known scene. Where no later one has a known scene, it is closed at the
 *   run's newest scene, since the files say a newer fact held by then.
 * - A trail note on a scene number the files do not have is a refusal naming it. Attaching it to
 *   the nearest scene would put it somewhere it never happened.
 * - A thread marked closed and a waypoint marked reached, with no scene saying when, are closed
 *   or reached at the run's newest scene: the files say so as of then.
 * - Rows are recorded as written by the scene they belong to, so a redo of the newest imported
 *   scene takes back what that scene established, as it would for a saved one.
 */
import { randomUUID } from 'node:crypto';
import type { Insertable, Kysely } from 'kysely';
import { Refusal, type ImportedRun } from '@timeweft/contract';
import type { Database, FactsTable, EntryNotesTable } from './database.ts';
import { NameIndex, normaliseName } from './names.ts';
import { exactCount } from './checks.ts';

/** Rows per insert, kept well under PostgreSQL's limit of 65,535 parameters in one statement. */
const ROWS_PER_BATCH = 2000;

async function insertInBatches<Table extends keyof Database>(database: Kysely<Database>, table: Table, rows: Insertable<Database[Table]>[]): Promise<void> {
  for (let start = 0; start < rows.length; start += ROWS_PER_BATCH) {
    await database.insertInto(table).values(rows.slice(start, start + ROWS_PER_BATCH) as never).execute();
  }
}

export async function importRunInto(database: Kysely<Database>, imported: ImportedRun): Promise<void> {
  const existing = await database.selectFrom('runs').select('id').where('slug', '=', imported.slug).executeTakeFirst();
  if (existing !== undefined) throw new Refusal(`A run called "${imported.slug}" already exists, so it was not imported again.`);

  const problems: string[] = [];
  const runId = randomUUID();

  const clockIds = new Map<string, string>();
  const clockRows = imported.clocks.map((clock, position) => {
    const id = randomUUID();
    if (clockIds.has(normaliseName(clock.name))) problems.push(`Two clocks are called "${clock.name}".`);
    clockIds.set(normaliseName(clock.name), id);
    return { id, run_id: runId, name: clock.name.trim(), counts_from: clock.countsFrom, position };
  });

  const sceneIds = new Map<number, string>();
  for (const scene of imported.scenes) {
    if (sceneIds.has(scene.number)) problems.push(`Scene ${scene.number} appears twice.`);
    sceneIds.set(scene.number, randomUUID());
  }
  const newestSceneNumber = imported.scenes.reduce((highest, scene) => Math.max(highest, scene.number), 0);
  const newestSceneId = sceneIds.get(newestSceneNumber) ?? null;
  const sceneIdFor = (number: number | null, where: string): string | null => {
    if (number === null) return null;
    const id = sceneIds.get(number);
    if (id === undefined) problems.push(`${where} names scene ${number}, which the files do not have.`);
    return id ?? null;
  };

  const entryRows = imported.entries.map((entry) => ({
    id: randomUUID(), run_id: runId, kind: entry.kind, name: entry.name.trim(),
    also_known_as: entry.alsoKnownAs.map((name) => name.trim()).filter((name) => name !== ''),
    pronoun: entry.pronoun, introduced_in_scene_id: sceneIdFor(entry.introducedInScene, `The entry "${entry.name}"`),
    source: 'import', visibility: entry.visibility,
  }));
  const names = new NameIndex(entryRows.map((row) => ({ ...row, alsoKnownAs: row.also_known_as })));
  const entryIdFor = (name: string, where: string): string | null => {
    const holders = names.find(name);
    if (holders.length === 0) problems.push(`${where} names "${name}", which no entry is called.`);
    if (holders.length > 1) problems.push(`${where} names "${name}", which ${holders.length} entries answer to: ${holders.map((holder) => holder.name).join(', ')}.`);
    return holders.length === 1 ? holders[0]!.id : null;
  };

  const sceneRows = imported.scenes.map((scene) => ({
    id: sceneIds.get(scene.number)!, run_id: runId, number: scene.number, title: scene.title, starred: scene.starred,
    when_typed: scene.whenTyped, place_entry_id: scene.place === null ? null : entryIdFor(scene.place, `Scene ${scene.number}'s place`),
    summary: scene.summary, record: scene.record, steer: scene.steer, situation_after: scene.situationAfter, status: 'standing',
  }));
  const readingRows = imported.scenes.flatMap((scene) => scene.readings.flatMap((reading, position) => {
    const clockId = clockIds.get(normaliseName(reading.clock));
    if (clockId === undefined) {
      problems.push(`Scene ${scene.number} reads a clock called "${reading.clock}", which the run does not keep.`);
      return [];
    }
    let count = reading.count;
    try {
      count = exactCount(reading.count, reading.clock);
    } catch (refusal) {
      problems.push(`Scene ${scene.number}: ${(refusal as Error).message}`);
    }
    return [{ scene_id: sceneIds.get(scene.number)!, clock_id: clockId, count, part_of_day: reading.partOfDay, position }];
  }));

  const factRows: Insertable<FactsTable>[] = [];
  const noteRows: Insertable<EntryNotesTable>[] = [];
  imported.entries.forEach((entry, entryPosition) => {
    const entryRow = entryRows[entryPosition]!;
    const factsByProperty = new Map<string, typeof entry.facts>();
    for (const fact of entry.facts) {
      const list = factsByProperty.get(fact.property) ?? [];
      list.push(fact);
      factsByProperty.set(fact.property, list);
    }
    for (const [property, facts] of factsByProperty) {
      facts.forEach((fact, index) => {
        const fromSceneId = sceneIdFor(fact.fromScene, `A fact on "${entry.name}"`);
        let untilSceneId: string | null = null;
        let closedBySceneId: string | null = null;
        if (index < facts.length - 1) {
          const nextKnown = facts.slice(index + 1).find((later) => later.fromScene !== null && sceneIds.has(later.fromScene));
          if (nextKnown !== undefined) {
            untilSceneId = sceneIds.get(nextKnown.fromScene!)!;
            closedBySceneId = untilSceneId;
          } else if (newestSceneId !== null) {
            // Closed by the newest scene as a date, not by that scene's doing, so a redo of it leaves this closed.
            untilSceneId = newestSceneId;
          } else {
            problems.push(`"${entry.name}" has more than one ${property} but the run has no scene for the older to stop holding at.`);
          }
        }
        factRows.push({
          id: randomUUID(), run_id: runId, entry_id: entryRow.id, property, value: fact.value, about_entry_id: null,
          from_scene_id: fromSceneId, until_scene_id: untilSceneId, source: fact.source, visibility: entry.visibility,
          note: fact.note, established_by_scene_id: fromSceneId, closed_by_scene_id: closedBySceneId,
        });
      });
    }
    for (const note of entry.trail) {
      const sceneId = sceneIdFor(note.scene, `A trail note on "${entry.name}"`);
      if (sceneId === null) continue;
      noteRows.push({ id: randomUUID(), run_id: runId, entry_id: entryRow.id, scene_id: sceneId, text: note.text, visibility: entry.visibility });
    }
  });

  const rulingRows = imported.rulings.map((ruling, index) => {
    const sceneId = sceneIdFor(ruling.scene, `Ruling ${index + 1}`);
    return {
      row: {
        id: randomUUID(), run_id: runId, number: index + 1, text: ruling.text, source: ruling.source, scope: ruling.scope,
        topics: ruling.topics, scene_id: sceneId, withdrawn_in_scene_id: null, established_by_scene_id: sceneId,
      },
      aboutIds: [...new Set(ruling.about.map((name) => entryIdFor(name, `Ruling ${index + 1}`)).filter((id): id is string => id !== null))],
    };
  });

  const closedAtTheEnd = (what: string): string | null => {
    if (newestSceneId === null) problems.push(`${what} is marked done, but the run has no scene to say it was done by.`);
    return newestSceneId;
  };
  const threadRows = imported.threads.map((thread, index) => {
    const openedInSceneId = sceneIdFor(thread.openedInScene, `Thread ${index + 1}`);
    const closedInSceneId = thread.closed ? closedAtTheEnd(`Thread ${index + 1}`) : null;
    return {
      row: {
        id: randomUUID(), run_id: runId, text: thread.text, opened_in_scene_id: openedInSceneId,
        closed_in_scene_id: closedInSceneId, resolution: thread.closed ? thread.resolution : '',
        established_by_scene_id: openedInSceneId, closed_by_scene_id: null,
      },
      aboutIds: [...new Set(thread.about.map((name) => entryIdFor(name, `Thread ${index + 1}`)).filter((id): id is string => id !== null))],
    };
  });
  const waypointRows = imported.waypoints.map((waypoint, index) => ({
    id: randomUUID(), run_id: runId, text: waypoint.text,
    reached_in_scene_id: waypoint.reached ? closedAtTheEnd(`Waypoint ${index + 1}`) : null,
  }));
  const legRows = imported.legs.map((leg, index) => ({
    id: randomUUID(), run_id: runId, from_place: leg.from, to_place: leg.to, duration: leg.duration, note: leg.note,
    scene_id: sceneIdFor(leg.scene, `Journey leg ${index + 1}`),
  }));

  if (problems.length > 0) {
    throw new Refusal(`The run was not imported. ${problems.length === 1 ? 'One thing needs' : `${problems.length} things need`} fixing first: ${problems.join(' ')}`);
  }

  await database.insertInto('runs').values({
    id: runId, slug: imported.slug, title: imported.title, setting: imported.setting, status: imported.status,
    continues_run_id: null, register: imported.register,
  }).execute();
  await insertInBatches(database, 'clocks', clockRows);
  await insertInBatches(database, 'entries', entryRows);
  await insertInBatches(database, 'scenes', sceneRows);
  await insertInBatches(database, 'scene_readings', readingRows);
  await insertInBatches(database, 'facts', factRows);
  await insertInBatches(database, 'entry_notes', noteRows);
  await insertInBatches(database, 'rulings', rulingRows.map((ruling) => ruling.row));
  await insertInBatches(database, 'ruling_about_entries', rulingRows.flatMap((ruling) =>
    ruling.aboutIds.map((entryId, position) => ({ ruling_id: ruling.row.id, entry_id: entryId, position }))));
  await insertInBatches(database, 'threads', threadRows.map((thread) => thread.row));
  await insertInBatches(database, 'thread_about_entries', threadRows.flatMap((thread) =>
    thread.aboutIds.map((entryId, position) => ({ thread_id: thread.row.id, entry_id: entryId, position }))));
  await insertInBatches(database, 'waypoints', waypointRows);
  await insertInBatches(database, 'journey_legs', legRows);
}
