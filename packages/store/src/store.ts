/**
 * The store's doors, on PostgreSQL.
 *
 * Every write is one transaction, and every write to a run first locks that run's row, so two
 * saves on one run happen one after the other and never interleave.
 *
 * How a redone scene is kept. The earlier take's scene row stays, marked `struck`, and every row
 * its save wrote keeps pointing at it, so the author can read the take whole. What it established
 * is taken back by closing it at the struck scene itself: a fact it started holds from that scene
 * until that scene, a ruling it gave is withdrawn at it, a thread it opened is closed at it. None
 * of those ever reads as in force. What the take closed is opened again, and anything the author
 * did after it that named it (a fact stated as of that scene), or that an import dated to it (a
 * thread's closing or touch), is moved onto the new take.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  Refusal, type CollisionRecord, type EntryRecord, type EntryWritten, type FactRecord, type InputOf, type RulingRecord,
  type RunListing, type RunRecord, type RunSnapshot, type SavedScene, type SceneInput, type Source, type Store,
  type ThreadRecord, type Visibility, type ImportedRun, type ClockReading, type ReplacedImport, type WaypointRecord,
  RunAlreadyExists,
} from '@timeweft/contract';
import type { Database } from './database.ts';
import { applyMigrations, WRITE_MARKS } from './migrations.ts';
import { NameIndex, normaliseName, normaliseProperty } from './names.ts';
import {
  collisionFromRow, entryFromRow, factFromRow, rulingFromRow, runFromRow, sceneFromRow, waypointFromRow,
  type EntryRow, type FactRow, type RunRow, type SceneRow,
} from './rows.ts';
import { filterForStory, readThreadRecords, readWholeRun } from './snapshot.ts';
import { importRunInto } from './import.ts';
import { markRunAsImported, replaceImportedRunIn } from './replace-imported-run.ts';
import { exactCount, looksLikeAnId } from './checks.ts';

type Audience = 'story' | 'author';

export class PostgresStore implements Store {
  readonly database: Kysely<Database>;

  constructor(database: Kysely<Database>) {
    this.database = database;
  }

  async migrate(): Promise<void> {
    await applyMigrations(this.database);
  }

  async close(): Promise<void> {
    await this.database.destroy();
  }

  async listRuns(): Promise<RunListing[]> {
    const runs = await this.database.selectFrom('runs').selectAll().orderBy('created_at').orderBy('slug').execute();
    const standing = await this.database.selectFrom('scenes')
      .select(['run_id', sql<number>`count(*)::int`.as('scene_count'), sql<number>`max(number)`.as('newest_number')])
      .where('status', '=', 'standing').groupBy('run_id').execute();
    const latestScenes = await this.database.selectFrom('scenes')
      .select(['run_id', 'number', 'title', 'when_typed'])
      .where('status', '=', 'standing')
      .where(sql<boolean>`number = (select max(newest.number) from scenes newest where newest.run_id = scenes.run_id and newest.status = 'standing')`)
      .execute();
    const openThreads = await this.database.selectFrom('threads')
      .select(['run_id', sql<number>`count(*)::int`.as('thread_count')])
      .where('closed_in_scene_id', 'is', null).groupBy('run_id').execute();
    const waiting = await this.database.selectFrom('collisions')
      .select(['run_id', sql<number>`count(*)::int`.as('collision_count')])
      .where('state', '=', 'waiting').groupBy('run_id').execute();
    return runs.map((run) => {
      const latest = latestScenes.find((scene) => scene.run_id === run.id);
      return {
        run: runFromRow(run),
        standingScenes: standing.find((row) => row.run_id === run.id)?.scene_count ?? 0,
        latest: latest === undefined ? null : { number: latest.number, title: latest.title, whenTyped: latest.when_typed },
        openThreads: openThreads.find((row) => row.run_id === run.id)?.thread_count ?? 0,
        waitingCollisions: waiting.find((row) => row.run_id === run.id)?.collision_count ?? 0,
      };
    });
  }

  async beginRun(input: InputOf<'begin_run'>): Promise<RunSnapshot> {
    await this.database.transaction().execute(async (transaction) => {
      const existing = await transaction.selectFrom('runs').select('id').where('slug', '=', input.slug).executeTakeFirst();
      if (existing !== undefined) throw new Refusal(`A run called "${input.slug}" already exists. Choose another slug.`);
      let continuesRunId: string | null = null;
      if (input.continues !== undefined) {
        const earlier = await transaction.selectFrom('runs').select('id').where('slug', '=', input.continues).executeTakeFirst();
        if (earlier === undefined) throw new Refusal(`There is no run called "${input.continues}" for this one to continue.`);
        continuesRunId = earlier.id;
      }
      const seenClockNames = new Set<string>();
      for (const clock of input.clocks) {
        const key = normaliseName(clock.name);
        if (seenClockNames.has(key)) throw new Refusal(`Two clocks are called "${clock.name}". Give each clock its own name.`);
        seenClockNames.add(key);
      }
      const runId = randomUUID();
      await transaction.insertInto('runs').values({
        id: runId, slug: input.slug, title: input.title, setting: input.setting, status: input.status,
        continues_run_id: continuesRunId, register: input.register,
      }).execute();
      if (input.clocks.length > 0) {
        await transaction.insertInto('clocks').values(input.clocks.map((clock, position) => ({
          id: randomUUID(), run_id: runId, name: clock.name.trim(), counts_from: clock.countsFrom, position,
        }))).execute();
      }
      if (input.waypoints.length > 0) {
        await transaction.insertInto('waypoints').values(input.waypoints.map((text) => ({
          id: randomUUID(), run_id: runId, text, reached_in_scene_id: null,
        }))).execute();
      }
    });
    return this.snapshotOf(input.slug, 'story');
  }

  async snapshotOf(runSlug: string, audience: Audience): Promise<RunSnapshot> {
    const whole = await this.database.transaction().setIsolationLevel('repeatable read').execute(async (transaction) => {
      const run = await transaction.selectFrom('runs').selectAll().where('slug', '=', runSlug).executeTakeFirst();
      if (run === undefined) throw new Refusal(`There is no run called "${runSlug}".`);
      return readWholeRun(transaction, run);
    });
    return audience === 'author' ? whole : filterForStory(whole);
  }

  async saveScene(input: InputOf<'save_scene'>): Promise<SavedScene> {
    return this.writeInRun(input.run, (transaction, run) => writeScene(transaction, run, input, null));
  }

  async redoScene(input: InputOf<'redo_scene'>): Promise<SavedScene> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const newest = await newestStandingScene(transaction, run.id);
      const target = await transaction.selectFrom('scenes').selectAll()
        .where('run_id', '=', run.id).where('number', '=', input.number).where('status', '=', 'standing')
        .executeTakeFirst();
      if (target === undefined || newest === undefined) {
        throw new Refusal(`The run "${run.slug}" has no standing scene ${input.number} to redo.`);
      }
      if (target.id !== newest.id) {
        throw new Refusal(`Only the newest scene can be redone, and that is scene ${newest.number}. Scene ${input.number} has scenes after it that may rest on it.`);
      }
      await strikeScene(transaction, target);
      return writeScene(transaction, run, input, target);
    });
  }

  async recordRuling(input: InputOf<'record_ruling'>): Promise<RulingRecord> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const names = await liveEntryIndex(transaction, run.id, 'story');
      const newest = await newestStandingScene(transaction, run.id);
      return writeRuling(transaction, run.id, input, names, newest?.id ?? null, null);
    });
  }

  async stateFact(input: InputOf<'state_fact'>): Promise<FactRecord> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const names = await liveEntryIndex(transaction, run.id, 'author');
      const entry = entryNamedOrById(names, input.entry, input.entryId, 'as the entry the fact is about', true)!;
      const about = entryNamedOrById(names, input.about, input.aboutEntryId, 'as what the fact is about', false);
      const newest = await newestStandingScene(transaction, run.id);
      const sceneId = newest?.id ?? null;
      const property = normaliseProperty(input.property);
      const value = wordsGiven(input.value, 'A value');
      // Each lane closes only its own: an author-only fact never ends an open one, or the story would
      // see a value end with nothing in its place, and an open fact never ends an author-only one.
      const holding = await holdingFacts(transaction, entry.id, property, input.visibility);
      const identical = holding.find((fact) =>
        fact.source === 'author' && fact.value === value && fact.about_entry_id === (about?.id ?? null));
      if (identical !== undefined) return factFromRow(identical);
      if (holding.length > 0 && sceneId === null) {
        throw new Refusal(`"${entry.name}" already holds a ${property} and the run has no scene yet for it to stop holding at. Save the first scene, then state this.`);
      }
      if (sceneId !== null) await closeFacts(transaction, holding, sceneId, null);
      return factFromRow(await insertFact(transaction, {
        runId: run.id, entryId: entry.id, property, value,
        aboutEntryId: about?.id ?? null, fromSceneId: sceneId, source: 'author',
        visibility: input.visibility, note: input.note, establishedBySceneId: null,
      }));
    });
  }

  async settleCollision(input: InputOf<'settle_collision'>): Promise<CollisionRecord> {
    if (!looksLikeAnId(input.collision)) throw new Refusal(`There is no collision with the id "${input.collision}".`);
    return this.database.transaction().execute(async (transaction) => {
      const found = await transaction.selectFrom('collisions').select('run_id').where('id', '=', input.collision).executeTakeFirst();
      if (found === undefined) throw new Refusal(`There is no collision with the id "${input.collision}".`);
      await transaction.selectFrom('runs').select('id').where('id', '=', found.run_id).forUpdate().execute();
      const collision = await transaction.selectFrom('collisions').selectAll().where('id', '=', input.collision).executeTakeFirstOrThrow();
      if (collision.state !== 'waiting') throw new Refusal(`That collision was settled already (${collision.state}).`);
      if (input.take === 'author') {
        const kept = await transaction.updateTable('collisions').set({ state: 'author-kept' })
          .where('id', '=', collision.id).returningAll().executeTakeFirstOrThrow();
        return collisionFromRow(kept);
      }
      const sceneId = collision.scene_id;
      if (sceneId === null) throw new Refusal('That collision came from no scene, so there is no scene for the author\'s fact to stop holding at.');
      const standingFact = await transaction.selectFrom('facts').selectAll().where('id', '=', collision.standing_fact_id).executeTakeFirstOrThrow();
      if (standingFact.visibility !== 'open') {
        // A story never sees the author-only lane, so no collision can concern it. A row that says
        // otherwise was written before that rule, and is not acted on.
        throw new Refusal('That collision stood against an author-only fact, which a story never meets. Keep the author\'s instead.');
      }
      if (standingFact.about_entry_id !== null) {
        // An open fact about an author-only entry is as unseen by a story as an author-only fact, so a
        // collision with it is a row from before that rule too, and is refused for the same reason.
        const about = await transaction.selectFrom('entries').select('visibility').where('id', '=', standingFact.about_entry_id).executeTakeFirstOrThrow();
        if (about.visibility !== 'open') {
          throw new Refusal('That collision stood against a fact about an author-only entry, which a story never meets. Keep the author\'s instead.');
        }
      }
      if (standingFact.until_scene_id !== null) {
        throw new Refusal('The author\'s fact that collision stood against has been replaced since, so the story\'s cannot be taken in its place. Keep the author\'s instead.');
      }
      const property = normaliseProperty(collision.property);
      const movedOnAt = await earliestLaterSceneHoldingTheProperty(transaction, collision.entry_id, property, sceneId);
      // Only the fact the collision names is closed. Anything a later scene established still holds.
      await closeFacts(transaction, [standingFact], sceneId, sceneId);
      // The story's fact goes in as though the scene's save had written it, so a redo of that scene takes it back too.
      // Where the property has moved on since that scene, it goes in as history: it held from the
      // collision's scene until the first later scene that established what holds now, and never
      // comes back to life over that.
      await insertFact(transaction, {
        runId: collision.run_id, entryId: collision.entry_id, property,
        value: collision.proposed_value, aboutEntryId: collision.proposed_about_entry_id,
        fromSceneId: sceneId, source: 'story', visibility: 'open', note: '', establishedBySceneId: sceneId,
        untilSceneId: movedOnAt, closedBySceneId: movedOnAt,
      });
      const taken = await transaction.updateTable('collisions').set({ state: 'story-taken' })
        .where('id', '=', collision.id).returningAll().executeTakeFirstOrThrow();
      return collisionFromRow(taken);
    });
  }

  /*
   * The author's hand. Every door below dates an act made outside a scene by one rule (see
   * docs/decisions/0003-the-authors-hand.md): to the newest standing scene of the run when the act
   * is made, with no scene's save recorded as having done it, so a redo of that scene carries the
   * act onto the new take (see moveOutsideReferencesOntoTheNewTake) and never takes it back. A row
   * changed in place takes a fresh write mark, so replacing an earlier import sees the change.
   */

  async endFact(input: InputOf<'end_fact'>): Promise<FactRecord> {
    const missing = `There is no fact with the id "${input.fact}".`;
    return this.writeInRunOf('facts', input.fact, missing, async (transaction, run) => {
      const fact = await transaction.selectFrom('facts').selectAll().where('id', '=', input.fact).executeTakeFirstOrThrow();
      if (fact.until_scene_id !== null) throw new Refusal(`The fact "${fact.property}: ${fact.value}" has stopped holding already.`);
      const newest = await newestSceneToStopAt(transaction, run, 'a fact to stop holding at');
      const ended = await transaction.updateTable('facts')
        .set({ until_scene_id: newest.id, closed_by_scene_id: null, write_mark: FRESH_WRITE_MARK })
        .where('id', '=', fact.id).returningAll().executeTakeFirstOrThrow();
      return factFromRow(ended);
    });
  }

  async withdrawRuling(input: InputOf<'withdraw_ruling'>): Promise<RulingRecord> {
    const missing = `There is no ruling with the id "${input.ruling}".`;
    return this.writeInRunOf('rulings', input.ruling, missing, async (transaction, run) => {
      const ruling = await transaction.selectFrom('rulings').selectAll().where('id', '=', input.ruling).executeTakeFirstOrThrow();
      if (ruling.withdrawn_in_scene_id !== null) throw new Refusal(`Ruling ${ruling.number} is withdrawn already.`);
      const newest = await newestSceneToStopAt(transaction, run, 'a ruling to be withdrawn at');
      const withdrawn = await transaction.updateTable('rulings')
        .set({ withdrawn_in_scene_id: newest.id, write_mark: FRESH_WRITE_MARK })
        .where('id', '=', ruling.id).returningAll().executeTakeFirstOrThrow();
      const about = await transaction.selectFrom('ruling_about_entries').select('entry_id')
        .where('ruling_id', '=', ruling.id).orderBy('position').execute();
      return rulingFromRow(withdrawn, about.map((row) => row.entry_id));
    });
  }

  async addWaypoint(input: InputOf<'add_waypoint'>): Promise<WaypointRecord> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const text = wordsGiven(input.text, 'A waypoint');
      const row = await transaction.insertInto('waypoints')
        .values({ id: randomUUID(), run_id: run.id, text, reached_in_scene_id: null })
        .returningAll().executeTakeFirstOrThrow();
      return waypointFromRow(row);
    });
  }

  async rewordWaypoint(input: InputOf<'reword_waypoint'>): Promise<WaypointRecord> {
    const missing = `There is no waypoint with the id "${input.waypoint}".`;
    return this.writeInRunOf('waypoints', input.waypoint, missing, async (transaction, run) => {
      const waypoint = await transaction.selectFrom('waypoints').selectAll().where('id', '=', input.waypoint).executeTakeFirstOrThrow();
      if (waypoint.withdrawn_in_scene_id !== null) throw new Refusal(`The waypoint "${waypoint.text}" is withdrawn, so it is not reworded.`);
      const text = wordsGiven(input.text, 'A waypoint');
      if (text === waypoint.text) throw new Refusal(`The waypoint already says "${waypoint.text}", so nothing was changed.`);
      const newest = await newestStandingScene(transaction, run.id);
      await transaction.insertInto('waypoint_rewordings').values({
        id: randomUUID(), run_id: run.id, waypoint_id: waypoint.id, earlier_text: waypoint.text, later_text: text,
        after_scene_id: newest?.id ?? null,
      }).execute();
      const reworded = await transaction.updateTable('waypoints').set({ text })
        .where('id', '=', waypoint.id).returningAll().executeTakeFirstOrThrow();
      return waypointFromRow(reworded);
    });
  }

  async markWaypointReached(input: InputOf<'mark_waypoint_reached'>): Promise<WaypointRecord> {
    const missing = `There is no waypoint with the id "${input.waypoint}".`;
    return this.writeInRunOf('waypoints', input.waypoint, missing, async (transaction, run) => {
      const waypoint = await transaction.selectFrom('waypoints').selectAll().where('id', '=', input.waypoint).executeTakeFirstOrThrow();
      if (waypoint.withdrawn_in_scene_id !== null) throw new Refusal(`The waypoint "${waypoint.text}" is withdrawn, so it is not marked reached.`);
      if (waypoint.reached_in_scene_id !== null) throw new Refusal(`The waypoint "${waypoint.text}" is reached already.`);
      const scene = await transaction.selectFrom('scenes').selectAll()
        .where('run_id', '=', run.id).where('number', '=', input.scene).where('status', '=', 'standing').executeTakeFirst();
      if (scene === undefined) throw new Refusal(`The run "${run.slug}" has no standing scene ${input.scene}.`);
      // No scene's save reached it, so a redo of that scene moves it onto the new take and leaves it reached.
      const reached = await transaction.updateTable('waypoints')
        .set({ reached_in_scene_id: scene.id, reached_by_scene_id: null, write_mark: FRESH_WRITE_MARK })
        .where('id', '=', waypoint.id).returningAll().executeTakeFirstOrThrow();
      return waypointFromRow(reached);
    });
  }

  async withdrawWaypoint(input: InputOf<'withdraw_waypoint'>): Promise<WaypointRecord> {
    const missing = `There is no waypoint with the id "${input.waypoint}".`;
    return this.writeInRunOf('waypoints', input.waypoint, missing, async (transaction, run) => {
      const waypoint = await transaction.selectFrom('waypoints').selectAll().where('id', '=', input.waypoint).executeTakeFirstOrThrow();
      if (waypoint.withdrawn_in_scene_id !== null) throw new Refusal(`The waypoint "${waypoint.text}" is withdrawn already.`);
      const newest = await newestSceneToStopAt(transaction, run, 'a waypoint to be withdrawn at');
      const withdrawn = await transaction.updateTable('waypoints')
        .set({ withdrawn_in_scene_id: newest.id, write_mark: FRESH_WRITE_MARK })
        .where('id', '=', waypoint.id).returningAll().executeTakeFirstOrThrow();
      return waypointFromRow(withdrawn);
    });
  }

  async editRun(input: InputOf<'edit_run'>): Promise<RunRecord> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const given: Array<['title' | 'setting' | 'register' | 'status', string | undefined]> = [
        ['title', input.title === undefined ? undefined : wordsGiven(input.title, 'A title')],
        ['setting', input.setting], ['register', input.register], ['status', input.status],
      ];
      const changed = given.filter((pair): pair is [typeof pair[0], string] => pair[1] !== undefined && pair[1] !== run[pair[0]]);
      if (changed.length === 0) throw new Refusal(`Nothing given differs from what the run "${run.slug}" holds, so nothing was changed.`);
      const newest = await newestStandingScene(transaction, run.id);
      await transaction.insertInto('run_edits').values(changed.map(([field, laterValue]) => ({
        id: randomUUID(), run_id: run.id, field, earlier_value: run[field], later_value: laterValue,
        after_scene_id: newest?.id ?? null,
      }))).execute();
      const edited = await transaction.updateTable('runs').set(Object.fromEntries(changed))
        .where('id', '=', run.id).returningAll().executeTakeFirstOrThrow();
      return runFromRow(edited);
    });
  }

  async openThread(input: InputOf<'open_thread'>): Promise<ThreadRecord> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const names = await liveEntryIndex(transaction, run.id, 'author');
      const aboutIds = uniqueIds(input.aboutEntryIds.map((id) => {
        const entry = names.byId(id);
        if (entry === null) throw new Refusal(`This run has no entry with the id "${id}" for the thread to be about.`);
        // A thread is told to a story, as a ruling is, so it may only be about an entry a story sees.
        if (entry.visibility !== 'open') {
          throw new Refusal(`"${entry.name}" is author-only, and a thread is told to a story, so a thread cannot be about it. Turn it open first, or leave it out.`);
        }
        return entry.id;
      }));
      const newest = await newestStandingScene(transaction, run.id);
      const row = await transaction.insertInto('threads').values({
        id: randomUUID(), run_id: run.id, text: wordsGiven(input.text, 'A thread'), opened_in_scene_id: newest?.id ?? null,
        closed_in_scene_id: null, resolution: '', established_by_scene_id: null, closed_by_scene_id: null,
      }).returningAll().executeTakeFirstOrThrow();
      if (aboutIds.length > 0) {
        await transaction.insertInto('thread_about_entries')
          .values(aboutIds.map((entryId, position) => ({ thread_id: row.id, entry_id: entryId, position }))).execute();
      }
      return (await readThreadRecords(transaction, run.id, [row.id]))[0]!;
    });
  }

  async touchThread(input: InputOf<'touch_thread'>): Promise<ThreadRecord> {
    const missing = `There is no thread with the id "${input.thread}".`;
    return this.writeInRunOf('threads', input.thread, missing, async (transaction, run) => {
      const thread = await openThreadOfThisRun(transaction, run.id, input.thread, 'touched');
      const newest = await newestSceneToStopAt(transaction, run, 'a thread to be touched at');
      const already = await transaction.selectFrom('thread_touches').select('note')
        .where('thread_id', '=', thread.id).where('scene_id', '=', newest.id).executeTakeFirst();
      if (already !== undefined) {
        throw new Refusal(`Scene ${newest.number} touched the thread "${thread.text}" already, so it was not touched again.`);
      }
      // No scene's save wrote it, so a redo of that scene moves it onto the new take.
      await transaction.insertInto('thread_touches')
        .values({ thread_id: thread.id, scene_id: newest.id, note: input.note.trim(), written_by_scene_id: null, by_author: true }).execute();
      // The touch row keeps no write mark of its own, so the thread takes a fresh one.
      await transaction.updateTable('threads').set({ write_mark: FRESH_WRITE_MARK }).where('id', '=', thread.id).execute();
      return (await readThreadRecords(transaction, run.id, [thread.id]))[0]!;
    });
  }

  async closeThread(input: InputOf<'close_thread'>): Promise<ThreadRecord> {
    const missing = `There is no thread with the id "${input.thread}".`;
    return this.writeInRunOf('threads', input.thread, missing, async (transaction, run) => {
      const thread = await openThreadOfThisRun(transaction, run.id, input.thread, 'closed');
      const newest = await newestSceneToStopAt(transaction, run, 'a thread to be closed at');
      await transaction.updateTable('threads')
        .set({ closed_in_scene_id: newest.id, resolution: wordsGiven(input.resolution, 'A resolution'), closed_by_scene_id: null, write_mark: FRESH_WRITE_MARK })
        .where('id', '=', thread.id).execute();
      return (await readThreadRecords(transaction, run.id, [thread.id]))[0]!;
    });
  }

  async addEntry(input: InputOf<'add_entry'>): Promise<EntryWritten> {
    return this.writeInRun(input.run, async (transaction, run) => {
      const names = await liveEntryIndex(transaction, run.id, 'author');
      const name = wordsGiven(input.name, 'A name');
      const alsoKnownAs = cleanNames(input.alsoKnownAs);
      const cautions = namesAnsweringElsewhere(names, [name, ...alsoKnownAs], null);
      const row = await transaction.insertInto('entries').values({
        id: randomUUID(), run_id: run.id, kind: input.kind, name, also_known_as: alsoKnownAs,
        pronoun: input.pronoun.trim(), introduced_in_scene_id: null, source: 'author', visibility: input.visibility,
      }).returningAll().executeTakeFirstOrThrow();
      return { entry: entryFromRow(row), cautions };
    });
  }

  async editEntry(input: InputOf<'edit_entry'>): Promise<EntryWritten> {
    return this.writeEntry(input.entry, async (transaction, run, entry, names) => {
      const changes: EntryChange[] = [];
      if (input.kind !== undefined && input.kind !== entry.kind) changes.push({ field: 'kind', earlier: entry.kind, later: input.kind });
      if (input.pronoun !== undefined && input.pronoun.trim() !== entry.pronoun) {
        changes.push({ field: 'pronoun', earlier: entry.pronoun, later: input.pronoun.trim() });
      }
      let cautions: string[] = [];
      if (input.alsoKnownAs !== undefined) {
        const alsoKnownAs = cleanNames(input.alsoKnownAs);
        if (JSON.stringify(alsoKnownAs) !== JSON.stringify(entry.also_known_as)) {
          changes.push({ field: 'alsoKnownAs', earlier: entry.also_known_as, later: alsoKnownAs });
          cautions = namesAnsweringElsewhere(names, alsoKnownAs, entry.id);
        }
      }
      if (changes.length === 0) throw new Refusal(`Nothing given differs from what "${entry.name}" holds, so nothing was changed.`);
      return { entry: await writeEntryChanges(transaction, run, entry, changes), cautions };
    });
  }

  async renameEntry(input: InputOf<'rename_entry'>): Promise<EntryWritten> {
    return this.writeEntry(input.entry, async (transaction, run, entry, names) => {
      const name = wordsGiven(input.name, 'A name');
      if (name === entry.name) throw new Refusal(`The entry is called "${entry.name}" already, so nothing was changed.`);
      // The old name joins the other names, so it is still found by it; the new name leaves them,
      // since it is the name now. Both are compared case-blind, as names are found.
      const alsoKnownAs = entry.also_known_as.filter((other) => normaliseName(other) !== normaliseName(name));
      if (!alsoKnownAs.some((other) => normaliseName(other) === normaliseName(entry.name))) alsoKnownAs.push(entry.name);
      const changes: EntryChange[] = [{ field: 'name', earlier: entry.name, later: name }];
      if (JSON.stringify(alsoKnownAs) !== JSON.stringify(entry.also_known_as)) {
        changes.push({ field: 'alsoKnownAs', earlier: entry.also_known_as, later: alsoKnownAs });
      }
      const cautions = namesAnsweringElsewhere(names, [name], entry.id);
      return { entry: await writeEntryChanges(transaction, run, entry, changes), cautions };
    });
  }

  async setEntryVisibility(input: InputOf<'set_entry_visibility'>): Promise<EntryWritten> {
    return this.writeEntry(input.entry, async (transaction, run, entry, names) => {
      if (input.visibility === entry.visibility) throw new Refusal(`"${entry.name}" is ${entry.visibility} already, so nothing was changed.`);
      // Every story read filters by the entry, so its facts, its trail and every pointer at it leave
      // or come back with this one change, and nothing else is closed or moved. Turned open, it may
      // now share a name with an entry a story made meanwhile, and the author is told so.
      const cautions = input.visibility === 'open'
        ? namesAnsweringElsewhere(names, [entry.name, ...entry.also_known_as], entry.id, (holder) => holder.visibility === 'open')
        : [];
      return { entry: await writeEntryChanges(transaction, run, entry, [{ field: 'visibility', earlier: entry.visibility, later: input.visibility }]), cautions };
    });
  }

  async importRun(run: ImportedRun): Promise<RunSnapshot> {
    await this.database.transaction().execute(async (transaction) => {
      const existing = await transaction.selectFrom('runs').select(['id', 'imported_through']).where('slug', '=', run.slug).executeTakeFirst();
      if (existing !== undefined) throw new RunAlreadyExists(run.slug, existing.imported_through !== null);
      await importRunInto(transaction, run);
      await markRunAsImported(transaction, run.slug);
    });
    return this.snapshotOf(run.slug, 'author');
  }

  async replaceImportedRun(run: ImportedRun): Promise<ReplacedImport> {
    const removed = await this.database.transaction().execute((transaction) => replaceImportedRunIn(transaction, run));
    return { snapshot: await this.snapshotOf(run.slug, 'author'), removed };
  }

  /**
   * Runs `work` in one transaction holding the lock on the run that owns the row with this id. An id
   * of no such row, or text that is no id at all, is refused with `missing`.
   */
  private async writeInRunOf<Answer>(
    table: TableOwnedByARun, id: string, missing: string,
    work: (transaction: Kysely<Database>, run: RunRow) => Promise<Answer>,
  ): Promise<Answer> {
    if (!looksLikeAnId(id)) throw new Refusal(missing);
    return this.database.transaction().execute(async (transaction) => {
      const found = await transaction.selectFrom(table as 'facts').select('run_id').where('id', '=', id).executeTakeFirst();
      if (found === undefined) throw new Refusal(missing);
      const run = await transaction.selectFrom('runs').selectAll().where('id', '=', found.run_id).forUpdate().executeTakeFirstOrThrow();
      return work(transaction, run);
    });
  }

  /** Like writeInRunOf for an entry, handing over the entry and every entry of its run by name. */
  private async writeEntry<Answer>(
    entryId: string,
    work: (transaction: Kysely<Database>, run: RunRow, entry: EntryRow, names: NameIndex<IndexedEntry>) => Promise<Answer>,
  ): Promise<Answer> {
    return this.writeInRunOf('entries', entryId, `There is no entry with the id "${entryId}".`, async (transaction, run) => {
      const entry = await transaction.selectFrom('entries').selectAll().where('id', '=', entryId).executeTakeFirstOrThrow();
      const names = await liveEntryIndex(transaction, run.id, 'author');
      if (names.byId(entry.id) === null) {
        throw new Refusal(`"${entry.name}" was introduced by a scene that has since been redone, and the new take took it back, so it is not changed.`);
      }
      return work(transaction, run, entry, names);
    });
  }

  private async writeInRun<Answer>(slug: string, work: (transaction: Kysely<Database>, run: RunRow) => Promise<Answer>): Promise<Answer> {
    return this.database.transaction().execute(async (transaction) => {
      const run = await transaction.selectFrom('runs').selectAll().where('slug', '=', slug).forUpdate().executeTakeFirst();
      if (run === undefined) throw new Refusal(`There is no run called "${slug}".`);
      return work(transaction, run);
    });
  }
}

