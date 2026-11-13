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
 * did after it that named it (a fact stated as of that scene) is moved onto the new take.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  Refusal, type CollisionRecord, type EntryRecord, type FactRecord, type InputOf, type RulingRecord,
  type RunListing, type RunSnapshot, type SavedScene, type SceneInput, type Source, type Store,
  type ThreadRecord, type Visibility, type ImportedRun, type ClockReading, type ReplacedImport, RunAlreadyExists,
} from '@timeweft/contract';
import type { Database } from './database.ts';
import { applyMigrations } from './migrations.ts';
import { NameIndex, normaliseName, normaliseProperty } from './names.ts';
import {
  collisionFromRow, entryFromRow, factFromRow, rulingFromRow, runFromRow, sceneFromRow,
  threadFromRow, type EntryRow, type FactRow, type RunRow, type SceneRow,
} from './rows.ts';
import { filterForStory, readWholeRun } from './snapshot.ts';
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
      const entry = names.resolve(input.entry, 'as the entry the fact is about');
      const about = input.about === undefined ? null : names.resolve(input.about, 'as what the fact is about');
      const newest = await newestStandingScene(transaction, run.id);
      const sceneId = newest?.id ?? null;
      const property = normaliseProperty(input.property);
      // Each lane closes only its own: an author-only fact never ends an open one, or the story would
      // see a value end with nothing in its place, and an open fact never ends an author-only one.
      const holding = await holdingFacts(transaction, entry.id, property, input.visibility);
      const identical = holding.find((fact) =>
        fact.source === 'author' && fact.value === input.value && fact.about_entry_id === (about?.id ?? null));
      if (identical !== undefined) return factFromRow(identical);
      if (holding.length > 0 && sceneId === null) {
        throw new Refusal(`"${entry.name}" already holds a ${property} and the run has no scene yet for it to stop holding at. Save the first scene, then state this.`);
      }
      if (sceneId !== null) await closeFacts(transaction, holding, sceneId, null);
      return factFromRow(await insertFact(transaction, {
        runId: run.id, entryId: entry.id, property, value: input.value,
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

  private async writeInRun<Answer>(slug: string, work: (transaction: Kysely<Database>, run: RunRow) => Promise<Answer>): Promise<Answer> {
    return this.database.transaction().execute(async (transaction) => {
      const run = await transaction.selectFrom('runs').selectAll().where('slug', '=', slug).forUpdate().executeTakeFirst();
      if (run === undefined) throw new Refusal(`There is no run called "${slug}".`);
      return work(transaction, run);
    });
  }
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
      const revived = await database.updateTable('entries').set({
        introduced_in_scene_id: sceneId,
        pronoun: entryInput.pronoun,
        also_known_as: entryInput.alsoKnownAs.map((name) => name.trim()).filter((name) => name !== ''),
      }).where('id', '=', takenBack.id).returningAll().executeTakeFirstOrThrow();
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

  const threadsOpened: ThreadRecord[] = [];
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
    threadsOpened.push(threadFromRow(row, aboutIds));
  }

  const threadsClosed: ThreadRecord[] = [];
  for (const closing of input.threadsClosed) {
    const thread = looksLikeAnId(closing.thread)
      ? await database.selectFrom('threads').selectAll().where('id', '=', closing.thread).where('run_id', '=', run.id).executeTakeFirst()
      : undefined;
    if (thread === undefined) throw new Refusal(`This run has no thread with the id "${closing.thread}".`);
    if (thread.closed_in_scene_id !== null) throw new Refusal(`The thread "${thread.text}" is closed already.`);
    const closed = await database.updateTable('threads')
      .set({ closed_in_scene_id: sceneId, resolution: closing.resolution, closed_by_scene_id: sceneId })
      .where('id', '=', thread.id).returningAll().executeTakeFirstOrThrow();
    const about = await database.selectFrom('thread_about_entries').select('entry_id').where('thread_id', '=', thread.id).orderBy('position').execute();
    threadsClosed.push(threadFromRow(closed, about.map((row) => row.entry_id)));
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

  return {
    scene: sceneFromRow(sceneRow, readings),
    entriesAdded, factsWritten, factsUnchanged, rulingsRecorded, threadsOpened, threadsClosed, collisions, cautions,
  };
}

/**
 * The entry the take being redone introduced under this very name and kind, which the new take
 * may take up again rather than make a second of. Only the redo of that scene revives, and only on
 * its primary name: an other name, another kind or a later scene makes a new entry, since the old
 * row's name and kind would otherwise come back unasked.
 */
async function entryTheStruckTakeIntroduced(database: Kysely<Database>, struckId: string, name: string, kind: string): Promise<EntryRow | undefined> {
  const candidates = await database.selectFrom('entries').selectAll()
    .where('introduced_in_scene_id', '=', struckId).where('visibility', '=', 'open').where('kind', '=', kind)
    .orderBy('written_order', 'desc').execute();
  return candidates.find((candidate) => normaliseName(candidate.name) === normaliseName(name));
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
  await database.updateTable('threads')
    .set({ closed_in_scene_id: sceneId, closed_by_scene_id: sceneId, resolution: `Taken back when scene ${scene.number} was redone.` })
    .where('established_by_scene_id', '=', sceneId).execute();
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
  await database.updateTable('threads').set({ closed_in_scene_id: newId }).where('closed_in_scene_id', '=', struckId)
    .where(sql<boolean>`closed_by_scene_id is distinct from ${struckId}`).execute();
}

/**
 * An entry the struck take introduced and the new take did not is taken back with it, unless
 * something outside that take names it; then it stays, introduced by no scene.
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
      )`.execute(database);
}
