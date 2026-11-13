/**
 * The store on PostgreSQL. `openStore` connects and does not migrate: an installation migrates
 * once, on purpose, by calling `migrate()`. `openStoreForTests` gives each test file a schema of
 * its own in one shared database, so test files can run side by side and CI needs one database.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Store } from '@timeweft/contract';
import { connectToDatabase } from './database.ts';
import { PostgresStore } from './store.ts';

export { PostgresStore } from './store.ts';
export { MIGRATIONS } from './migrations.ts';

export async function openStore(databaseUrl: string, options: { schema?: string } = {}): Promise<Store> {
  return new PostgresStore(connectToDatabase(databaseUrl, options.schema));
}

export const DEFAULT_TEST_DATABASE_URL = 'postgres://timeweft:timeweft@127.0.0.1:5432/timeweft_test_store';

export function testDatabaseUrl(): string {
  return process.env['TIMEWEFT_TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;
}

export async function openStoreForTests(): Promise<{ store: Store; schema: string; dispose(): Promise<void> }> {
  const databaseUrl = testDatabaseUrl();
  const schema = `test_${randomBytes(8).toString('hex')}`;
  const administrator = new pg.Client({ connectionString: databaseUrl });
  await administrator.connect();
  try {
    await administrator.query(`create schema ${schema}`);
  } finally {
    await administrator.end();
  }
  const store = await openStore(databaseUrl, { schema });
  await store.migrate();
  return {
    store,
    schema,
    async dispose() {
      await store.close();
      const cleaner = new pg.Client({ connectionString: databaseUrl });
      await cleaner.connect();
      try {
        await cleaner.query(`drop schema ${schema} cascade`);
      } finally {
        await cleaner.end();
      }
    },
  };
}
