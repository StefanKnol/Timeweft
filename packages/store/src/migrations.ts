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

/**
 * Every character JavaScript's `\s` and `String.prototype.trim` treat as whitespace. PostgreSQL's
 * `\s` follows the database's locale and, under `C.UTF-8`, does not take a no-break space, so the
 * class is written out to match what `normaliseName` does in the doors.
 */
const WHITESPACE_AS_THE_DOORS_READ_IT = '\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/**
 * The SQL that spells a property column as `normaliseProperty` does: NFC, trimmed, each run of
 * whitespace one space, lower case. Exported so a test can hold the two to one answer.
 */
export function propertyAsTheDoorsKeepIt(column: string): string {
  const whitespace = `[${WHITESPACE_AS_THE_DOORS_READ_IT}]`;
  const composed = `normalize(${column}, NFC)`;
  const trimmed = `regexp_replace(${composed}, '^${whitespace}+|${whitespace}+$', '', 'g')`;
  return `lower(regexp_replace(${trimmed}, '${whitespace}+', ' ', 'g'))`;
}

/** The sequence every row a run holds takes its write mark from. */
export const WRITE_MARKS = 'timeweft_write_marks';

/** The tables whose rows a run holds and an import writes, each carrying a write mark. */
export const TABLES_A_RUN_WRITES = ['clocks', 'scenes', 'entries', 'facts', 'entry_notes', 'rulings', 'threads', 'waypoints', 'journey_legs'] as const;

/**
 * The tables migration 6 adds for the author's hand, each carrying a write mark from the start. Kept
 * apart from `TABLES_A_RUN_WRITES` because migration 4 walks that list and these tables do not exist
 * when it runs; replacing an earlier import counts both lists.
 */
export const TABLES_THE_AUTHORS_HAND_WRITES = ['waypoint_rewordings', 'run_edits', 'entry_edits'] as const;

