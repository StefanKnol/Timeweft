import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BUILD_STAMP_VARIABLES, buildStampFromEnvironment } from './build-stamp.ts';

const fileAtTheRoot = (name: string): string => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');

test('a whole stamp is read as it was given', () => {
  assert.deepEqual(
    buildStampFromEnvironment({ TIMEWEFT_BUILD_NUMBER: '42', TIMEWEFT_BUILD_COMMIT: 'abc1234', TIMEWEFT_BUILT_AT: '2030-01-02T03:04:05Z' }),
    { number: 42, commit: 'abc1234', builtAt: '2030-01-02T03:04:05Z' },
  );
});

test('a part that is missing or malformed is null rather than guessed', () => {
  assert.deepEqual(buildStampFromEnvironment({}), { number: null, commit: null, builtAt: null });
  assert.deepEqual(
    buildStampFromEnvironment({ TIMEWEFT_BUILD_NUMBER: 'a placeholder nobody filled in', TIMEWEFT_BUILD_COMMIT: 'not a commit', TIMEWEFT_BUILT_AT: 'yesterday' }),
    { number: null, commit: null, builtAt: null },
  );
  assert.equal(buildStampFromEnvironment({ TIMEWEFT_BUILD_NUMBER: '0' }).number, null);
});

test('the Dockerfile and the workflow hand over every part of the stamp by its name', () => {
  const dockerfile = fileAtTheRoot('Dockerfile');
  const workflow = fileAtTheRoot('.github/workflows/docker.yml');
  for (const variable of Object.values(BUILD_STAMP_VARIABLES)) {
    assert.ok(dockerfile.includes(`ARG ${variable}=`), `the Dockerfile declares ${variable}`);
    assert.ok(dockerfile.includes(`ENV ${variable}=$${variable}`), `the Dockerfile puts ${variable} in the environment`);
    assert.ok(workflow.includes(`${variable}=`), `the workflow hands over ${variable}`);
  }
});

test('the stamp is declared after the install, so a new build does not install again', () => {
  const runtimeStage = fileAtTheRoot('Dockerfile').split('AS runtime')[1] ?? '';
  const install = runtimeStage.indexOf('pnpm install');
  const firstStampArgument = runtimeStage.indexOf(`ARG ${BUILD_STAMP_VARIABLES.number}`);
  assert.ok(install > 0 && firstStampArgument > install, 'the build arguments come after the install');
});

test('the workflow counts commits on a whole checkout, never a shallow one', () => {
  assert.ok(fileAtTheRoot('.github/workflows/docker.yml').includes('fetch-depth: 0'));
});