type TableOwnedByARun = 'facts' | 'rulings' | 'waypoints' | 'threads' | 'entries';

/** A write mark taken now, for a row the author changed in place, so it reads as written after an import. */
const FRESH_WRITE_MARK = sql<never>`nextval(${WRITE_MARKS}::regclass)`;

/**
 * The newest standing scene, for an author's act that has to stop something at a scene. Refused
 * where the run has none, as stating a fact over one already holding always was.
 */
async function newestSceneToStopAt(database: Kysely<Database>, run: RunRow, what: string): Promise<SceneRow> {
  const newest = await newestStandingScene(database, run.id);
  if (newest === undefined) throw new Refusal(`The run "${run.slug}" has no scene yet for ${what}. Save the first scene, then do this.`);
  return newest;
}

/** Text the author gave, trimmed, refused where nothing is left of it. */
function wordsGiven(text: string, what: string): string {
  const trimmed = text.trim();
  if (trimmed === '') throw new Refusal(`${what} needs some words; only spaces were given.`);
  return trimmed;
}

/** Other names as kept: trimmed, empty ones dropped, each once (case-blind), in the order given. */
function cleanNames(names: string[]): string[] {
  const kept: string[] = [];
  for (const name of names.map((each) => each.trim()).filter((each) => each !== '')) {
    if (!kept.some((earlier) => normaliseName(earlier) === normaliseName(name))) kept.push(name);
  }
  return kept;
}