/** The marks migration 4 gives the rows stored before marks were kept. The sequence starts above them. */
export const IMPORTS_OWN_MARK = 1;
export const WRITTEN_LATER_MARK = 2;
/** A row a migration rewrote after the import, which cannot be told from a later write. */
export const CANNOT_BE_TOLD_MARK = 3;

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
  {
    number: 2,
    name: 'one spelling per property, and who reached a waypoint',
    statements: [
      // The doors now trim and lower-case a property; rows written before that are brought in line.
      // Two facts that were held apart only by spelling may now both hold on one property, read as alongside.
      `update facts set property = lower(regexp_replace(property, '^\\s+|\\s+$', '', 'g'))`,
      `update collisions set property = lower(regexp_replace(property, '^\\s+|\\s+$', '', 'g'))`,
      // Which scene's save reached a waypoint. Null where an import only dated it, so a redo of that
      // scene leaves it reached rather than taking back what the save never did.
      `alter table waypoints add column reached_by_scene_id uuid references scenes(id)`,
      // Rows already there: a save reaches a waypoint written before the scene, while an import writes
      // its scenes first and its waypoints after, in one transaction. So a waypoint older than the
      // scene it is dated to was reached by that scene's save.
      `update waypoints set reached_by_scene_id = reached_in_scene_id
        from scenes where scenes.id = waypoints.reached_in_scene_id and scenes.created_at > waypoints.created_at`,
    ],
  },
  {
    number: 3,
    name: 'a property spelled as a name is, and open facts an author-only fact closed',
    statements: [
      // The doors now compose, trim, collapse inner whitespace and lower-case a property, as a name is
      // matched. Rows written before that are brought in line by the same steps, in the same order.
      `update facts set property = ${propertyAsTheDoorsKeepIt('property')}`,
      `update collisions set property = ${propertyAsTheDoorsKeepIt('property')}`,
      // Before each lane closed only its own, an author-only state_fact closed the open facts on its
      // property, so a story saw the value end with nothing in its place. Such a closing is told
      // apart by what it lacks: no scene's save did it (a save, and taking a story's side of a
      // collision, record their scene as the closer), and no open fact written later on the same entry
      // and property followed it (an open state_fact, and an import's chain, always write one). An
      // open fact closed like that holds again. A fact a redone take established is closed at the
      // struck scene with no closer either, and is left closed: that closing is the redo's.
      `update facts set until_scene_id = null
        where visibility = 'open' and until_scene_id is not null and closed_by_scene_id is null
          and not exists (select 1 from scenes struck where struck.id = facts.until_scene_id and struck.status = 'struck')
          and not exists (
            select 1 from facts later
            where later.entry_id = facts.entry_id and later.property = facts.property
              and later.visibility = 'open' and later.written_order > facts.written_order
          )`,
    ],
  },
  {
    number: 4,
    name: 'which writes in a run were its import',
    statements: [
      // Every row a run holds carries a mark from one sequence, taken when the row is written, and an
      // import marks its run with a mark taken after its last row. A row with a later mark was written
      // after the import, by a story or the author, which is what keeps replacing an earlier import
      // from removing more than the import wrote. A sequence only rises, so this does not depend on
      // the database's clock, which can be stepped back. Marks below 10 are the ones given here to
      // the rows already stored.
      `create sequence ${WRITE_MARKS} start with 10`,
      `alter table runs add column imported_through bigint`,
      ...TABLES_A_RUN_WRITES.map((table) => `alter table ${table} add column write_mark bigint`),
      // Runs imported before the marks: every row an import wrote was written in the transaction that
      // wrote the run, so it shares the run's xmin until something rewrites it (nothing updates a
      // run). The newest such row is when the import finished. Two things make that unreadable, and
      // such a run is left undated, so replacing it is refused rather than guessed at: a run whose
      // xmin a recorded migration or another run shares was copied in one transaction (a restore),
      // where every row shares one xmin whoever wrote it; and a run with nothing written as an import
      // was begun in a chat.
      `create temporary table runs_dated_by_their_import on commit drop as
        select runs.id as run_id, (
          select max(written_with_the_run.created_at) from (
            ${TABLES_A_RUN_WRITES.map((table) => `select created_at from ${table} where run_id = runs.id and xmin = runs.xmin`).join(' union all ')}
          ) written_with_the_run
        ) as imported_at
        from runs
        where (exists (select 1 from entries where entries.run_id = runs.id and entries.source = 'import')
            or exists (select 1 from facts where facts.run_id = runs.id and facts.source = 'import')
            or exists (select 1 from rulings where rulings.run_id = runs.id and rulings.source = 'import'))
          and not exists (select 1 from timeweft_migrations where timeweft_migrations.xmin = runs.xmin)
          and not exists (select 1 from runs other where other.id <> runs.id and other.xmin = runs.xmin)`,
      `delete from runs_dated_by_their_import where imported_at is null`,
      // A row of a dated run is the import's (${IMPORTS_OWN_MARK}) where it shares the run's xmin. One a
      // later transaction wrote is a story's or the author's (${WRITTEN_LATER_MARK}). One a migration
      // rewrote (its xmin is that migration's record) is the import's where it was written no later
      // than the import's newest row, and otherwise cannot be told apart (${CANNOT_BE_TOLD_MARK}): it
      // may be the import's own, or a later write.
      ...TABLES_A_RUN_WRITES.map((table) => `update ${table} set write_mark = case
          when dated.run_id is null then ${WRITTEN_LATER_MARK}
          when ${table}.xmin = runs.xmin then ${IMPORTS_OWN_MARK}
          when exists (select 1 from timeweft_migrations where timeweft_migrations.xmin = ${table}.xmin)
            then case when ${table}.created_at <= dated.imported_at then ${IMPORTS_OWN_MARK} else ${CANNOT_BE_TOLD_MARK} end
          else ${WRITTEN_LATER_MARK}
        end
        from runs left join runs_dated_by_their_import dated on dated.run_id = runs.id
        where runs.id = ${table}.run_id`),
      `update runs set imported_through = ${IMPORTS_OWN_MARK} where id in (select run_id from runs_dated_by_their_import)`,
      ...TABLES_A_RUN_WRITES.map((table) => `alter table ${table}
        alter column write_mark set default nextval('${WRITE_MARKS}'), alter column write_mark set not null`),
    ],
  },
  {
    number: 5,
    name: 'a scene may touch a thread',
    statements: [
      // A row per scene that moved a thread on, not a column on the thread: a touch by a take that is
      // later struck must stop counting while the row is kept, and the scene's status says which.
      // Both keys cascade, so removing a run's threads or scenes in either order removes its touches.
      // written_by_scene_id is the scene whose save wrote the touch, and null for one an import wrote:
      // a redo moves an import's touch onto the new take, as it moves an import's closing, and leaves
      // the struck take's own where they are.
      `create table thread_touches (
        thread_id uuid not null references threads(id) on delete cascade,
        scene_id uuid not null references scenes(id) on delete cascade,
        note text not null default '',
        written_by_scene_id uuid references scenes(id) on delete cascade,
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN},
        primary key (thread_id, scene_id)
      )`,
      `create index thread_touches_by_scene on thread_touches (scene_id)`,
    ],
  },
  {
    number: 6,
    name: "the author's hand",
    statements: [
      // A waypoint the author withdrew is kept, dated to the newest standing scene when it was withdrawn.
      `alter table waypoints add column withdrawn_in_scene_id uuid references scenes(id)`,
      // The earlier values of what the author changes in place are kept as rows, oldest first. Each
      // carries a write mark, so an author's change after an import stops that import being replaced.
      // after_scene_id dates the change to the newest standing scene when it was made, or null.
      `create table waypoint_rewordings (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        waypoint_id uuid not null references waypoints(id) on delete cascade,
        earlier_text text not null,
        later_text text not null,
        after_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN},
        write_mark bigint not null default nextval('${WRITE_MARKS}')
      )`,
      `create index waypoint_rewordings_by_run on waypoint_rewordings (run_id, written_order)`,
      `create table run_edits (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        field text not null check (field in ('title', 'setting', 'register', 'status')),
        earlier_value text not null,
        later_value text not null,
        after_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN},
        write_mark bigint not null default nextval('${WRITE_MARKS}')
      )`,
      `create index run_edits_by_run on run_edits (run_id, written_order)`,
      `create table entry_edits (
        ${KEEPS_ITS_OWN_ID},
        run_id uuid not null references runs(id) on delete cascade,
        entry_id uuid not null references entries(id) on delete cascade,
        field text not null check (field in ('name', 'alsoKnownAs', 'pronoun', 'kind', 'visibility')),
        earlier_value text not null,
        later_value text not null,
        after_scene_id uuid references scenes(id),
        ${WHEN_WRITTEN},
        ${ORDER_WRITTEN},
        write_mark bigint not null default nextval('${WRITE_MARKS}')
      )`,
      `create index entry_edits_by_run on entry_edits (run_id, written_order)`,
      // A touch the author made by hand. A scene's save never writes over one: where a take touches
      // the same thread at the same scene, the author's note is kept and the take's is left out.
      `alter table thread_touches add column by_author boolean not null default false`,
    ],
  },
  {
    number: 7,
    name: 'a run restored over itself keeps the runs that continue from it',
    statements: [
      // Restoring a backup in place of the run it was taken from removes that run and writes it again
      // under the same id, in one transaction. A run continuing from it points at that id the whole
      // time, but the check would fire between the removal and the writing. Deferrable, the restore
      // asks for the check at the end of its transaction; every other write still has it at once.
      `alter table runs alter constraint runs_continues_run_id_fkey deferrable initially immediate`,
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
