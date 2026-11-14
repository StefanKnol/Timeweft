/**
 * Builds a large made-up run to look at the pages with, through the store's own doors.
 *
 *   pnpm seed-demo-run -- [--slug the-long-valley] [--scenes 420]
 *
 * The database is named as the server names it (TIMEWEFT_DATABASE_URL, or the parts in
 * TIMEWEFT_DATABASE_HOST and the rest). Point it at a scratch database, never at the author's own.
 * It refuses a slug the store already holds, so it never writes into a run that is there.
 *
 * Everything it writes is planned in demo-run.ts, decided by the scene's index alone: the same
 * slug and count always build the same run.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { OPERATIONS, Refusal, RUN_SLUG_PATTERN, type SavedScene, type Store } from '@timeweft/contract';
import { openStore } from '@timeweft/store';
import { DatabaseAddressNotSet, databaseAddressFromEnvironment } from './database-address.ts';
import { DEFAULT_DEMO_SCENES, DEFAULT_DEMO_SLUG, DEMO_CLOCKS, planOfDemoRun, type DemoScenePlan } from './demo-run.ts';

export interface SeedRequest {
  slug: string;
  scenes: number;
}

export function seedRequestFromArguments(argumentsGiven: string[]): SeedRequest {
  const { values } = parseArgs({
    args: argumentsGiven.filter((argument) => argument !== '--'),
    options: { slug: { type: 'string' }, scenes: { type: 'string' } },
    strict: true,
  });
  const slug = values.slug ?? DEFAULT_DEMO_SLUG;
  if (!RUN_SLUG_PATTERN.test(slug)) throw new Refusal(`--slug is a short handle in lower case with hyphens; "${slug}" is not.`);
  const scenes = values.scenes === undefined ? DEFAULT_DEMO_SCENES : Number(values.scenes);
  if (!Number.isInteger(scenes) || scenes < 2 || scenes > 5000) throw new Refusal(`--scenes is a whole number from 2 to 5000; "${values.scenes}" is not.`);
  return { slug, scenes };
}

export interface SeedCounts {
  scenes: number;
  struckTakes: number;
  starred: number;
  entries: number;
  authorOnlyEntries: number;
  facts: number;
  notes: number;
  rulings: number;
  threadsOpened: number;
  threadsClosed: number;
  collisions: number;
  legs: number;
  proseWords: number;
}

function sceneRequest(slug: string, plan: DemoScenePlan, threadIds: Map<number, string>, waypointIds: string[]) {
  const idOf = (ordinal: number): string => {
    const id = threadIds.get(ordinal);
    if (id === undefined) throw new Error(`Thread ${ordinal + 1} was never opened.`);
    return id;
  };
  return {
    run: slug,
    title: plan.title,
    starred: plan.starred,
    when: plan.when,
    ...(plan.place === null ? {} : { place: plan.place }),
    summary: plan.summary,
    record: plan.record,
    steer: plan.steer,
    situationAfter: plan.situationAfter,
    readings: plan.readings,
    entries: plan.entries,
    facts: plan.facts,
    notes: plan.notes,
    rulings: plan.rulings,
    threadsOpened: plan.threadsOpened.map((thread) => ({ text: thread.text, about: thread.about })),
    threadsClosed: plan.threadsClosed.map((thread) => ({ thread: idOf(thread.ordinal), resolution: thread.resolution })),
    threadsTouched: plan.threadsTouched.map((thread) => ({ thread: idOf(thread.ordinal), note: thread.note })),
    waypointsReached: plan.waypointsReached.map((ordinal) => waypointIds[ordinal]!),
    legs: plan.legs,
  };
}

/** Writes the whole plan into the store. Refuses a slug the store already holds. */
export async function seedDemoRun(store: Store, request: SeedRequest): Promise<SeedCounts> {
  const runs = await store.listRuns();
  if (runs.some((listing) => listing.run.slug === request.slug)) {
    throw new Refusal(`The store already holds a run called "${request.slug}". The demo run is only ever written fresh; choose another --slug or a scratch database.`);
  }
  const plan = planOfDemoRun(request.scenes);
  const snapshot = await store.beginRun(OPERATIONS.begin_run.input.parse({
    slug: request.slug, title: plan.title, setting: plan.setting, register: plan.register,
    clocks: DEMO_CLOCKS.map((clock) => ({ name: clock.name, countsFrom: clock.countsFrom })),
    waypoints: plan.waypoints,
  }));
  const waypointIds = plan.waypoints.map((text) => snapshot.waypoints.find((waypoint) => waypoint.text === text)!.id);
  const threadIds = new Map<number, string>();
  const counts: SeedCounts = {
    scenes: 0, struckTakes: 0, starred: 0, entries: 0, authorOnlyEntries: 0, facts: 0, notes: 0, rulings: 0,
    threadsOpened: 0, threadsClosed: 0, collisions: 0, legs: 0, proseWords: 0,
  };

  for (const scene of plan.scenes) {
    const full = OPERATIONS.save_scene.input.parse(sceneRequest(request.slug, scene, threadIds, waypointIds));
    let saved: SavedScene;
    if (scene.redone) {
      // A short first take, struck by the redo that follows, so the run holds a struck take.
      const firstTake = await store.saveScene(OPERATIONS.save_scene.input.parse({
        run: request.slug, title: `${scene.title}, first take`, when: scene.when,
        summary: 'A first take the author asked to have redone.', situationAfter: 'As it was before.',
        record: scene.record.split('\n\n')[0] ?? '',
      }));
      saved = await store.redoScene(OPERATIONS.redo_scene.input.parse({ ...full, number: firstTake.scene.number }));
      counts.struckTakes += 1;
    } else {
      saved = await store.saveScene(full);
    }
    for (const opened of scene.threadsOpened) {
      const thread = saved.threadsOpened.find((candidate) => candidate.text === opened.text);
      if (thread === undefined) throw new Error(`Scene ${scene.number} did not open "${opened.text}".`);
      threadIds.set(opened.ordinal, thread.id);
    }
    counts.scenes += 1;
    if (scene.starred) counts.starred += 1;
    counts.entries += saved.entriesAdded.length;
    counts.facts += saved.factsWritten.length;
    counts.notes += scene.notes.length;
    counts.rulings += saved.rulingsRecorded.length;
    counts.threadsOpened += saved.threadsOpened.length;
    counts.threadsClosed += saved.threadsClosed.length;
    counts.collisions += saved.collisions.length;
    counts.legs += scene.legs.length;
    counts.proseWords += scene.record.split(/\s+/).filter((word) => word !== '').length;

    for (const entry of scene.afterwards.authorOnlyEntries) {
      await store.addEntry(OPERATIONS.add_entry.input.parse({ run: request.slug, ...entry, visibility: 'author-only' }));
      counts.authorOnlyEntries += 1;
    }
    for (const fact of [...scene.afterwards.authorOnlyFacts.map((fact) => ({ ...fact, visibility: 'author-only' as const })), ...scene.afterwards.authorFacts]) {
      await store.stateFact(OPERATIONS.state_fact.input.parse({ run: request.slug, ...fact }));
      counts.facts += 1;
    }
  }
  return counts;
}

async function main(): Promise<void> {
  const request = seedRequestFromArguments(process.argv.slice(2));
  const store = await openStore(databaseAddressFromEnvironment(process.env));
  try {
    await store.migrate();
    const started = performance.now();
    const counts = await seedDemoRun(store, request);
    const seconds = (performance.now() - started) / 1000;
    console.log(`Built the demo run ${request.slug} in ${seconds.toFixed(1)} seconds.`);
    for (const [name, count] of Object.entries(counts)) console.log(`  ${name}: ${count}`);
  } finally {
    await store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    if (error instanceof Refusal || error instanceof DatabaseAddressNotSet) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
