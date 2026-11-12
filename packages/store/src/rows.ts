/**
 * Turning rows into the contract's records. The store's own bookkeeping columns stop here.
 */
import type { Selectable } from 'kysely';
import type {
  ClockReading, ClockRecord, CollisionRecord, CollisionState, EntryKind, EntryNoteRecord,
  EntryRecord, FactRecord, JourneyLegRecord, RulingRecord, RulingScope, RunRecord, RunStatus,
  SceneRecord, SceneStatus, Source, ThreadRecord, Visibility, WaypointRecord,
} from '@timeweft/contract';
import type {
  ClocksTable, CollisionsTable, EntriesTable, EntryNotesTable, FactsTable, JourneyLegsTable,
  RulingsTable, RunsTable, ScenesTable, ThreadsTable, WaypointsTable,
} from './database.ts';

export type RunRow = Selectable<RunsTable>;
export type SceneRow = Selectable<ScenesTable>;
export type EntryRow = Selectable<EntriesTable>;
export type FactRow = Selectable<FactsTable>;
export type RulingRow = Selectable<RulingsTable>;
export type ThreadRow = Selectable<ThreadsTable>;
export type CollisionRow = Selectable<CollisionsTable>;

function asText(moment: Date): string {
  return moment.toISOString();
}

export function runFromRow(row: RunRow): RunRecord {
  return {
    id: row.id, slug: row.slug, title: row.title, setting: row.setting,
    status: row.status as RunStatus, continuesRunId: row.continues_run_id, register: row.register,
    createdAt: asText(row.created_at),
  };
}

export function clockFromRow(row: Selectable<ClocksTable>): ClockRecord {
  return { id: row.id, runId: row.run_id, name: row.name, countsFrom: row.counts_from };
}

export function sceneFromRow(row: SceneRow, readings: ClockReading[]): SceneRecord {
  return {
    id: row.id, runId: row.run_id, number: row.number, title: row.title, starred: row.starred,
    whenTyped: row.when_typed, placeEntryId: row.place_entry_id, summary: row.summary,
    record: row.record, steer: row.steer, situationAfter: row.situation_after,
    status: row.status as SceneStatus, readings, createdAt: asText(row.created_at),
  };
}

export function entryFromRow(row: EntryRow): EntryRecord {
  return {
    id: row.id, runId: row.run_id, kind: row.kind as EntryKind, name: row.name,
    alsoKnownAs: [...row.also_known_as], pronoun: row.pronoun,
    introducedInSceneId: row.introduced_in_scene_id, source: row.source as Source,
    visibility: row.visibility as Visibility, createdAt: asText(row.created_at),
  };
}

export function factFromRow(row: FactRow): FactRecord {
  return {
    id: row.id, entryId: row.entry_id, property: row.property, value: row.value,
    aboutEntryId: row.about_entry_id, fromSceneId: row.from_scene_id,
    untilSceneId: row.until_scene_id, source: row.source as Source,
    visibility: row.visibility as Visibility, note: row.note, createdAt: asText(row.created_at),
  };
}

export function noteFromRow(row: Selectable<EntryNotesTable>): EntryNoteRecord {
  return {
    id: row.id, entryId: row.entry_id, sceneId: row.scene_id, text: row.text,
    visibility: row.visibility as Visibility, createdAt: asText(row.created_at),
  };
}

export function rulingFromRow(row: RulingRow, aboutEntryIds: string[]): RulingRecord {
  return {
    id: row.id, runId: row.run_id, number: row.number, text: row.text,
    source: row.source as Source, scope: row.scope as RulingScope, topics: [...row.topics],
    aboutEntryIds, sceneId: row.scene_id, withdrawnInSceneId: row.withdrawn_in_scene_id,
    createdAt: asText(row.created_at),
  };
}

export function threadFromRow(row: ThreadRow, aboutEntryIds: string[]): ThreadRecord {
  return {
    id: row.id, runId: row.run_id, text: row.text, aboutEntryIds,
    openedInSceneId: row.opened_in_scene_id, closedInSceneId: row.closed_in_scene_id,
    resolution: row.resolution, createdAt: asText(row.created_at),
  };
}

export function waypointFromRow(row: Selectable<WaypointsTable>): WaypointRecord {
  return {
    id: row.id, runId: row.run_id, text: row.text, reachedInSceneId: row.reached_in_scene_id,
    createdAt: asText(row.created_at),
  };
}

export function legFromRow(row: Selectable<JourneyLegsTable>): JourneyLegRecord {
  return {
    id: row.id, runId: row.run_id, fromPlace: row.from_place, toPlace: row.to_place,
    duration: row.duration, note: row.note, sceneId: row.scene_id, createdAt: asText(row.created_at),
  };
}

export function collisionFromRow(row: CollisionRow): CollisionRecord {
  return {
    id: row.id, runId: row.run_id, sceneId: row.scene_id, entryId: row.entry_id,
    property: row.property, standingFactId: row.standing_fact_id,
    proposedValue: row.proposed_value, proposedAboutEntryId: row.proposed_about_entry_id,
    state: row.state as CollisionState, createdAt: asText(row.created_at),
  };
}
