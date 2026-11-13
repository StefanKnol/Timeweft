import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DATABASE_VARIABLES, DatabaseAddressNotSet, databaseAddressFromEnvironment } from './database-address.ts';

const parts = { TIMEWEFT_DATABASE_HOST: '10.0.0.5', TIMEWEFT_DATABASE_USER: 'weaver', TIMEWEFT_DATABASE_PASSWORD: 'plain' };

test('the parts make one address, with the port and the name defaulted', () => {
  assert.equal(databaseAddressFromEnvironment(parts), 'postgres://weaver:plain@10.0.0.5:5432/timeweft');
  assert.equal(
    databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_PORT: '5433', TIMEWEFT_DATABASE_NAME: 'stories' }),
    'postgres://weaver:plain@10.0.0.5:5433/stories',
  );
});

test('a password is typed as it is, and survives inside the address whatever it holds', () => {
  const password = 'p@ss:w/rd#1 %?&=';
  const address = databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_PASSWORD: password, TIMEWEFT_DATABASE_USER: 'we@ver' });
  const read = new URL(address);
  assert.equal(decodeURIComponent(read.password), password);
  assert.equal(decodeURIComponent(read.username), 'we@ver');
  assert.equal(read.hostname, '10.0.0.5');
  assert.equal(read.port, '5432');
});

test('a password keeps a space at either end', () => {
  const read = new URL(databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_PASSWORD: ' spaced ' }));
  assert.equal(decodeURIComponent(read.password), ' spaced ');
});

test('an IPv6 host is put in brackets', () => {
  assert.equal(new URL(databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_HOST: 'fd00::5' })).hostname, '[fd00::5]');
});

test('a missing part is refused by its name, every missing one at once', () => {
  assert.throws(() => databaseAddressFromEnvironment({}), (error: unknown) =>
    error instanceof DatabaseAddressNotSet
    && /TIMEWEFT_DATABASE_HOST, TIMEWEFT_DATABASE_USER, TIMEWEFT_DATABASE_PASSWORD are not set/.test(error.message));
  assert.throws(() => databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_PASSWORD: '' }), /TIMEWEFT_DATABASE_PASSWORD is not set/);
});

test('a host that is more than a host, or a port that is not one, is refused in words', () => {
  for (const host of ['postgres://10.0.0.5', '10.0.0.5/timeweft', 'user@10.0.0.5', '10.0.0.5 ']) {
    if (host.trim() === '10.0.0.5') continue;
    assert.throws(() => databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_HOST: host }), DatabaseAddressNotSet, host);
  }
  for (const port of ['0', '70000', 'five', '54.32', '-1']) {
    assert.throws(() => databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_PORT: port }), /must be a whole number from 1 to 65535/, port);
  }
});

test('a whole address is still taken, and never mixed with the parts', () => {
  assert.equal(databaseAddressFromEnvironment({ TIMEWEFT_DATABASE_URL: ' postgres://a:b@c:5432/d ' }), 'postgres://a:b@c:5432/d');
  assert.throws(() => databaseAddressFromEnvironment({ ...parts, TIMEWEFT_DATABASE_URL: 'postgres://a:b@c:5432/d' }), /two answers to where the database is/);
});

test('the README and the example compose file name every part by its variable', () => {
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../../../compose.example.yml', import.meta.url), 'utf8');
  for (const variable of [DATABASE_VARIABLES.host, DATABASE_VARIABLES.port, DATABASE_VARIABLES.name, DATABASE_VARIABLES.user, DATABASE_VARIABLES.password]) {
    assert.ok(readme.includes(variable), `the README names ${variable}`);
  }
  for (const variable of [DATABASE_VARIABLES.host, DATABASE_VARIABLES.user, DATABASE_VARIABLES.password]) {
    assert.ok(compose.includes(variable), `the example compose file sets ${variable}`);
  }
});
