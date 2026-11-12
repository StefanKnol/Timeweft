import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MIGRATIONS, openStore, openStoreForTests, testDatabaseUrl } from './index.ts';

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
