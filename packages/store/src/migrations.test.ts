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
