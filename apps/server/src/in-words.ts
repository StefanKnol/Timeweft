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
  EditedScene, AnswerByOperation, Briefing, ImportedRunReport, CollisionRecord, EntryLookup, EntryWritten, FactRecord, FoundItem, Id,
  OperationName, RulingRecord, RunListing, RunOutline, RunRecord, RunSnapshot, SavedScene, SceneInFull, SceneRecord, SceneSummary,
  SceneSearchResult, SceneText, ThreadRecord, WaypointRecord, RestoredRunReport, RunExportDocument, RunExportRowCounts, RunExportTableName,
} from '@timeweft/contract';
import { RUN_EXPORT_TABLE_IN_WORDS, RUN_EXPORT_TABLE_NAMES } from '@timeweft/contract';
import { onOneLine } from '@timeweft/briefing';

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
    // The setting and the register are said whole, never trimmed: a briefing that had to cut a
    // long register points the chat here for the rest of it.
    return [
      `- ${listing.run.slug}: "${listing.run.title}", ${listing.run.status}; ${plural(listing.standingScenes, 'scene', 'scenes')}, ${latest}; ${plural(listing.openThreads, 'open thread', 'open threads')}; ${plural(listing.waitingCollisions, 'collision waiting', 'collisions waiting')}.`,
      listing.run.setting === '' ? null : `  Setting: ${listing.run.setting}`,
      listing.run.register === '' ? null : `  Register: ${listing.run.register}`,
    ].filter((line): line is string => line !== null).join('\n');
  }).join('\n');
}

export function runSnapshotInWords(snapshot: RunSnapshot | RunOutline): string {
  const standing = snapshot.scenes.filter((scene) => scene.status === 'standing').length;
  const clocks = snapshot.clocks.map((clock) => `${clock.name}${clock.countsFrom === '' ? '' : ` (counts from ${clock.countsFrom})`}`);
  return [
    `Run ${snapshot.run.slug}: "${snapshot.run.title}" (${snapshot.run.status}).`,
    snapshot.run.setting === '' ? null : `Setting: ${snapshot.run.setting}`,
    `Clocks: ${clocks.length === 0 ? 'none' : clocks.join('; ')}.`,
    `${plural(standing, 'standing scene', 'standing scenes')}, ${plural(snapshot.entries.length, 'entry', 'entries')}, ${plural(snapshot.facts.length, 'fact', 'facts')}, ${plural(snapshot.rulings.length, 'ruling', 'rulings')}, ${plural(snapshot.threads.length, 'thread', 'threads')}, ${plural(snapshot.waypoints.length, 'waypoint', 'waypoints')}.`,
  ].filter((line): line is string => line !== null).join('\n');
}

/** One take's record, under its number. Never said over MCP: the operation is the author's. */
export function sceneTextInWords(text: SceneText): string {
  return [`Scene ${text.number} (${text.status}), id ${text.sceneId}.`, text.record === '' ? 'No record beyond the summary.' : text.record].join('\n');
}