/** A sentence for each name that already answers to another entry, since a story naming it is then refused. */
function namesAnsweringElsewhere(
  names: NameIndex<IndexedEntry>, given: string[], exceptEntryId: string | null,
  counts: (holder: IndexedEntry) => boolean = () => true,
): string[] {
  const cautions: string[] = [];
  for (const name of given) {
    const others = names.find(name).filter((holder) => holder.id !== exceptEntryId && counts(holder));
    if (others.length === 0) continue;
    cautions.push(`"${name}" also answers to ${others.map((other) => `"${other.name}" (id ${other.id})`).join(' and ')}. A story naming it will be refused until only one entry goes by it.`);
  }
  return cautions;
}

/**
 * An entry a door names by its name or by its id: one of the two where `required`, at most one
 * otherwise. Anything else is refused, since guessing between them would attach to the wrong entry.
 */
function entryNamedOrById(
  names: NameIndex<IndexedEntry>, name: string | undefined, id: string | undefined, where: string, required: boolean,
): IndexedEntry | null {
  if (name !== undefined && id !== undefined) throw new Refusal(`Name the entry ${where} by its name or by its id, not both.`);
  if (id !== undefined) {
    const entry = names.byId(id);
    if (entry === null) throw new Refusal(`This run has no entry with the id "${id}" (named ${where}).`);
    return entry;
  }
  if (name !== undefined) return names.resolve(name, where);
  if (required) throw new Refusal(`Name the entry ${where}, by its name or by its id.`);
  return null;
}

