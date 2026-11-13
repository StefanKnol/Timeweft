// The private line, checked: this repository holds no canon. No name, no word of any made
// tongue, no lore, in code, tests, comments or documents.
//
// The list of what counts as canon is itself canon, so it is never in this repository. It is a
// plain text file, one word or phrase per line, kept on the author's own machine or private
// runner and named by TIMEWEFT_FORBIDDEN_WORDS_FILE. Where that variable is not set the check
// says so and passes, because a public runner must not be handed the list.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const listPath = process.env.TIMEWEFT_FORBIDDEN_WORDS_FILE;
if (!listPath) {
  console.log('check-no-canon: TIMEWEFT_FORBIDDEN_WORDS_FILE is not set, so nothing was checked.');
  process.exit(0);
}
const words = readFileSync(listPath, 'utf8')
  .split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
const root = process.cwd();
const skipped = new Set(['node_modules', '.git', 'dist', 'private', 'pnpm-lock.yaml']);
function* filesUnder(directory) {
  for (const name of readdirSync(directory)) {
    if (skipped.has(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* filesUnder(path);
    else yield path;
  }
}
const escapeForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = words.map((word) => ({
  word,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(word)}(?![\\p{L}\\p{N}])`, 'u'),
}));
let found = 0;
for (const path of filesUnder(root)) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const { word, pattern } of patterns) {
      if (pattern.test(line)) {
        found += 1;
        console.error(`${relative(root, path)}:${index + 1}: holds "${word}"`);
      }
    }
  });
}
if (found > 0) {
  console.error(`check-no-canon: ${found} place(s) hold canon. This repository holds none.`);
  process.exit(1);
}
console.log(`check-no-canon: ${words.length} words checked, none found.`);