/** A search of the scenes' words, one line per match. Never said over MCP: the operation is the author's. */
export function sceneSearchInWords(result: SceneSearchResult): string {
  if (result.total === 0) return 'No scene holds that text.';
  const lines = result.matches.map((match) => `- Scene ${match.number}${match.status === 'struck' ? ' (struck)' : ''}, "${match.title}", in its ${match.field}: ${match.excerpt}`);
  const shown = result.matches.length === result.total ? `${plural(result.total, 'scene holds', 'scenes hold')} that text:` : `${result.total} scenes hold that text; the newest ${result.matches.length}:`;
  return [shown, ...lines].join('\n');
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
  if (saved.threadsTouched.length > 0) {
    lines.push('Threads touched:', bulletList(saved.threadsTouched.map((thread) => touchedThreadInWords(thread, saved.scene.id)), ''));
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
  if (inFull.threadsTouched.length > 0) lines.push('Threads touched:', bulletList(inFull.threadsTouched.map((thread) => touchedThreadInWords(thread, scene.id)), ''));
  if (inFull.threadsClosed.length > 0) lines.push('Threads closed:', bulletList(inFull.threadsClosed.map((thread) => `${thread.text} (${thread.resolution})`), ''));
  // The briefing says read_scene fetches the journeys it left out, so they are said here.
  if (inFull.legs.length > 0) {
    lines.push('Journeys:', bulletList(inFull.legs.map((leg) => `From ${leg.fromPlace} to ${leg.toPlace}: ${leg.duration}${leg.note === '' ? '' : ` (${leg.note})`}`), ''));
  }
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

/**
 * A thread a scene touched, with what moved in that scene where it said. The note is said on one
 * line, as a briefing says it, so a line break in it cannot start a bullet of its own.
 */
function touchedThreadInWords(thread: ThreadRecord, sceneId: string): string {
  const note = onOneLine(thread.touches.find((touch) => touch.sceneId === sceneId)?.note ?? '');
  return `${thread.id}: ${thread.text}${note === '' ? '' : ` (moved: ${note})`}`;
}

/**
 * Threads in the order given, which is list_threads's ranking: the one a scene moved last first.
 * Each line says the scene it opened in and, where that differs, the scene it was last touched in
 * (opened, touched or closed), with what moved where that touch said: the same as a briefing.
 */
export function threadsInWords(threads: ThreadRecord[], names: NamesInTheRun): string {
  return bulletList(threads.map((thread) => {
    const about = thread.aboutEntryIds.length === 0 ? '' : ` (about ${thread.aboutEntryIds.map((entryId) => entryName(names, entryId)).join(', ')})`;
    const state = thread.closedInSceneId === null ? 'open' : `closed: ${thread.resolution}`;
    const opened = sceneLabel(names, thread.openedInSceneId);
    const lastTouched = sceneLabel(names, thread.lastTouchedInSceneId);
    const lastNote = thread.lastTouchedInSceneId === null ? '' : onOneLine(thread.touches.find((touch) => touch.sceneId === thread.lastTouchedInSceneId)?.note ?? '');
    const when = [
      opened === null ? '' : `opened ${opened}`,
      lastTouched === null || lastTouched === opened ? '' : `last touched ${lastTouched}${lastNote === '' ? '' : `: ${lastNote}`}`,
    ].filter((part) => part !== '').join(', ');
    return `${thread.id}: ${thread.text}${about}, ${state}${when === '' ? '' : `; ${when}`}`;
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

/** A fact the author ended: what held, and the scene it stopped holding at. */
export function endedFactInWords(fact: FactRecord, names: NamesInTheRun): string {
  const until = sceneLabel(names, fact.untilSceneId);
  return `Ended: ${factInWordsWith(names, fact)}${until === null ? '' : `, until ${until}`}. Nothing holds in its place, and the fact is kept as history.`;
}

/** A ruling the author withdrew, still said word for word. */
export function withdrawnRulingInWords(ruling: RulingRecord, names: NamesInTheRun): string {
  const since = sceneLabel(names, ruling.withdrawnInSceneId);
  return `Withdrawn${since === null ? '' : ` as of ${since}`}, and no longer told to a story. ${rulingInWords(ruling, names)}`;
}

/** A waypoint with its id, its newest words and where it stands: ahead, reached or withdrawn. */
export function waypointInWords(waypoint: WaypointRecord, names: NamesInTheRun): string {
  const reached = sceneLabel(names, waypoint.reachedInSceneId);
  const withdrawn = sceneLabel(names, waypoint.withdrawnInSceneId);
  const state = waypoint.withdrawnInSceneId !== null
    ? `withdrawn${withdrawn === null ? '' : ` as of ${withdrawn}`}`
    : waypoint.reachedInSceneId !== null ? `reached${reached === null ? '' : ` at ${reached}`}` : 'ahead';
  return `Waypoint ${waypoint.id} (${state}): ${waypoint.text}`;
}

/** A run as it stands after the author edited it: every part the author may change, said whole. */
export function editedRunInWords(run: RunRecord): string {
  return [
    `Run ${run.slug}: "${run.title}" (${run.status}).`,
    `Setting: ${run.setting === '' ? 'none given' : run.setting}`,
    `Register: ${run.register === '' ? 'none given' : run.register}`,
    'What it said before is kept.',
  ].join('\n');
}

/** How each field of a scene is named when an edit is said in words. */
const SCENE_FIELD_IN_WORDS: Record<EditedScene['fieldsChanged'][number], string> = {
  title: 'the title', summary: 'the summary', whenTyped: 'when it happens', placeEntryId: 'the place',
  record: 'the record', steer: 'the steer', situationAfter: 'what stood after it', starred: 'the star',
};

/** A scene the author edited: which take, and which fields changed. Never the words themselves. */
export function editedSceneInWords(edited: EditedScene): string {
  const fields = edited.fieldsChanged.map((field) => SCENE_FIELD_IN_WORDS[field]);
  const listed = fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}`;
  return `Scene ${edited.scene.number}, "${edited.scene.title}", changed: ${listed}. What it said before is kept.`;
}

/** One thread after the author opened, touched or closed it. */
export function threadInWords(verb: string, thread: ThreadRecord, names: NamesInTheRun): string {
  return `${verb}.\n${threadsInWords([thread], names)}`;
}

/** An entry the author added or changed, said as it now is, and every caution the store gave. */
export function entryWrittenInWords(verb: string, written: EntryWritten): string {
  const entry = written.entry;
  const details = [entry.kind, entry.pronoun === '' ? null : entry.pronoun, entry.visibility]
    .filter((part): part is string => part !== null).join(', ');
  const otherNames = entry.alsoKnownAs.length === 0 ? '' : `, also ${entry.alsoKnownAs.join(', ')}`;
  const lines = [`${verb} ${entry.name} (${details}${otherNames}), id ${entry.id}.`];
  for (const caution of written.cautions) lines.push(`Caution: ${caution}`);
  return lines.join('\n');
}

/** An import said as counts, then every line the reader could not place, word for word. */
export function importedRunInWords(report: ImportedRunReport): string {
  const { counts } = report;
  const lines = [
    `Imported run ${report.run.slug}: "${report.run.title}".`,
    `${plural(counts.scenes, 'scene', 'scenes')}, ${plural(counts.entries, 'entry', 'entries')}, ${plural(counts.facts, 'fact', 'facts')}, ${plural(counts.trailNotes, 'trail note', 'trail notes')}, ${plural(counts.rulings, 'ruling', 'rulings')}, ${plural(counts.threads, 'thread', 'threads')}, ${plural(counts.waypoints, 'waypoint', 'waypoints')}, ${plural(counts.journeyLegs, 'journey leg', 'journey legs')}, ${plural(counts.clocks, 'clock', 'clocks')}.`,
  ];
  const removed = report.removedEarlierImport ?? null;
  if (removed !== null) {
    lines.push(`It replaced the earlier import, which held ${plural(removed.scenes, 'scene', 'scenes')}, ${plural(removed.entries, 'entry', 'entries')}, ${plural(removed.facts, 'fact', 'facts')}, ${plural(removed.trailNotes, 'trail note', 'trail notes')}, ${plural(removed.rulings, 'ruling', 'rulings')}, ${plural(removed.threads, 'thread', 'threads')}, ${plural(removed.waypoints, 'waypoint', 'waypoints')}, ${plural(removed.journeyLegs, 'journey leg', 'journey legs')}, ${plural(removed.clocks, 'clock', 'clocks')}, and was removed.`);
  }
  if (report.unplaced.length === 0) {
    lines.push('Every line was placed.');
  } else {
    lines.push(`${plural(report.unplaced.length, 'line', 'lines')} could not be placed:`, bulletList(report.unplaced, ''));
  }
  return lines.join('\n');
}

/** How many rows of each table, one line per table, in the order a restore writes them. Counts only, never content. */
export function rowCountsInWords(counts: RunExportRowCounts, indent = ''): string[] {
  return RUN_EXPORT_TABLE_NAMES.map((table) => `${indent}${RUN_EXPORT_TABLE_IN_WORDS[table]}: ${counts[table]}`);
}

/** The rows a backup document holds, counted per table. */
export function rowCountsOf(document: RunExportDocument): RunExportRowCounts {
  return Object.fromEntries(RUN_EXPORT_TABLE_NAMES.map((table) => [table, document.tables[table].length])) as RunExportRowCounts;
}

/** An export said as counts. The document itself is the answer; words never carry its content. */
export function exportedRunInWords(document: RunExportDocument): string {
  return [`A backup of the run ${document.runSlug}, taken at ${document.exportedAt}, format version ${document.formatVersion}. It holds:`, ...rowCountsInWords(rowCountsOf(document), '- ')].join('\n');
}

/** A restore said as counts, and what a replaced run held. */
export function restoredRunInWords(report: RestoredRunReport): string {
  const lines = [`Restored the run ${report.run.slug}. It holds:`, ...rowCountsInWords(report.rowsRestored, '- ')];
  if (report.replaced !== null) {
    lines.push(`It replaced the run ${report.replaced.run.slug}, which was removed. That run held:`, ...rowCountsInWords(report.replaced.rowsRemoved, '- '));
  }
  return lines.join('\n');
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
  end_fact: (answer, names) => endedFactInWords(answer, names),
  withdraw_ruling: (answer, names) => withdrawnRulingInWords(answer, names),
  add_waypoint: (answer, names) => `Added. ${waypointInWords(answer, names)}`,
  reword_waypoint: (answer, names) => `Reworded; what it said before is kept. ${waypointInWords(answer, names)}`,
  mark_waypoint_reached: (answer, names) => `Marked reached. ${waypointInWords(answer, names)}`,
  withdraw_waypoint: (answer, names) => `Withdrawn, kept, and no longer told to a story. ${waypointInWords(answer, names)}`,
  edit_run: (answer) => editedRunInWords(answer),
  open_thread: (answer, names) => threadInWords('Opened', answer, names),
  touch_thread: (answer, names) => threadInWords('Touched', answer, names),
  close_thread: (answer, names) => threadInWords('Closed', answer, names),
  add_entry: (answer) => entryWrittenInWords('Added', answer),
  edit_entry: (answer) => entryWrittenInWords('Changed; what it said before is kept.', answer),
  rename_entry: (answer) => entryWrittenInWords('Renamed; the old name is among its other names.', answer),
  set_entry_visibility: (answer) => entryWrittenInWords(answer.entry.visibility === 'open' ? 'Turned open:' : 'Turned author-only:', answer),
  edit_scene: (answer) => editedSceneInWords(answer),
  list_collisions: (answer, names) => collisionsInWords(answer, names),
  settle_collision: (answer, names) => collisionInWords(answer, names),
  read_run: (answer) => runSnapshotInWords(answer),
  read_scene_text: (answer) => sceneTextInWords(answer),
  search_scenes: (answer) => sceneSearchInWords(answer),
  import_run: (answer) => importedRunInWords(answer),
  export_run: (answer) => exportedRunInWords(answer),
  restore_run: (answer) => restoredRunInWords(answer),
};
