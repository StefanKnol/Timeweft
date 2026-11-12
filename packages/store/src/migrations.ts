/**
 * The migrations, numbered and in code. Each is applied once, inside a transaction, and recorded
 * in `timeweft_migrations`. Two processes starting at once take an advisory lock first, so the
 * second waits and then finds the work done.
 *
 * Lists of plain words (other names, topics) are text arrays: nothing points at them. Lists of
 * entries a ruling or a thread is about are join tables, so that every such id has a foreign key
 * and cannot point at nothing.
 *
 * Two foreign keys are deferred to the end of the transaction: a scene's place and an entry's
 * introducing scene. A scene may introduce the place it happens at, so the two rows point at each
 * other, and a deferred check lets them be written in either order.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from './database.ts';

interface Migration {
  number: number;
  name: string;
  statements: string[];
}

const KEEPS_ITS_OWN_ID = `id uuid primary key default gen_random_uuid()`;
const WHEN_WRITTEN = `created_at timestamptz not null default clock_timestamp()`;
const ORDER_WRITTEN = `written_order bigint generated always as identity`;

export const MIGRATIONS: Migration[] = [
  {
    number: 1,
    name: 'the story loop',
    statements: [
      `create table runs (
        ${KEEPS_ITS_OWN_ID},
        slug text not null unique,
        title text not null,
        setting text not null default '',
        status text not null check (status in ('binding', 'telling')),
        continues_run_id uuid references runs(id),
        register text not null default '',
        ${WHEN_WRITTEN}
      )`,
      `create table clocks (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        name text not null,
        counts_from text not null default '',
        position integer not null,
        ${WHEN_WRITTEN}
      )`,
      `create unique index clocks_one_name_per_run on clocks (run_id, lower(btrim(name)))`,
      `create table scenes (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        number integer not null check (number >= 1),
        title text not null,
        starred boolean not null default false,
        when_typed text not null default '',
        place_entry_id uuid,
        summary text not null default '',
        record text not null default '',
        steer text not null default '',
        situation_after text not null default '',
        status text not null check (status in ('standing', 'struck')),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create unique index scenes_one_standing_per_number on scenes (run_id, number) where status = 'standing'`,
      `create index scenes_by_run on scenes (run_id, number)`,
      `create table scene_readings (
        scene_id uuid not null references scenes(id) on delete cascade,
        clock_id uuid not null references clocks(id) on delete cascade,
        count text not null,
        part_of_day text not null default '',
        position integer not null,
        primary key (scene_id, clock_id)
      )`,
      `create table entries (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        kind text not null check (kind in ('person', 'group', 'place', 'item', 'other')),
        name text not null,
        also_known_as text[] not null default '{}',
        pronoun text not null default '',
        introduced_in_scene_id uuid references scenes(id) deferrable initially deferred,
        source text not null check (source in ('author', 'story', 'import')),
        visibility text not null check (visibility in ('open', 'author-only')),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index entries_by_run on entries (run_id)`,
      `alter table scenes add constraint scenes_place_is_an_entry
        foreign key (place_entry_id) references entries(id) deferrable initially deferred`,
      `create table facts (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        entry_id uuid not null references entries(id) on delete cascade,
        property text not null,
        value text not null,
        about_entry_id uuid references entries(id),
        from_scene_id uuid references scenes(id),
        until_scene_id uuid references scenes(id),
        source text not null check (source in ('author', 'story', 'import')),
        visibility text not null check (visibility in ('open', 'author-only')),
        note text not null default '',
        established_by_scene_id uuid references scenes(id),
        closed_by_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index facts_by_run on facts (run_id, written_order)`,
      `create index facts_holding on facts (entry_id, property) where until_scene_id is null`,
      `create index facts_by_establishing_scene on facts (established_by_scene_id)`,
      `create index facts_by_closing_scene on facts (closed_by_scene_id)`,
      `create table entry_notes (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        entry_id uuid not null references entries(id) on delete cascade,
        scene_id uuid not null references scenes(id),
        text text not null,
        visibility text not null check (visibility in ('open', 'author-only')),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index entry_notes_by_run on entry_notes (run_id, written_order)`,
      `create index entry_notes_by_entry on entry_notes (entry_id)`,
      `create table rulings (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        number integer not null,
        text text not null,
        source text not null check (source in ('author', 'story', 'import')),
        scope text not null check (scope in ('run', 'world')),
        topics text[] not null default '{}',
        scene_id uuid references scenes(id),
        withdrawn_in_scene_id uuid references scenes(id),
        established_by_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        unique (run_id, number)
      )`,
      `create table ruling_about_entries (
        ruling_id uuid not null references rulings(id) on delete cascade,
        entry_id uuid not null references entries(id) on delete cascade,
        position integer not null,
        primary key (ruling_id, entry_id)
      )`,
      `create index ruling_about_entries_by_entry on ruling_about_entries (entry_id)`,
      `create table threads (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        text text not null,
        opened_in_scene_id uuid references scenes(id),
        closed_in_scene_id uuid references scenes(id),
        resolution text not null default '',
        established_by_scene_id uuid references scenes(id),
        closed_by_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index threads_by_run on threads (run_id)`,
      `create table thread_about_entries (
        thread_id uuid not null references threads(id) on delete cascade,
        entry_id uuid not null references entries(id) on delete cascade,
        position integer not null,
        primary key (thread_id, entry_id)
      )`,
      `create index thread_about_entries_by_entry on thread_about_entries (entry_id)`,
      `create table waypoints (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        text text not null,
        reached_in_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index waypoints_by_run on waypoints (run_id)`,
      `create table journey_legs (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        from_place text not null,
        to_place text not null,
        duration text not null,
        note text not null default '',
        scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index journey_legs_by_run on journey_legs (run_id)`,
      `create table collisions (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        scene_id uuid references scenes(id),
        entry_id uuid not null references entries(id) on delete cascade,
        property text not null,
        standing_fact_id uuid not null references facts(id),
        proposed_value text not null,
        proposed_about_entry_id uuid references entries(id),
        state text not null check (state in ('waiting', 'author-kept', 'story-taken')),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN}
      )`,
      `create index collisions_by_run on collisions (run_id, state)`,
    ],
  },
];

/**
 * Applies every migration not yet recorded. The advisory lock is keyed on the schema in use, so
 * two test schemas do not wait on each other while two processes on one schema do.
 */
export async function applyMigrations(database: Kysely<Database>): Promise<void> {
  const takeTheLock = sql`select pg_advisory_xact_lock(hashtext(current_schema() || ':timeweft-migrations'))`;
  await database.transaction().execute(async (transaction) => {
    await takeTheLock.execute(transaction);
    await sql`create table if not exists timeweft_migrations (
      number integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )`.execute(transaction);
  });
  for (const migration of MIGRATIONS) {
    await database.transaction().execute(async (transaction) => {
      await takeTheLock.execute(transaction);
      const alreadyApplied = await transaction
        .selectFrom('timeweft_migrations').select('number').where('number', '=', migration.number)
        .executeTakeFirst();
      if (alreadyApplied !== undefined) return;
      for (const statement of migration.statements) await sql.raw(statement).execute(transaction);
      await transaction.insertInto('timeweft_migrations')
        .values({ number: migration.number, name: migration.name }).execute();
    });
  }
}
