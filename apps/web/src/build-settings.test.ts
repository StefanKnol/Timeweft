import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the pages are built with relative paths, so they load under a mount as well as at the root', () => {
  const settings = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(settings, /^\s*base: '\.\/',$/m);
});

test('the page shell names nothing by a path from the root of the address', () => {
  const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const rootAbsolute = [...shell.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((match) => match[1]);
  // Vite rewrites the entry script it is given; anything else from the root would not be.
  assert.deepEqual(rootAbsolute.filter((path) => path !== '/src/main.tsx'), []);
});