interface EntryChange {
  field: 'name' | 'alsoKnownAs' | 'pronoun' | 'kind' | 'visibility';
  earlier: string | string[];
  later: string | string[];
}

const ENTRY_COLUMN_BY_FIELD = {
  name: 'name', alsoKnownAs: 'also_known_as', pronoun: 'pronoun', kind: 'kind', visibility: 'visibility',
} as const;

/** Writes changes to an entry, keeping each earlier value as an edit row. A list is kept as JSON. */
async function writeEntryChanges(database: Kysely<Database>, run: RunRow, entry: EntryRow, changes: EntryChange[]): Promise<EntryRecord> {
  const newest = await newestStandingScene(database, run.id);
  const asText = (value: string | string[]): string => (Array.isArray(value) ? JSON.stringify(value) : value);
  await database.insertInto('entry_edits').values(changes.map((change) => ({
    id: randomUUID(), run_id: run.id, entry_id: entry.id, field: change.field,
    earlier_value: asText(change.earlier), later_value: asText(change.later), after_scene_id: newest?.id ?? null,
  }))).execute();
  const update = Object.fromEntries(changes.map((change) => [ENTRY_COLUMN_BY_FIELD[change.field], change.later]));
  const row = await database.updateTable('entries').set(update).where('id', '=', entry.id).returningAll().executeTakeFirstOrThrow();
  return entryFromRow(row);
}

