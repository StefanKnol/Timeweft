import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MIGRATIONS, openStore, openStoreForTests, testDatabaseUrl } from './index.ts';
import { normaliseProperty } from './names.ts';

async function appliedMigrations(schema: string): Promise<number[]> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ number: number }>(`select number from ${schema}.timeweft_migrations order by number`);
    return result.rows.map((row) => row.number);
  } finally {
    await client.end();
  }
}

test('migrate applies each migration once, however often it is called', async () => {
  const { store, schema, dispose } = await openStoreForTests();
  try {
    await store.migrate();
    await store.migrate();
    assert.deepEqual(await appliedMigrations(schema), MIGRATIONS.map((migration) => migration.number));
  } finally {
    await dispose();
  }
});

test('two connections migrating one schema at once both succeed and apply it once', async () => {
  const { schema, dispose } = await openStoreForTests();
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  const freshSchema = `${schema}_fresh`;
  await client.query(`create schema ${freshSchema}`);
  const first = await openStore(testDatabaseUrl(), { schema: freshSchema });
  const second = await openStore(testDatabaseUrl(), { schema: freshSchema });
  try {
    await Promise.all([first.migrate(), second.migrate(), first.migrate()]);
    assert.deepEqual(await appliedMigrations(freshSchema), MIGRATIONS.map((migration) => migration.number));
    assert.deepEqual(await first.listRuns(), []);
  } finally {
    await first.close();
    await second.close();
    await client.query(`drop schema ${freshSchema} cascade`);
    await client.end();
    await dispose();
  }
});

test('migrating an older schema lower-cases and trims every property already stored', async () => {
  const { schema, dispose } = await openStoreForTests();
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  const olderSchema = `${schema}_older`;
  try {
    await client.query(`create schema ${olderSchema}`);
    await client.query(`set search_path to ${olderSchema}`);
    for (const statement of MIGRATIONS[0]!.statements) await client.query(statement);
    await client.query(`create table timeweft_migrations (number integer primary key, name text not null, applied_at timestamptz not null default now())`);
    await client.query(`insert into timeweft_migrations (number, name) values (1, 'the story loop')`);
    const runId = (await client.query<{ id: string }>(`insert into runs (slug, title, status) values ('older', 'Older', 'binding') returning id`)).rows[0]!.id;
    const entryId = (await client.query<{ id: string }>(`insert into entries (run_id, kind, name, source, visibility) values ($1, 'item', 'the ferry', 'story', 'open') returning id`, [runId])).rows[0]!.id;
    const factId = (await client.query<{ id: string }>(`insert into facts (run_id, entry_id, property, value, source, visibility) values ($1, $2, '  Where ', 'afloat', 'story', 'open') returning id`, [runId, entryId])).rows[0]!.id;
    await client.query(`insert into collisions (run_id, entry_id, property, standing_fact_id, proposed_value, state) values ($1, $2, 'WHERE', $3, 'sunk', 'waiting')`, [runId, entryId, factId]);
    const older = await openStore(testDatabaseUrl(), { schema: olderSchema });
    try {
      await older.migrate();
      const snapshot = await older.snapshotOf('older', 'author');
      assert.deepEqual(snapshot.facts.map((fact) => fact.property), ['where']);
      assert.deepEqual(snapshot.collisions.map((collision) => collision.property), ['where']);
    } finally {
      await older.close();
    }
  } finally {
    await client.query(`drop schema ${olderSchema} cascade`);
    await client.end();
    await dispose();
  }
});

/** A schema with migrations 1 and 2 applied by hand, as an installation written before migration 3 has it. */
async function schemaAtMigrationTwo(client: pg.Client, schemaName: string): Promise<void> {
  await client.query(`create schema ${schemaName}`);
  await client.query(`set search_path to ${schemaName}`);
  await client.query(`create table timeweft_migrations (number integer primary key, name text not null, applied_at timestamptz not null default now())`);
  for (const migration of MIGRATIONS.slice(0, 2)) {
    for (const statement of migration.statements) await client.query(statement);
    await client.query(`insert into timeweft_migrations (number, name) values ($1, $2)`, [migration.number, migration.name]);
  }
}

