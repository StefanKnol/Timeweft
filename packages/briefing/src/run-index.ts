/**
 * One pass over a snapshot that every reader shares, so that a briefing over twenty thousand facts
 * looks each thing up by id rather than scanning the whole run once per entry.
 *
 * Two rules live here because every reader needs them and they must not drift apart:
 * a scene that was struck is never served, and nothing it established is either.
 */
import type {
  EntryNoteRecord, EntryRecord, FactRecord, Id, RulingRecord, RunSnapshot, SceneRecord, ThreadRecord,
} from '@timeweft/contract';

export interface RunIndex {
  snapshot: RunSnapshot;
  sceneById: Map<Id, SceneRecord>;
  struckSceneIds: Set<Id>;
  /** Standing scenes, oldest first. */
  standingScenes: SceneRecord[];
  entryById: Map<Id, EntryRecord>;
  /** Every fact not established by a struck scene, closed ones included, by the entry it is about. */
  servableFactsByEntry: Map<Id, FactRecord[]>;
  /** Every trail note not written in a struck scene, by the entry it is about. */
  servableNotesByEntry: Map<Id, EntryNoteRecord[]>;
}

/** Plain code-unit order, so that the same snapshot sorts the same way on every machine. */
export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareScenesOldestFirst(left: SceneRecord, right: SceneRecord): number {
  return left.number - right.number || compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id);
}

export function indexRun(snapshot: RunSnapshot): RunIndex {
  const sceneById = new Map<Id, SceneRecord>();
  const struckSceneIds = new Set<Id>();
  for (const scene of snapshot.scenes) {
    sceneById.set(scene.id, scene);
    if (scene.status === 'struck') struckSceneIds.add(scene.id);
  }
  const standingScenes = snapshot.scenes.filter((scene) => scene.status === 'standing').sort(compareScenesOldestFirst);
  const entryById = new Map<Id, EntryRecord>();
  for (const entry of snapshot.entries) entryById.set(entry.id, entry);
  const servableFactsByEntry = new Map<Id, FactRecord[]>();
  for (const fact of snapshot.facts) {
    if (fact.fromSceneId !== null && struckSceneIds.has(fact.fromSceneId)) continue;
    const list = servableFactsByEntry.get(fact.entryId);
    if (list) list.push(fact);
    else servableFactsByEntry.set(fact.entryId, [fact]);
  }
  const servableNotesByEntry = new Map<Id, EntryNoteRecord[]>();
  for (const note of snapshot.notes) {
    if (struckSceneIds.has(note.sceneId)) continue;
    const list = servableNotesByEntry.get(note.entryId);
    if (list) list.push(note);
    else servableNotesByEntry.set(note.entryId, [note]);
  }
  return { snapshot, sceneById, struckSceneIds, standingScenes, entryById, servableFactsByEntry, servableNotesByEntry };
}

/** The number of the scene an id names, or null where there is no id or no such scene. */
export function sceneNumberOf(index: RunIndex, sceneId: Id | null): number | null {
  if (sceneId === null) return null;
  return index.sceneById.get(sceneId)?.number ?? null;
}

export function wasEstablishedInAStruckScene(index: RunIndex, sceneId: Id | null): boolean {
  return sceneId !== null && index.struckSceneIds.has(sceneId);
}

export function newestStandingScene(index: RunIndex): SceneRecord | null {
  return index.standingScenes[index.standingScenes.length - 1] ?? null;
}

/** Holding facts of one entry: still open, and not from a struck scene. Ordered for reading. */
export function holdingFactsOf(index: RunIndex, entryId: Id): FactRecord[] {
  const facts = (index.servableFactsByEntry.get(entryId) ?? []).filter((fact) => fact.untilSceneId === null);
  return facts.sort((left, right) =>
    compareText(left.property, right.property)
    || (sceneNumberOf(index, left.fromSceneId) ?? 0) - (sceneNumberOf(index, right.fromSceneId) ?? 0)
    || compareText(left.createdAt, right.createdAt)
    || compareText(left.id, right.id));
}

/** The facts that no longer hold, newest first: by the scene that closed them, then the one that began them. */
export function closedFactsOf(index: RunIndex, entryId: Id): FactRecord[] {
  const facts = (index.servableFactsByEntry.get(entryId) ?? []).filter((fact) => fact.untilSceneId !== null);
  return facts.sort((left, right) =>
    (sceneNumberOf(index, right.untilSceneId) ?? 0) - (sceneNumberOf(index, left.untilSceneId) ?? 0)
    || (sceneNumberOf(index, right.fromSceneId) ?? 0) - (sceneNumberOf(index, left.fromSceneId) ?? 0)
    || compareText(right.createdAt, left.createdAt)
    || compareText(right.id, left.id));
}

/** One entry's trail, newest first. */
export function trailNewestFirstOf(index: RunIndex, entryId: Id): EntryNoteRecord[] {
  const notes = [...(index.servableNotesByEntry.get(entryId) ?? [])];
  return notes.sort((left, right) =>
    (sceneNumberOf(index, right.sceneId) ?? 0) - (sceneNumberOf(index, left.sceneId) ?? 0)
    || compareText(right.createdAt, left.createdAt)
    || compareText(right.id, left.id));
}