async function newestStandingScene(database: Kysely<Database>, runId: string): Promise<SceneRow | undefined> {
  return database.selectFrom('scenes').selectAll().where('run_id', '=', runId).where('status', '=', 'standing')
    .orderBy('number', 'desc').limit(1).executeTakeFirst();
}

/**
 * The entries a door may name. An entry a struck take introduced is not among them. A story's
 * doors see open entries only, so a story can neither attach to nor learn of an author-only one.
 */
async function liveEntryIndex(database: Kysely<Database>, runId: string, audience: Audience): Promise<NameIndex<IndexedEntry>> {
  let query = database.selectFrom('entries')
    .leftJoin('scenes', 'scenes.id', 'entries.introduced_in_scene_id')
    .selectAll('entries')
    .where('entries.run_id', '=', runId)
    .where((where) => where.or([where('scenes.id', 'is', null), where('scenes.status', '=', 'standing')]));
  if (audience === 'story') query = query.where('entries.visibility', '=', 'open');
  const rows = await query.orderBy('entries.written_order').execute();
  return new NameIndex(rows.map(withNameFields));
}

type IndexedEntry = EntryRow & { alsoKnownAs: string[] };

function withNameFields(row: EntryRow): IndexedEntry {
  return Object.assign(row, { alsoKnownAs: row.also_known_as });
}

/** The facts holding for one property of one entry, in one lane: open, or author-only. */
async function holdingFacts(database: Kysely<Database>, entryId: string, property: string, visibility: Visibility): Promise<FactRow[]> {
  return database.selectFrom('facts').selectAll()
    .where('entry_id', '=', entryId).where('until_scene_id', 'is', null)
    .where('property', '=', property).where('visibility', '=', visibility)
    .orderBy('written_order').execute();
}

/**
 * The facts holding for one property of one entry that a story is served: open, and about nothing
 * or about an entry a story may name. An open fact about an author-only entry is dropped from every
 * story snapshot (see `filterForStory`), so to a story's doors it must be as absent as an
 * author-only fact: never matched, never closed, never collided with. A collision would hand the
 * story the id of a fact it is never shown.
 */
async function holdingFactsAStorySees(database: Kysely<Database>, entryId: string, property: string): Promise<FactRow[]> {
  const holding = await holdingFacts(database, entryId, property, 'open');
  const aboutIds = uniqueIds(holding.map((fact) => fact.about_entry_id).filter((id): id is string => id !== null));
  if (aboutIds.length === 0) return holding;
  // The same test `liveEntryIndex` makes for a story: open, and not introduced by a struck take.
  const served = await database.selectFrom('entries')
    .leftJoin('scenes', 'scenes.id', 'entries.introduced_in_scene_id')
    .select('entries.id')
    .where('entries.id', 'in', aboutIds).where('entries.visibility', '=', 'open')
    .where((where) => where.or([where('scenes.id', 'is', null), where('scenes.status', '=', 'standing')]))
    .execute();
  const servedIds = new Set(served.map((row) => row.id));
  return holding.filter((fact) => fact.about_entry_id === null || servedIds.has(fact.about_entry_id));
}

async function closeFacts(database: Kysely<Database>, facts: FactRow[], untilSceneId: string, closedBySceneId: string | null): Promise<void> {
  if (facts.length === 0) return;
  await database.updateTable('facts').set({ until_scene_id: untilSceneId, closed_by_scene_id: closedBySceneId })
    .where('id', 'in', facts.map((fact) => fact.id)).execute();
}

interface FactToWrite {
  runId: string;
  entryId: string;
  property: string;
  value: string;
  aboutEntryId: string | null;
  fromSceneId: string | null;
  source: Source;
  visibility: Visibility;
  note: string;
  establishedBySceneId: string | null;
  /** Given only where the fact is written as history, already closed. */
  untilSceneId?: string | null;
  closedBySceneId?: string | null;
}

