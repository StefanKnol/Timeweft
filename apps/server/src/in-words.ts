/**
 * Each answer said as compact text for a model to read. The MCP tools answer with this beside the
 * answer itself as structured content, so a model that reads only text still learns everything
 * that matters, and nothing has to be worked out from ids.
 *
 * Ids are turned into names through `NamesInTheRun`, which the caller builds from the story's own
 * snapshot. An entry the story may not see is not in it, so it is said as "an entry" and never by
 * name.
 */
import type {
  AnswerByOperation, Briefing, CollisionRecord, EntryLookup, FactRecord, FoundItem, Id, OperationName,
  RulingRecord, RunListing, RunSnapshot, SavedScene, SceneInFull, SceneRecord, SceneSummary, ThreadRecord,
} from '@timeweft/contract';

export interface NamesInTheRun {
  entryNames: ReadonlyMap<Id, string>;
  sceneNumbers: ReadonlyMap<Id, number>;
}

export const NO_NAMES: NamesInTheRun = { entryNames: new Map(), sceneNumbers: new Map() };

export function namesInTheRun(snapshot: RunSnapshot): NamesInTheRun {
  return {
    entryNames: new Map(snapshot.entries.map((entry) => [entry.id, entry.name])),
    sceneNumbers: new Map(snapshot.scenes.filter((scene) => scene.status === 'standing').map((scene) => [scene.id, scene.number])),
  };
}

function entryName(names: NamesInTheRun, entryId: Id | null): string {
  if (entryId === null) return 'nothing';
  return names.entryNames.get(entryId) ?? 'an entry';
}

function sceneLabel(names: NamesInTheRun, sceneId: Id | null): string | null {
  if (sceneId === null) return null;
  const number = names.sceneNumbers.get(sceneId);
  return number === undefined ? null : `scene ${number}`;
}