/** Rulings still in force and not given in a struck scene, oldest first by their number. */
export function rulingsInForce(index: RunIndex): RulingRecord[] {
  return index.snapshot.rulings
    .filter((ruling) => ruling.withdrawnInSceneId === null && !wasEstablishedInAStruckScene(index, ruling.sceneId))
    .sort((left, right) => left.number - right.number || compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id));
}

/**
 * Threads not opened in a struck scene, oldest first. Two threads opened in one scene and written
 * in one batch keep the order they were written in, never the order of their ids, which are random.
 */
export function servableThreads(index: RunIndex): ThreadRecord[] {
  const writtenPosition = writtenPositionsOfThreads(index);
  return index.snapshot.threads
    .filter((thread) => !wasEstablishedInAStruckScene(index, thread.openedInSceneId))
    .sort((left, right) =>
      (sceneNumberOf(index, left.openedInSceneId) ?? 0) - (sceneNumberOf(index, right.openedInSceneId) ?? 0)
      || compareText(left.createdAt, right.createdAt)
      || (writtenPosition.get(left) ?? 0) - (writtenPosition.get(right) ?? 0));
}

/** Where each thread stands in the snapshot, which is the order the store wrote them in. */
export function writtenPositionsOfThreads(index: RunIndex): Map<ThreadRecord, number> {
  return new Map(index.snapshot.threads.map((thread, position) => [thread, position]));
}

/**
 * The number of the newest standing scene that moved a thread: the one the store says it was last
 * touched in, or failing that the newest standing among its opening, its touches and its closing.
 * A struck take's scene never counts. Null where none of them is a standing scene of the run.
 */
export function lastTouchedSceneNumberOf(index: RunIndex, thread: ThreadRecord): number | null {
  let newest: number | null = null;
  for (const sceneId of [thread.lastTouchedInSceneId, thread.openedInSceneId, ...thread.touches.map((touch) => touch.sceneId), thread.closedInSceneId]) {
    if (sceneId === null || wasEstablishedInAStruckScene(index, sceneId)) continue;
    const number = sceneNumberOf(index, sceneId);
    if (number !== null && (newest === null || number > newest)) newest = number;
  }
  return newest;
}

/**
 * Threads ranked so the one a scene moved last comes first: by the scene each was last touched in
 * (opened, touched or closed), the newest first; then by the scene it was opened in, the newest
 * first; then by its place in the snapshot, which is the order the store wrote them, the latest
 * first. A scene that is not known (none was recorded, or the one named is not a standing scene of
 * the run) ranks after every known one at that step. Never by id, since ids are random.
 */
export function threadsLastTouchedFirst(index: RunIndex, threads: ThreadRecord[]): ThreadRecord[] {
  const writtenPosition = writtenPositionsOfThreads(index);
  const newestFirst = (left: number | null, right: number | null): number => {
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    return (right ?? 0) - (left ?? 0);
  };
  return [...threads].sort((left, right) =>
    newestFirst(lastTouchedSceneNumberOf(index, left), lastTouchedSceneNumberOf(index, right))
    || newestFirst(sceneNumberOf(index, left.openedInSceneId), sceneNumberOf(index, right.openedInSceneId))
    || (writtenPosition.get(right) ?? 0) - (writtenPosition.get(left) ?? 0));
}

/** The open threads a briefing serves, the one a scene moved last first (threadsLastTouchedFirst says how). */
export function openThreadsNewestFirst(index: RunIndex): ThreadRecord[] {
  return threadsLastTouchedFirst(index, servableThreads(index).filter((thread) => thread.closedInSceneId === null));
}

export function entryNameOf(index: RunIndex, entryId: Id): string | null {
  return index.entryById.get(entryId)?.name ?? null;
}

/** How many standing trail notes an entry has: notes written in a struck scene are not counted. */
export function trailCountOf(index: RunIndex, entryId: Id): number {
  return index.servableNotesByEntry.get(entryId)?.length ?? 0;
}

/**
 * Where each entry stands in the snapshot, which is the order the store wrote them in. Ties that
 * names cannot break are broken by it, never by id, since ids are random.
 */
export function writtenPositionsOfEntries(index: RunIndex): Map<Id, number> {
  return new Map(index.snapshot.entries.map((entry, position) => [entry.id, position]));
}

/**
 * The main character: the entry with the most standing trail notes in the whole run, ties going
 * to the name that sorts first and then to the one written first. In a long run that is the one
 * the story is told through, present in every scene. Undefined where no entry has a trail. This
 * is the one home of the rule: the briefing serves this entry first, and the people a chat may
 * attach are led by it.
 */
export function mainCharacterInIndex(index: RunIndex): EntryRecord | undefined {
  const writtenPosition = writtenPositionsOfEntries(index);
  return [...index.snapshot.entries]
    .filter((entry) => trailCountOf(index, entry.id) > 0)
    .sort((left, right) => trailCountOf(index, right.id) - trailCountOf(index, left.id)
      || compareText(left.name, right.name)
      || (writtenPosition.get(left.id) ?? 0) - (writtenPosition.get(right.id) ?? 0))[0];
}