async function insertFact(database: Kysely<Database>, fact: FactToWrite): Promise<FactRow> {
  return database.insertInto('facts').values({
    id: randomUUID(), run_id: fact.runId, entry_id: fact.entryId, property: fact.property, value: fact.value,
    about_entry_id: fact.aboutEntryId, from_scene_id: fact.fromSceneId, until_scene_id: fact.untilSceneId ?? null,
    source: fact.source, visibility: fact.visibility, note: fact.note,
    established_by_scene_id: fact.establishedBySceneId, closed_by_scene_id: fact.closedBySceneId ?? null,
  }).returningAll().executeTakeFirstOrThrow();
}

/**
 * The earliest standing scene after `sceneId` that established an open fact still holding for the
 * property, or null where nothing after that scene holds it: the scene the property moved on at.
 */
async function earliestLaterSceneHoldingTheProperty(database: Kysely<Database>, entryId: string, property: string, sceneId: string): Promise<string | null> {
  const scene = await database.selectFrom('scenes').select('number').where('id', '=', sceneId).executeTakeFirstOrThrow();
  const later = await database.selectFrom('facts')
    .innerJoin('scenes', 'scenes.id', 'facts.from_scene_id')
    .select('scenes.id')
    .where('facts.entry_id', '=', entryId).where('facts.property', '=', property)
    .where('facts.visibility', '=', 'open').where('facts.until_scene_id', 'is', null)
    .where('scenes.status', '=', 'standing').where('scenes.number', '>', scene.number)
    .orderBy('scenes.number').limit(1).executeTakeFirst();
  return later?.id ?? null;
}