function bulletList(lines: string[], whenEmpty: string): string {
  return lines.length === 0 ? whenEmpty : lines.map((line) => `- ${line}`).join('\n');
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function runListingsInWords(listings: RunListing[]): string {
  if (listings.length === 0) return 'The store holds no runs yet.';
  return listings.map((listing) => {
    const latest = listing.latest === null
      ? 'no scenes yet'
      : `latest scene ${listing.latest.number}, "${listing.latest.title}" (${listing.latest.whenTyped})`;
    return `- ${listing.run.slug}: "${listing.run.title}", ${listing.run.status}; ${plural(listing.standingScenes, 'scene', 'scenes')}, ${latest}; ${plural(listing.openThreads, 'open thread', 'open threads')}; ${plural(listing.waitingCollisions, 'collision waiting', 'collisions waiting')}.`;
  }).join('\n');
}

export function runSnapshotInWords(snapshot: RunSnapshot): string {
  const standing = snapshot.scenes.filter((scene) => scene.status === 'standing').length;
  const clocks = snapshot.clocks.map((clock) => `${clock.name}${clock.countsFrom === '' ? '' : ` (counts from ${clock.countsFrom})`}`);
  return [
    `Run ${snapshot.run.slug}: "${snapshot.run.title}" (${snapshot.run.status}).`,
    snapshot.run.setting === '' ? null : `Setting: ${snapshot.run.setting}`,
    `Clocks: ${clocks.length === 0 ? 'none' : clocks.join('; ')}.`,
    `${plural(standing, 'standing scene', 'standing scenes')}, ${plural(snapshot.entries.length, 'entry', 'entries')}, ${plural(snapshot.facts.length, 'fact', 'facts')}, ${plural(snapshot.rulings.length, 'ruling', 'rulings')}, ${plural(snapshot.threads.length, 'thread', 'threads')}, ${plural(snapshot.waypoints.length, 'waypoint', 'waypoints')}.`,
  ].filter((line): line is string => line !== null).join('\n');
}

/** A briefing is already written for a model, so it is served as it is. */
export function briefingInWords(briefing: Briefing): string {
  return briefing.text;
}

function factInWordsWith(names: NamesInTheRun, fact: FactRecord): string {
  const about = fact.aboutEntryId === null ? '' : ` (about ${entryName(names, fact.aboutEntryId)})`;
  const since = sceneLabel(names, fact.fromSceneId);
  return `${entryName(names, fact.entryId)}, ${fact.property}: ${fact.value}${about}${since === null ? '' : `, since ${since}`}`;
}

function collisionSentence(names: NamesInTheRun, collision: CollisionRecord): string {
  const about = collision.proposedAboutEntryId === null ? '' : ` (about ${entryName(names, collision.proposedAboutEntryId)})`;
  return `The story said the ${collision.property} of ${entryName(names, collision.entryId)} is "${collision.proposedValue}"${about}, but the author stated otherwise. The author's fact stands and nothing was written; the author will decide (collision ${collision.id}, ${collision.state}).`;
}

export function savedSceneInWords(saved: SavedScene, names: NamesInTheRun): string {
  const lines = [`Saved scene ${saved.scene.number}, "${saved.scene.title}".`];
  if (saved.entriesAdded.length > 0) {
    lines.push(`New entries: ${saved.entriesAdded.map((entry) => `${entry.name} (${entry.kind})`).join(', ')}.`);
  }
  if (saved.factsWritten.length > 0) {
    lines.push('Facts written:', bulletList(saved.factsWritten.map((fact) => factInWordsWith(names, fact)), ''));
  }
  if (saved.factsUnchanged > 0) {
    lines.push(`${plural(saved.factsUnchanged, 'fact already held', 'facts already held')} exactly, so nothing was written for ${saved.factsUnchanged === 1 ? 'it' : 'them'}.`);
  }
  if (saved.rulingsRecorded.length > 0) {
    lines.push(`Rulings recorded: ${saved.rulingsRecorded.map((ruling) => `ruling ${ruling.number}`).join(', ')}.`);
  }
  if (saved.threadsOpened.length > 0) {
    lines.push('Threads opened:', bulletList(saved.threadsOpened.map((thread) => `${thread.id}: ${thread.text}`), ''));
  }
  if (saved.threadsClosed.length > 0) {
    lines.push('Threads closed:', bulletList(saved.threadsClosed.map((thread) => `${thread.text} (${thread.resolution})`), ''));
  }
  for (const collision of saved.collisions) lines.push(collisionSentence(names, collision));
  for (const caution of saved.cautions) lines.push(`Caution: ${caution}`);
  return lines.join('\n');
}

function sceneHeading(scene: SceneRecord | SceneSummary): string {
  return `Scene ${scene.number}${scene.starred ? ' (starred)' : ''}: "${scene.title}", ${scene.whenTyped}`;
}

export function sceneInFullInWords(inFull: SceneInFull, names: NamesInTheRun): string {
  const scene = inFull.scene;
  const lines = [
    sceneHeading(scene),
    scene.placeEntryId === null ? null : `Place: ${entryName(names, scene.placeEntryId)}`,
    `Summary: ${scene.summary}`,
    scene.record === '' ? null : `Record:\n${scene.record}`,
    scene.steer === '' ? null : `Steer: ${scene.steer}`,
    `After: ${scene.situationAfter}`,
  ];
  if (inFull.entriesIntroduced.length > 0) lines.push(`Introduced: ${inFull.entriesIntroduced.map((entry) => entry.name).join(', ')}.`);
  if (inFull.factsEstablished.length > 0) lines.push('Facts established:', bulletList(inFull.factsEstablished.map((fact) => factInWordsWith(names, fact)), ''));
  if (inFull.notes.length > 0) lines.push('Notes:', bulletList(inFull.notes.map((note) => `${entryName(names, note.entryId)}: ${note.text}`), ''));
  if (inFull.rulings.length > 0) lines.push('Rulings given:', bulletList(inFull.rulings.map((ruling) => `Ruling ${ruling.number}: ${ruling.text}`), ''));
  if (inFull.threadsOpened.length > 0) lines.push('Threads opened:', bulletList(inFull.threadsOpened.map((thread) => thread.text), ''));
  if (inFull.threadsClosed.length > 0) lines.push('Threads closed:', bulletList(inFull.threadsClosed.map((thread) => `${thread.text} (${thread.resolution})`), ''));
  return lines.filter((line): line is string => line !== null).join('\n');
}

export function sceneSummariesInWords(scenes: SceneSummary[]): string {
  if (scenes.length === 0) return 'No standing scenes in that stretch.';
  return scenes.map((scene) => `${sceneHeading(scene)}\n${scene.summary}`).join('\n\n');
}

export function entryLookupInWords(lookup: EntryLookup, names: NamesInTheRun): string {
  const entry = lookup.entry;
  const otherNames = entry.alsoKnownAs.length === 0 ? '' : `, also ${entry.alsoKnownAs.join(', ')}`;
  const lines = [`${entry.name} (${entry.kind}${entry.pronoun === '' ? '' : `, ${entry.pronoun}`}${otherNames})`];
  lines.push('Holds now:', bulletList(lookup.holding.map((fact) => factInWordsWith(names, fact)), '- Nothing recorded.'));
  if (lookup.history.length > 0) {
    lines.push('Before:', bulletList(lookup.history.map((fact) => {
      const until = sceneLabel(names, fact.untilSceneId);
      return `${factInWordsWith(names, fact)}${until === null ? '' : `, until ${until}`}`;
    }), ''));
  }
  if (lookup.trail.length > 0) {
    lines.push('Latest:', bulletList(lookup.trail.map((item) => `scene ${item.sceneNumber}: ${item.note.text}`), ''));
  }
  if (lookup.trailLeftOut > 0) lines.push(`${plural(lookup.trailLeftOut, 'older trail note was', 'older trail notes were')} left out; ask with a larger trail to see them.`);
  if (lookup.threads.length > 0) lines.push('Open threads:', bulletList(lookup.threads.map((thread) => `${thread.id}: ${thread.text}`), ''));
  if (lookup.rulings.length > 0) lines.push('Rulings:', bulletList(lookup.rulings.map((ruling) => `Ruling ${ruling.number}: ${ruling.text}`), ''));
  return lines.join('\n');
}

export function foundItemsInWords(items: FoundItem[]): string {
  return bulletList(items.map((item) => `${item.kind}: ${item.text}`), 'Nothing in the run holds that.');
}

export function rulingInWords(ruling: RulingRecord, names: NamesInTheRun): string {
  const about = ruling.aboutEntryIds.map((entryId) => entryName(names, entryId));
  const tags = [...ruling.topics, ...about];
  return `Ruling ${ruling.number} (${ruling.scope}, ${ruling.source}${tags.length === 0 ? '' : `; ${tags.join(', ')}`}):\n${ruling.text}`;
}

export function rulingsInWords(rulings: RulingRecord[], names: NamesInTheRun): string {
  return rulings.length === 0 ? 'No rulings bear on that.' : rulings.map((ruling) => rulingInWords(ruling, names)).join('\n\n');
}

export function threadsInWords(threads: ThreadRecord[], names: NamesInTheRun): string {
  return bulletList(threads.map((thread) => {
    const about = thread.aboutEntryIds.length === 0 ? '' : ` (about ${thread.aboutEntryIds.map((entryId) => entryName(names, entryId)).join(', ')})`;
    const state = thread.closedInSceneId === null ? 'open' : `closed: ${thread.resolution}`;
    return `${thread.id}: ${thread.text}${about}, ${state}`;
  }), 'No threads.');
}

export function factInWords(fact: FactRecord, names: NamesInTheRun): string {
  return `Stated: ${factInWordsWith(names, fact)}.`;
}

export function collisionsInWords(collisions: CollisionRecord[], names: NamesInTheRun): string {
  return collisions.length === 0 ? 'No collisions.' : collisions.map((collision) => collisionSentence(names, collision)).join('\n');
}

export function collisionInWords(collision: CollisionRecord, names: NamesInTheRun): string {
  return collisionSentence(names, collision);
}

/** One rendering per operation, so an operation added to the contract needs a rendering here too. */
export const ANSWER_IN_WORDS: { [Name in OperationName]: (answer: AnswerByOperation[Name], names: NamesInTheRun) => string } = {
  list_runs: (answer) => runListingsInWords(answer),
  begin_run: (answer) => runSnapshotInWords(answer),
  resume_run: (answer) => briefingInWords(answer),
  save_scene: (answer, names) => savedSceneInWords(answer, names),
  redo_scene: (answer, names) => savedSceneInWords(answer, names),
  read_scene: (answer, names) => sceneInFullInWords(answer, names),
  list_scenes: (answer) => sceneSummariesInWords(answer),
  look_up: (answer, names) => entryLookupInWords(answer, names),
  find: (answer) => foundItemsInWords(answer),
  list_rulings: (answer, names) => rulingsInWords(answer, names),
  list_threads: (answer, names) => threadsInWords(answer, names),
  record_ruling: (answer, names) => `Recorded. ${rulingInWords(answer, names)}`,
  state_fact: (answer, names) => factInWords(answer, names),
  list_collisions: (answer, names) => collisionsInWords(answer, names),
  settle_collision: (answer, names) => collisionInWords(answer, names),
  read_run: (answer) => runSnapshotInWords(answer),
};
