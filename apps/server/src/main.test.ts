/**
 * The real process: it refuses to start without its settings, starts with them, serves, and
 * stops cleanly on SIGTERM.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_SERVER_TEST_DATABASE_URL, TEST_TOKEN } from './server-for-tests.ts';

const runCommand = promisify(execFile);
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const DATABASE_URL = process.env['TIMEWEFT_TEST_DATABASE_URL'] ?? DEFAULT_SERVER_TEST_DATABASE_URL;

let schema: string;
let dispose: () => Promise<void>;
before(async () => {
  const { openStoreForTests } = await import('@timeweft/store');
  ({ schema, dispose } = await openStoreForTests());
});
after(async () => {
  await dispose();
});

function environmentWithout(...names: string[]): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of names) delete environment[name];
  return environment;
}

async function failureOf(environment: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
  return runCommand(process.execPath, ['--experimental-strip-types', '--no-warnings', MAIN], { env: environment })
    .then(() => assert.fail('the server started when it should have refused'), (error: { code: number; stderr: string }) => error);
}

test('it refuses to start without a database or without a token', async () => {
  const withoutDatabase = await failureOf({ ...environmentWithout('TIMEWEFT_DATABASE_URL'), TIMEWEFT_ACCESS_TOKEN: TEST_TOKEN });
  assert.equal(withoutDatabase.code, 1);
  assert.match(withoutDatabase.stderr, /The database is not named: TIMEWEFT_DATABASE_HOST, TIMEWEFT_DATABASE_USER, TIMEWEFT_DATABASE_PASSWORD are not set/);
  const namedTwice = await failureOf({ ...process.env, TIMEWEFT_DATABASE_URL: DATABASE_URL, TIMEWEFT_DATABASE_HOST: '127.0.0.1', TIMEWEFT_ACCESS_TOKEN: TEST_TOKEN });
  assert.equal(namedTwice.code, 1);
  assert.match(namedTwice.stderr, /two answers to where the database is/);
  const withoutToken = await failureOf({ ...environmentWithout('TIMEWEFT_ACCESS_TOKEN', 'TIMEWEFT_ALLOW_NO_TOKEN'), TIMEWEFT_DATABASE_URL: DATABASE_URL });
  assert.equal(withoutToken.code, 1);
  assert.match(withoutToken.stderr, /TIMEWEFT_ACCESS_TOKEN is not set/);
});

test('it starts, serves, and stops cleanly on SIGTERM', async () => {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', MAIN], {
    env: { ...process.env, TIMEWEFT_DATABASE_URL: DATABASE_URL, TIMEWEFT_DATABASE_SCHEMA: schema, TIMEWEFT_ACCESS_TOKEN: TEST_TOKEN, PORT: '0' },
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const port = await new Promise<number>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const match = /listening on port (\d+)/.exec(output);
      if (match) resolve(Number(match[1]));
    });
    child.on('exit', () => reject(new Error('the server stopped before it listened')));
  });
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  const runs = await fetch(`http://127.0.0.1:${port}/api/operations/list_runs`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` }, body: '{}',
  });
  assert.deepEqual(await runs.json(), { ok: true, answer: [] });
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
});