test('migrating a schema written before migration 3 spells every property as the doors now do', async () => {
  const { schema, dispose } = await openStoreForTests();
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  const olderSchema = `${schema}_spelling`;
  const spellings = ['  Cafe\u0301   Owner ', 'WHERE\u00a0\u00a0it\tStands', '\u3000mood\u2003'];
  try {
    await schemaAtMigrationTwo(client, olderSchema);
    const runId = (await client.query<{ id: string }>(`insert into runs (slug, title, status) values ('spelled', 'Spelled', 'binding') returning id`)).rows[0]!.id;
    const entryId = (await client.query<{ id: string }>(`insert into entries (run_id, kind, name, source, visibility) values ($1, 'item', 'the ferry', 'story', 'open') returning id`, [runId])).rows[0]!.id;
    for (const spelling of spellings) {
      const factId = (await client.query<{ id: string }>(`insert into facts (run_id, entry_id, property, value, source, visibility) values ($1, $2, $3, 'afloat', 'story', 'open') returning id`, [runId, entryId, spelling])).rows[0]!.id;
      await client.query(`insert into collisions (run_id, entry_id, property, standing_fact_id, proposed_value, state) values ($1, $2, $3, $4, 'sunk', 'waiting')`, [runId, entryId, spelling, factId]);
    }
    const older = await openStore(testDatabaseUrl(), { schema: olderSchema });
    try {
      await older.migrate();
      const snapshot = await older.snapshotOf('spelled', 'author');
      const expected = spellings.map(normaliseProperty);
      assert.deepEqual(expected, ['caf\u00e9 owner', 'where it stands', 'mood'], 'the doors spell them so');
      assert.deepEqual(snapshot.facts.map((fact) => fact.property), expected);
      assert.deepEqual(snapshot.collisions.map((collision) => collision.property), expected);
    } finally {
      await older.close();
    }
  } finally {
    await client.query(`drop schema ${olderSchema} cascade`);
    await client.end();
    await dispose();
  }
});

test('migrating a schema written before the lanes rule reopens an open fact only an author-only fact closed', async () => {
  const { schema, dispose } = await openStoreForTests();
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  const olderSchema = `${schema}_lanes`;
  try {
    await schemaAtMigrationTwo(client, olderSchema);
    const runId = (await client.query<{ id: string }>(`insert into runs (slug, title, status) values ('lanes', 'Lanes', 'binding') returning id`)).rows[0]!.id;
    const sceneOf = async (number: number, status = 'standing'): Promise<string> => (await client.query<{ id: string }>(
      `insert into scenes (run_id, number, title, status) values ($1, $2, 'A scene', $3) returning id`, [runId, number, status])).rows[0]!.id;
    const first = await sceneOf(1);
    const second = await sceneOf(2);
    const struck = await sceneOf(3, 'struck');
    const entryId = (await client.query<{ id: string }>(`insert into entries (run_id, kind, name, source, visibility) values ($1, 'item', 'the lantern', 'story', 'open') returning id`, [runId])).rows[0]!.id;
    const fact = async (property: string, value: string, visibility: string, from: string | null, until: string | null, closedBy: string | null, establishedBy: string | null = null): Promise<void> => {
      await client.query(`insert into facts (run_id, entry_id, property, value, source, visibility, from_scene_id, until_scene_id, closed_by_scene_id, established_by_scene_id)
        values ($1, $2, $3, $4, 'author', $5, $6, $7, $8, $9)`, [runId, entryId, property, value, visibility, from, until, closedBy, establishedBy]);
    };
    // The fault: an author-only state_fact closed the open one, with no scene's save as the closer.
    await fact('maker', 'a tinker', 'open', first, second, null);
    await fact('maker', 'the old smith', 'author-only', second, null, null);
    // An open state_fact closed this one and wrote its successor in the same lane: it stays closed.
    await fact('mood', 'calm', 'open', first, second, null);
    await fact('mood', 'wary', 'open', second, null, null);
    // A scene's save closed this one: it stays closed.
    await fact('colour', 'brass', 'open', first, second, second, first);
    // A redone take established this one and the redo closed it at the struck scene: it stays closed.
    await fact('flame', 'lit', 'open', struck, struck, null, struck);
    const older = await openStore(testDatabaseUrl(), { schema: olderSchema });
    try {
      await older.migrate();
      const snapshot = await older.snapshotOf('lanes', 'author');
      const untilOf = (value: string) => snapshot.facts.find((candidate) => candidate.value === value)!.untilSceneId;
      assert.equal(untilOf('a tinker'), null, 'what the author-only fact closed holds again');
      assert.equal(untilOf('the old smith'), null);
      assert.equal(untilOf('calm'), second);
      assert.equal(untilOf('brass'), second);
      assert.equal(untilOf('lit'), struck);
    } finally {
      await older.close();
    }
  } finally {
    await client.query(`drop schema ${olderSchema} cascade`);
    await client.end();
    await dispose();
  }
});
