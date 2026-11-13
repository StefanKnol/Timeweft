/**
 * Imports a run a story kept by hand in five Markdown files.
 *
 *   pnpm --filter @timeweft/server import-run -- --folder <dir> --slug <slug>
 *     [--title ..] [--setting ..] [--status binding|telling] [--unplaced-report <file>]
 *     [--replace-earlier-import]
 *
 * With --replace-earlier-import, a run of that slug an earlier import made is removed and the
 * files are imported in its place, in one transaction. The store refuses it where the run holds
 * anything written after its import, or where another run continues from it.
 *
 * It prints counts only. The files are the author's canon, and a console is where text ends up in
 * logs, so not one line of them is printed. What the reader could not place is written to the
 * report file when one is named, and only its length is said otherwise.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EarlierImportStandsInTheWay, RUN_STATUSES, Refusal, RunAlreadyExists, type ImportedRunReport, type RunStatus, type Store, type WeaverFiles } from '@timeweft/contract';
import { openStore } from '@timeweft/store';
import { DatabaseAddressNotSet, databaseAddressFromEnvironment } from './database-address.ts';
import { NothingToImport, RUN_FILE_NAMES, importWeaverFiles, type ImportOptions } from './import-a-run.ts';

export interface ImportRequest {
  folder: string;
  slug: string;
  title?: string;
  setting?: string;
  status?: RunStatus;
  unplacedReport?: string;
  replaceEarlierImport?: boolean;
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
      'replace-earlier-import': { type: 'boolean' },
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
  if (values['replace-earlier-import'] === true) request.replaceEarlierImport = true;
  return request;
}

/**
 * One file's text, or an empty string where the run did not keep that file.
 *
 * A file that is there and cannot be read is a refusal that names the file and why. Inside a
 * container the import runs as an unprivileged user, so a file only its owner may read is the
 * usual cause, and "the import failed" would leave the author guessing.
 */
async function readIfThere(folder: string, fileName: string): Promise<string | null> {
  try {
    return await readFile(join(folder, fileName), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Refusal(`${fileName} is in the folder and cannot be read by the user the import runs as. Make the file readable by everyone, then import again.`);
    }
    if (code === 'ENOTDIR') throw new Refusal(`${folder} is not a folder.`);
    if (code === 'EISDIR') throw new Refusal(`${fileName} is a folder where a file was expected.`);
    throw error;
  }
}

/**
 * The five files of a run. A file the run did not keep is an empty string, but a folder holding
 * none of the five is refused: that is a wrong path or a folder that was never mounted, and
 * importing it would write an empty run under the name asked for.
 */
export async function readFolder(folder: string): Promise<WeaverFiles> {
  const names = Object.keys(RUN_FILE_NAMES) as Array<keyof typeof RUN_FILE_NAMES>;
  const texts = await Promise.all(names.map((name) => readIfThere(folder, RUN_FILE_NAMES[name])));
  if (texts.every((text) => text === null)) {
    throw new Refusal(`${folder} holds none of ${Object.values(RUN_FILE_NAMES).join(', ')}. Check the path; inside a container it is the path the folder is mounted at.`);
  }
  const files: WeaverFiles = { log: '', state: '', cast: '', items: '', places: '' };
  names.forEach((name, index) => { files[name] = texts[index] ?? ''; });
  return files;
}

/** What the command says: counts, never content. */
export function countsInWords(report: ImportedRunReport): string[] {
  const { counts } = report;
  return [
    `Imported run ${report.run.slug}.`,
    `Scenes: ${counts.scenes}`,
    `Entries: ${counts.entries}`,
    `Facts: ${counts.facts}`,
    `Trail notes: ${counts.trailNotes}`,
    `Rulings: ${counts.rulings}`,
    `Threads: ${counts.threads}`,
    `Waypoints: ${counts.waypoints}`,
    `Journey legs: ${counts.journeyLegs}`,
    `Clocks: ${counts.clocks}`,
    `Unplaced lines: ${report.unplaced.length}`,
    ...removedInWords(report),
  ];
}

/** The counts of the earlier import a replacing import removed, or nothing where none was replaced. */
function removedInWords(report: ImportedRunReport): string[] {
  const removed = report.removedEarlierImport ?? null;
  if (removed === null) return [];
  return [
    'It replaced the earlier import, which was removed. It held:',
    `  Scenes: ${removed.scenes}`,
    `  Entries: ${removed.entries}`,
    `  Facts: ${removed.facts}`,
    `  Trail notes: ${removed.trailNotes}`,
    `  Rulings: ${removed.rulings}`,
    `  Threads: ${removed.threads}`,
    `  Waypoints: ${removed.waypoints}`,
    `  Journey legs: ${removed.journeyLegs}`,
    `  Clocks: ${removed.clocks}`,
  ];
}

/** Reads the folder, imports through the one import, and answers with the lines to print. */
export async function importRun(store: Store, request: ImportRequest): Promise<string[]> {
  const options: ImportOptions = { slug: request.slug };
  if (request.title !== undefined) options.title = request.title;
  if (request.setting !== undefined) options.setting = request.setting;
  if (request.status !== undefined) options.status = request.status;
  if (request.replaceEarlierImport === true) options.replaceEarlierImport = true;
  const files = await readFolder(request.folder);
  let report: ImportedRunReport;
  try {
    report = await importWeaverFiles(store, files, options);
  } catch (error) {
    // Five empty files quote nothing, so that refusal is said as it is.
    if (!(error instanceof Refusal) || error instanceof NothingToImport || error instanceof EarlierImportStandsInTheWay) throw error;
    // A slug already taken names only the slug, so it is said, with the flag that replaces it.
    if (error instanceof RunAlreadyExists) {
      if (!error.madeByAnImport) throw error;
      throw new Refusal(`A run called "${request.slug}" already exists, so nothing was written. To replace its earlier import with these files, run the command again with --replace-earlier-import.`);
    }
    // The store's refusal names what it could not resolve, which quotes the files, so it goes to
    // the report and never to the console.
    if (request.unplacedReport === undefined) {
      throw new Refusal('The store refused the import. Name --unplaced-report <file> to have the reasons written there, since they quote the files.');
    }
    await writeFile(request.unplacedReport, `${error.message}\n`, 'utf8');
    throw new Refusal(`The store refused the import, and nothing was written. The reasons are in ${request.unplacedReport}.`);
  }
  const lines = countsInWords(report);
  if (request.unplacedReport !== undefined) {
    await writeFile(request.unplacedReport, report.unplaced.map((sentence) => `${sentence}\n`).join(''), 'utf8');
    lines.push(`The unplaced lines were written to ${request.unplacedReport}.`);
  }
  return lines;
}

async function main(): Promise<void> {
  const request = importRequestFromArguments(process.argv.slice(2));
  let databaseUrl: string;
  try {
    databaseUrl = databaseAddressFromEnvironment(process.env);
  } catch (error) {
    // The sentence names settings and never their values, so it is safe to say on the console.
    if (error instanceof DatabaseAddressNotSet) throw new Refusal(error.message);
    throw error;
  }
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