async function writeRuling(
  database: Kysely<Database>, runId: string,
  ruling: { text: string; statedByAuthor: boolean; scope: 'run' | 'world'; topics: string[]; about: string[] },
  names: NameIndex<IndexedEntry>, sceneId: string | null, establishedBySceneId: string | null,
): Promise<RulingRecord> {
  const aboutIds = uniqueIds(ruling.about.map((name) => names.resolve(name, 'in a ruling').id));
  const highest = await database.selectFrom('rulings').select(sql<number | null>`max(number)`.as('highest'))
    .where('run_id', '=', runId).executeTakeFirst();
  const row = await database.insertInto('rulings').values({
    id: randomUUID(), run_id: runId, number: (highest?.highest ?? 0) + 1, text: ruling.text,
    source: ruling.statedByAuthor ? 'author' : 'story', scope: ruling.scope, topics: ruling.topics,
    scene_id: sceneId, withdrawn_in_scene_id: null, established_by_scene_id: establishedBySceneId,
  }).returningAll().executeTakeFirstOrThrow();
  if (aboutIds.length > 0) {
    await database.insertInto('ruling_about_entries')
      .values(aboutIds.map((entryId, position) => ({ ruling_id: row.id, entry_id: entryId, position }))).execute();
  }
  return rulingFromRow(row, aboutIds);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Saves one scene and everything it established. `struck` is the earlier take where this is a
 * redo: the new take keeps its number and takes over what pointed at it from outside its save.
 */
async function writeScene(database: Kysely<Database>, run: RunRow, input: SceneInput, struck: SceneRow | null): Promise<SavedScene> {
  const cautions: string[] = [];
  let number: number;
  if (struck !== null) {
    number = struck.number;
  } else {
    const newest = await newestStandingScene(database, run.id);
    number = (newest?.number ?? 0) + 1;
  }
  const sceneId = randomUUID();

  const clocks = await database.selectFrom('clocks').selectAll().where('run_id', '=', run.id).execute();
  const readings: ClockReading[] = [];
  for (const reading of input.readings) {
    const clock = clocks.find((candidate) => normaliseName(candidate.name) === normaliseName(reading.clock));
    if (clock === undefined) throw new Refusal(`The run keeps no clock called "${reading.clock}".`);
    if (readings.some((earlier) => earlier.clockId === clock.id)) throw new Refusal(`The clock "${clock.name}" is read twice in one scene.`);
    readings.push({ clockId: clock.id, count: exactCount(reading.count, clock.name), partOfDay: reading.partOfDay });
  }

  // The scene's own entries come first, so the scene may introduce a name and use it in one save.
  const names = await liveEntryIndex(database, run.id, 'story');
  const entriesAdded: EntryRecord[] = [];
  for (const entryInput of input.entries) {
    const existing = names.resolveIfAny(entryInput.name, "in the scene's entries");
    if (existing !== null) {
      cautions.push(`"${entryInput.name.trim()}" already names an entry in this run, so it was not added again.`);
      continue;
    }
    const takenBack = struck === null ? undefined : await entryTheStruckTakeIntroduced(database, struck.id, entryInput.name, entryInput.kind);
    if (takenBack !== undefined) {
      // What the author changed by hand on the entry stays as the author left it: the take's input
      // fills only the fields the author has not edited, so a redo takes none of the author's acts back.
      const edited = takenBack.fieldsTheAuthorEdited;
      const revived = await database.updateTable('entries').set({
        introduced_in_scene_id: sceneId,
        ...(edited.has('pronoun') ? {} : { pronoun: entryInput.pronoun }),
        ...(edited.has('alsoKnownAs') ? {} : {
          also_known_as: entryInput.alsoKnownAs.map((name) => name.trim()).filter((name) => name !== ''),
        }),
      }).where('id', '=', takenBack.row.id).returningAll().executeTakeFirstOrThrow();
      names.add(withNameFields(revived));
      entriesAdded.push(entryFromRow(revived));
      continue;
    }
    const created = await database.insertInto('entries').values({
      id: randomUUID(), run_id: run.id, kind: entryInput.kind, name: entryInput.name.trim(),
      also_known_as: entryInput.alsoKnownAs.map((name) => name.trim()).filter((name) => name !== ''),
      pronoun: entryInput.pronoun, introduced_in_scene_id: sceneId, source: 'story', visibility: 'open',
    }).returningAll().executeTakeFirstOrThrow();
    names.add(withNameFields(created));
    entriesAdded.push(entryFromRow(created));
  }

  const place = input.place === undefined ? null : names.resolve(input.place, 'as the place of the scene');
  const sceneRow = await database.insertInto('scenes').values({
    id: sceneId, run_id: run.id, number, title: input.title, starred: input.starred, when_typed: input.when,
    place_entry_id: place?.id ?? null, summary: input.summary, record: input.record, steer: input.steer,
    situation_after: input.situationAfter, status: 'standing',
  }).returningAll().executeTakeFirstOrThrow();
  if (struck !== null) await moveOutsideReferencesOntoTheNewTake(database, struck.id, sceneId);
  if (readings.length > 0) {
    await database.insertInto('scene_readings').values(readings.map((reading, position) => ({
      scene_id: sceneId, clock_id: reading.clockId, count: reading.count, part_of_day: reading.partOfDay, position,
    }))).execute();
  }

  const factsWritten: FactRecord[] = [];
  const collisions: CollisionRecord[] = [];
  let factsUnchanged = 0;
  for (const factInput of input.facts) {
    const entry = names.resolve(factInput.entry, 'as the entry of a fact');
    const about = factInput.about === undefined ? null : names.resolve(factInput.about, 'as what a fact is about');
    const property = normaliseProperty(factInput.property);
    // A story cannot see the author-only lane, nor an open fact about an author-only entry, so a save
    // neither matches, closes nor collides with either.
    const holding = await holdingFactsAStorySees(database, entry.id, property);
    const identical = holding.find((fact) => fact.value === factInput.value && fact.about_entry_id === (about?.id ?? null));
    if (identical !== undefined) {
      factsUnchanged += 1;
      continue;
    }
    const source: Source = factInput.statedByAuthor ? 'author' : 'story';
    if (!factInput.alongside) {
      const authorFacts = holding.filter((fact) => fact.source === 'author');
      const newestAuthorFact = authorFacts[authorFacts.length - 1];
      if (source === 'story' && newestAuthorFact !== undefined) {
        const collision = await database.insertInto('collisions').values({
          id: randomUUID(), run_id: run.id, scene_id: sceneId, entry_id: entry.id, property,
          standing_fact_id: newestAuthorFact.id, proposed_value: factInput.value,
          proposed_about_entry_id: about?.id ?? null, state: 'waiting',
        }).returningAll().executeTakeFirstOrThrow();
        collisions.push(collisionFromRow(collision));
        cautions.push(`The author stated ${entry.name}'s ${property}, so the story's "${factInput.value}" was kept as a collision for the author to decide.`);
        continue;
      }
      await closeFacts(database, holding, sceneId, sceneId);
    }
    factsWritten.push(factFromRow(await insertFact(database, {
      runId: run.id, entryId: entry.id, property, value: factInput.value,
      aboutEntryId: about?.id ?? null, fromSceneId: sceneId, source, visibility: 'open',
      note: factInput.note, establishedBySceneId: sceneId,
    })));
  }

  for (const noteInput of input.notes) {
    const entry = names.resolve(noteInput.entry, 'in a trail note');
    await database.insertInto('entry_notes').values({
      id: randomUUID(), run_id: run.id, entry_id: entry.id, scene_id: sceneId, text: noteInput.text, visibility: 'open',
    }).execute();
  }

  const rulingsRecorded: RulingRecord[] = [];
  for (const rulingInput of input.rulings) {
    rulingsRecorded.push(await writeRuling(database, run.id, { ...rulingInput, about: rulingInput.about }, names, sceneId, sceneId));
  }

  const threadIdsOpened: string[] = [];
  for (const threadInput of input.threadsOpened) {
    const aboutIds = uniqueIds(threadInput.about.map((name) => names.resolve(name, 'in a thread').id));
    const row = await database.insertInto('threads').values({
      id: randomUUID(), run_id: run.id, text: threadInput.text, opened_in_scene_id: sceneId, closed_in_scene_id: null,
      resolution: '', established_by_scene_id: sceneId, closed_by_scene_id: null,
    }).returningAll().executeTakeFirstOrThrow();
    if (aboutIds.length > 0) {
      await database.insertInto('thread_about_entries')
        .values(aboutIds.map((entryId, position) => ({ thread_id: row.id, entry_id: entryId, position }))).execute();
    }
    threadIdsOpened.push(row.id);
  }

  // Touches come before closings, so a scene may move a thread on and close it in one save. A
  // closing counts as a touch by itself; the scene that closed it is read as its last touch.
  const threadIdsTouched: string[] = [];
  for (const touching of input.threadsTouched) {
    const thread = await openThreadOfThisRun(database, run.id, touching.thread, 'touched');
    if (threadIdsTouched.includes(thread.id)) throw new Refusal(`The thread "${thread.text}" is touched twice in one scene. Name it once, with one note.`);
    // A redo has already moved onto this take any touch an import or the author dated to the scene it
    // redoes. The author's touch is kept as the author wrote it and the take's note is left out; an
    // import's touch is replaced by the take's own note and ownership.
    const authorsTouch = await database.selectFrom('thread_touches').select('note')
      .where('thread_id', '=', thread.id).where('scene_id', '=', sceneId).where('by_author', '=', true).executeTakeFirst();
    if (authorsTouch !== undefined) {
      cautions.push(`The author touched the thread "${thread.text}" at this scene already, so the author's note was kept and this take's note was left out.`);
      threadIdsTouched.push(thread.id);
      continue;
    }
    await database.insertInto('thread_touches')
      .values({ thread_id: thread.id, scene_id: sceneId, note: touching.note.trim(), written_by_scene_id: sceneId })
      .onConflict((conflict) => conflict.columns(['thread_id', 'scene_id']).doUpdateSet({ note: touching.note.trim(), written_by_scene_id: sceneId }))
      .execute();
    threadIdsTouched.push(thread.id);
  }

  const threadIdsClosed: string[] = [];
  for (const closing of input.threadsClosed) {
    const thread = await openThreadOfThisRun(database, run.id, closing.thread, 'closed');
    await database.updateTable('threads')
      .set({ closed_in_scene_id: sceneId, resolution: closing.resolution, closed_by_scene_id: sceneId })
      .where('id', '=', thread.id).execute();
    threadIdsClosed.push(thread.id);
  }

  for (const waypointId of input.waypointsReached) {
    const waypoint = looksLikeAnId(waypointId)
      ? await database.selectFrom('waypoints').selectAll().where('id', '=', waypointId).where('run_id', '=', run.id).executeTakeFirst()
      : undefined;
    if (waypoint === undefined) throw new Refusal(`This run has no waypoint with the id "${waypointId}".`);
    if (waypoint.reached_in_scene_id !== null) {
      cautions.push(`The waypoint "${waypoint.text}" was reached already, so it was left as it was.`);
      continue;
    }
    await database.updateTable('waypoints').set({ reached_in_scene_id: sceneId, reached_by_scene_id: sceneId }).where('id', '=', waypoint.id).execute();
  }

  if (input.legs.length > 0) {
    await database.insertInto('journey_legs').values(input.legs.map((leg) => ({
      id: randomUUID(), run_id: run.id, from_place: leg.from, to_place: leg.to, duration: leg.duration, note: leg.note, scene_id: sceneId,
    }))).execute();
  }

  if (struck !== null) await settleEntriesTheStruckTakeIntroduced(database, struck.id);

  // A save is a story's door, so its answer names only entries a story is served: a thread the
  // author opened may be about an entry that is author-only now, and that id is left out.
  const threadsAsTheyStand = (await readThreadRecords(database, run.id, uniqueIds([...threadIdsOpened, ...threadIdsTouched, ...threadIdsClosed])))
    .map((thread) => ({ ...thread, aboutEntryIds: thread.aboutEntryIds.filter((id) => names.byId(id) !== null) }));
  const threadsIn = (ids: string[]): ThreadRecord[] => ids.map((id) => threadsAsTheyStand.find((thread) => thread.id === id)!);
  return {
    scene: sceneFromRow(sceneRow, readings),
    entriesAdded, factsWritten, factsUnchanged, rulingsRecorded,
    threadsOpened: threadsIn(threadIdsOpened),
    threadsClosed: threadsIn(threadIdsClosed),
    threadsTouched: threadsIn(threadIdsTouched.filter((id) => !threadIdsClosed.includes(id))),
    collisions, cautions,
  };
}

/**
 * An open thread of this run, named by its id, for a scene to touch or close. A thread that is not
 * this run's, or no thread at all, or one closed already, is refused by name.
 */
async function openThreadOfThisRun(database: Kysely<Database>, runId: string, threadId: string, doing: 'touched' | 'closed') {
  const thread = looksLikeAnId(threadId)
    ? await database.selectFrom('threads').selectAll().where('id', '=', threadId).where('run_id', '=', runId).executeTakeFirst()
    : undefined;
  if (thread === undefined) throw new Refusal(`This run has no thread with the id "${threadId}".`);
  if (thread.closed_in_scene_id !== null) {
    throw new Refusal(doing === 'closed'
      ? `The thread "${thread.text}" is closed already.`
      : `The thread "${thread.text}" is closed, so no scene can touch it.`);
  }
  return thread;
}

/**
 * The entry the take being redone introduced under this very name and kind, which the new take
 * may take up again rather than make a second of. Only the redo of that scene revives, and only on
 * the name and kind the take gave it: its primary name, or a name and kind it had before the author
 * renamed it or changed its kind, since the take that gave it those is being redone. Any other name,
 * another kind or a later scene makes a new entry, since the old row would otherwise come back
 * unasked. An entry the author turned author-only is never revived, since a story cannot name it.
 * The answer says which fields the author edited, so the revival leaves those as the author left them.
 */
async function entryTheStruckTakeIntroduced(
  database: Kysely<Database>, struckId: string, name: string, kind: string,
): Promise<{ row: EntryRow; fieldsTheAuthorEdited: Set<string> } | undefined> {
  const candidates = await database.selectFrom('entries').selectAll()
    .where('introduced_in_scene_id', '=', struckId).where('visibility', '=', 'open')
    .orderBy('written_order', 'desc').execute();
  for (const candidate of candidates) {
    const edits = await database.selectFrom('entry_edits').select(['field', 'earlier_value'])
      .where('entry_id', '=', candidate.id).execute();
    const namesItWent = [candidate.name, ...edits.filter((edit) => edit.field === 'name').map((edit) => edit.earlier_value)];
    const kindsItWas = [candidate.kind, ...edits.filter((edit) => edit.field === 'kind').map((edit) => edit.earlier_value)];
    if (namesItWent.some((each) => normaliseName(each) === normaliseName(name)) && kindsItWas.includes(kind)) {
      return { row: candidate, fieldsTheAuthorEdited: new Set(edits.map((edit) => edit.field)) };
    }
  }
  return undefined;
}

/** Takes back everything one take's save established. See the comment at the head of the file. */
async function strikeScene(database: Kysely<Database>, scene: SceneRow): Promise<void> {
  const sceneId = scene.id;
  await database.updateTable('scenes').set({ status: 'struck' }).where('id', '=', sceneId).execute();
  await database.updateTable('facts').set({ until_scene_id: sceneId })
    .where('established_by_scene_id', '=', sceneId).execute();
  // What the take closed holds again, unless the author has since put something of their own in its place.
  await sql`update facts set until_scene_id = null, closed_by_scene_id = null
    where closed_by_scene_id = ${sceneId}
      and established_by_scene_id is distinct from ${sceneId}
      and not exists (
        select 1 from facts later
        where later.entry_id = facts.entry_id and later.property = facts.property
          and later.visibility = facts.visibility
          and later.until_scene_id is null
          and later.established_by_scene_id is distinct from ${sceneId}
          and later.created_at > ${scene.created_at}
      )`.execute(database);
  await database.updateTable('rulings').set({ withdrawn_in_scene_id: sceneId })
    .where('established_by_scene_id', '=', sceneId).execute();
  await database.updateTable('threads').set({ closed_in_scene_id: null, resolution: '', closed_by_scene_id: null })
    .where('closed_by_scene_id', '=', sceneId)
    .where(sql<boolean>`established_by_scene_id is distinct from ${sceneId}`).execute();
  // A thread the take opened is closed at it, unless the author has closed it already: then it keeps
  // the author's closing and resolution word for word. It reads as taken back either way, since it
  // was opened in a struck scene.
  await database.updateTable('threads')
    .set({ closed_in_scene_id: sceneId, closed_by_scene_id: sceneId, resolution: `Taken back when scene ${scene.number} was redone.` })
    .where('established_by_scene_id', '=', sceneId).where('closed_in_scene_id', 'is', null).execute();
  // Only what this scene's save reached is taken back. An import that only dated a waypoint here did
  // not reach it by this take, and it stays reached as of the new take.
  await database.updateTable('waypoints').set({ reached_in_scene_id: null, reached_by_scene_id: null })
    .where('reached_by_scene_id', '=', sceneId).execute();
  await database.deleteFrom('collisions').where('scene_id', '=', sceneId).where('state', '=', 'waiting').execute();
}

/** What the author did as of the struck scene, outside its save, now stands as of the new take. */
async function moveOutsideReferencesOntoTheNewTake(database: Kysely<Database>, struckId: string, newId: string): Promise<void> {
  const notFromTheTake = sql<boolean>`established_by_scene_id is distinct from ${struckId}`;
  await database.updateTable('facts').set({ from_scene_id: newId }).where('from_scene_id', '=', struckId).where(notFromTheTake).execute();
  await database.updateTable('facts').set({ until_scene_id: newId }).where('until_scene_id', '=', struckId).where(notFromTheTake).execute();
  await database.updateTable('rulings').set({ scene_id: newId }).where('scene_id', '=', struckId).where(notFromTheTake).execute();
  await database.updateTable('waypoints').set({ reached_in_scene_id: newId }).where('reached_in_scene_id', '=', struckId)
    .where(sql<boolean>`reached_by_scene_id is distinct from ${struckId}`).execute();
  // A thread an import closed only dated to the struck scene was not closed by its save, so it stays
  // closed as of the new take. One the take closed or opened has been settled by strikeScene already,
  // and carries the struck scene as its closer, which is what this leaves alone.
  // A thread the take opened stays wholly on the struck scene, the author's closing of it too.
  await database.updateTable('threads').set({ closed_in_scene_id: newId }).where('closed_in_scene_id', '=', struckId)
    .where(sql<boolean>`closed_by_scene_id is distinct from ${struckId}`).where(notFromTheTake).execute();
  // So is a touch an import or the author dated to the struck scene: the take's save did not write
  // it. The take's own touches, and every touch on a thread the take opened, stay on the struck
  // scene, where they stop counting.
  await database.updateTable('thread_touches').set({ scene_id: newId }).where('scene_id', '=', struckId)
    .where(sql<boolean>`written_by_scene_id is distinct from ${struckId}`)
    .where(sql<boolean>`not exists (select 1 from threads where threads.id = thread_touches.thread_id and threads.established_by_scene_id = ${struckId})`)
    .execute();
  // The author's acts dated to the struck scene (docs/decisions/0003-the-authors-hand.md) move onto
  // the new take and none is taken back: a thread the author opened, a ruling or a waypoint the
  // author withdrew, and the dates of what the author changed in place. A thread or ruling the
  // take's own save wrote is left on the struck scene, where strikeScene has settled it.
  await database.updateTable('threads').set({ opened_in_scene_id: newId }).where('opened_in_scene_id', '=', struckId).where(notFromTheTake).execute();
  await database.updateTable('rulings').set({ withdrawn_in_scene_id: newId }).where('withdrawn_in_scene_id', '=', struckId).where(notFromTheTake).execute();
  await database.updateTable('waypoints').set({ withdrawn_in_scene_id: newId }).where('withdrawn_in_scene_id', '=', struckId).execute();
  for (const table of ['run_edits', 'entry_edits', 'waypoint_rewordings'] as const) {
    await database.updateTable(table as 'run_edits').set({ after_scene_id: newId }).where('after_scene_id', '=', struckId).execute();
  }
}

/**
 * An entry the struck take introduced and the new take did not is taken back with it, unless
 * something outside that take names it, or the author has edited it by hand; then it stays,
 * introduced by no scene, so the author's act on it is not taken back.
 */
async function settleEntriesTheStruckTakeIntroduced(database: Kysely<Database>, struckId: string): Promise<void> {
  await sql`update entries set introduced_in_scene_id = null
    where introduced_in_scene_id = ${struckId}
      and (
        exists (select 1 from facts where (facts.entry_id = entries.id or facts.about_entry_id = entries.id)
                and facts.established_by_scene_id is distinct from ${struckId})
        or exists (select 1 from entry_notes where entry_notes.entry_id = entries.id and entry_notes.scene_id <> ${struckId})
        or exists (select 1 from ruling_about_entries join rulings on rulings.id = ruling_about_entries.ruling_id
                   where ruling_about_entries.entry_id = entries.id and rulings.established_by_scene_id is distinct from ${struckId})
        or exists (select 1 from thread_about_entries join threads on threads.id = thread_about_entries.thread_id
                   where thread_about_entries.entry_id = entries.id and threads.established_by_scene_id is distinct from ${struckId})
        or exists (select 1 from scenes where scenes.place_entry_id = entries.id and scenes.id <> ${struckId})
        or exists (select 1 from collisions where (collisions.entry_id = entries.id or collisions.proposed_about_entry_id = entries.id)
                   and collisions.scene_id is distinct from ${struckId})
        or exists (select 1 from entry_edits where entry_edits.entry_id = entries.id)
      )`.execute(database);
}
