/**
 * Imports a run a story kept by hand in five Markdown files.
 *
 *   pnpm --filter @timeweft/server import-run -- --folder <dir> --slug <slug>
 *     [--title ..] [--setting ..] [--status binding|telling] [--unplaced-report <file>]
 *
 * It prints counts only. The files are the author's canon, and a console is where text ends up in
 * logs, so not one line of them is printed. What the reader could not place is written to the
 * report file when one is named, and only its length is said otherwise.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { RUN_STATUSES, Refusal, type RunSnapshot, type RunStatus, type Store, type WeaverFiles } from '@timeweft/contract';
import { openStore } from '@timeweft/store';
import { readWeaverFiles, type ReadWeaverFilesOptions } from '@timeweft/weaver-files';

export interface ImportRequest {
  folder: string;
  slug: string;
  title?: string;
  setting?: string;
  status?: RunStatus;
  unplacedReport?: string;
}

export function importRequestFromArguments(argumentsGiven: string[]): ImportRequest {
  const { values } = parseArgs({
    args: argumentsGiven.filter((argument) => argument !== '--'),
    options: {
      folder: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
      setting: { type: 'string' },
      status: { type: 'string' },
      'unplaced-report': { type: 'string' },
    },
    strict: true,
  });
  if (values.folder === undefined || values.slug === undefined) {
    throw new Refusal('Name the folder and the slug: --folder <dir> --slug <slug>.');
  }
  const request: ImportRequest = { folder: values.folder, slug: values.slug };
  if (values.title !== undefined) request.title = values.title;
  if (values.setting !== undefined) request.setting = values.setting;
  if (values.status !== undefined) {
    if (!(RUN_STATUSES as readonly string[]).includes(values.status)) {
      throw new Refusal(`--status is binding or telling; "${values.status}" is neither.`);
    }
    request.status = values.status as RunStatus;
  }
  if (values['unplaced-report'] !== undefined) request.unplacedReport = values['unplaced-report'];
  return request;
}

async function readIfThere(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function readFolder(folder: string): Promise<WeaverFiles> {
  return {
    log: await readIfThere(join(folder, 'log.md')),
    state: await readIfThere(join(folder, 'state.md')),
    cast: await readIfThere(join(folder, 'cast.md')),
    items: await readIfThere(join(folder, 'items.md')),
    places: await readIfThere(join(folder, 'places.md')),
  };
}

/** What the command says: counts, never content. */
export function countsInWords(snapshot: RunSnapshot, unplacedCount: number): string[] {
  const standing = snapshot.scenes.filter((scene) => scene.status === 'standing').length;
  return [
    `Imported run ${snapshot.run.slug}.`,
    `Scenes: ${standing}`,
    `Entries: ${snapshot.entries.length}`,
    `Facts: ${snapshot.facts.length}`,
    `Trail notes: ${snapshot.notes.length}`,
    `Rulings: ${snapshot.rulings.length}`,
    `Threads: ${snapshot.threads.length}`,
    `Waypoints: ${snapshot.waypoints.length}`,
    `Journey legs: ${snapshot.legs.length}`,
    `Clocks: ${snapshot.clocks.length}`,
    `Unplaced lines: ${unplacedCount}`,
  ];
}

/** Reads the folder, imports through the store, and answers with the lines to print. */
export async function importRun(store: Store, request: ImportRequest): Promise<string[]> {
  const options: ReadWeaverFilesOptions = { slug: request.slug };
  if (request.title !== undefined) options.title = request.title;
  if (request.setting !== undefined) options.setting = request.setting;
  if (request.status !== undefined) options.status = request.status;
  const run = readWeaverFiles(await readFolder(request.folder), options);
  let snapshot: RunSnapshot;
  try {
    snapshot = await store.importRun(run);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    // The store's refusal names what it could not resolve, which quotes the files, so it goes to
    // the report and never to the console.
    if (request.unplacedReport === undefined) {
      throw new Refusal('The store refused the import. Name --unplaced-report <file> to have the reasons written there, since they quote the files.');
    }
    await writeFile(request.unplacedReport, `${error.message}\n`, 'utf8');
    throw new Refusal(`The store refused the import, and nothing was written. The reasons are in ${request.unplacedReport}.`);
  }
  const lines = countsInWords(snapshot, run.unplaced.length);
  if (request.unplacedReport !== undefined) {
    await writeFile(request.unplacedReport, run.unplaced.map((sentence) => `${sentence}\n`).join(''), 'utf8');
    lines.push(`The unplaced lines were written to ${request.unplacedReport}.`);
  }
  return lines;
}

async function main(): Promise<void> {
  const request = importRequestFromArguments(process.argv.slice(2));
  const databaseUrl = process.env['TIMEWEFT_DATABASE_URL']?.trim() ?? '';
  if (databaseUrl === '') throw new Refusal('TIMEWEFT_DATABASE_URL is not set, so there is no store to import into.');
  const schema = process.env['TIMEWEFT_DATABASE_SCHEMA']?.trim();
  const store = await openStore(databaseUrl, schema === undefined || schema === '' ? {} : { schema });
  try {
    await store.migrate();
    for (const line of await importRun(store, request)) console.log(line);
  } finally {
    await store.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // A refusal is the store or this command saying something the author can act on. Anything
    // else might carry a line of the files in its message, so only its kind is printed.
    if (error instanceof Refusal) console.error(error.message);
    else console.error(`The import failed (${error instanceof Error ? error.name : 'unknown error'}).`);
    process.exit(1);
  });
}
