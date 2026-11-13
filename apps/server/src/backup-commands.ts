/**
 * The three backup commands, run from apps/server or the container:
 *
 *   pnpm export-run <slug> <file>        one run, written to the file named
 *   pnpm export-all <folder>             every run, each to a file named by its slug and the time
 *   pnpm restore-run <file> [--replace]  a run put back from a backup file
 *
 * They print slugs and counts only. A backup holds the author's canon, and a console is where text
 * ends up in logs, so not one line of what a run holds is printed. A path given relative is read
 * against the folder the command was run from, and the path used is said in full.
 *
 * Each command is a function that takes the store and answers with the lines to print, so the
 * tests run them against a store of their own; `main` only reads the settings and opens the store.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Refusal, readRunExportDocument, type RunExportDocument, type Store } from '@timeweft/contract';
import { openStore } from '@timeweft/store';
import { DatabaseAddressNotSet, databaseAddressFromEnvironment } from './database-address.ts';
import { restoredRunInWords, rowCountsInWords, rowCountsOf } from './in-words.ts';
import { backupFileText, writeBackupFile, writeFileWhole } from './run-backups.ts';

export const BACKUP_COMMAND_NAMES = ['export-run', 'export-all', 'restore-run'] as const;
export type BackupCommandName = (typeof BACKUP_COMMAND_NAMES)[number];

/**
 * pnpm passes a lone `--` through to a script, and the arguments it separates are the command's
 * own, so it is dropped wherever it stands.
 */
function withoutSeparator(argumentsGiven: string[]): string[] {
  return argumentsGiven.filter((argument) => argument !== '--');
}

/** Writes one run's backup to the file named. */
export async function exportOneRun(store: Store, argumentsGiven: string[], workingFolder: string): Promise<string[]> {
  const { positionals } = parseArgs({ args: withoutSeparator(argumentsGiven), allowPositionals: true, strict: true, options: {} });
  const [runSlug, file] = positionals;
  if (runSlug === undefined || file === undefined || positionals.length > 2) {
    throw new Refusal('Name the run and the file to write: export-run <slug> <file>.');
  }
  const document = await store.exportRun(runSlug);
  const path = resolve(workingFolder, file);
  await writeFileWhole(path, backupFileText(document));
  return [`Wrote a backup of the run ${document.runSlug} to ${path}. It holds:`, ...rowCountsInWords(rowCountsOf(document), '- ')];
}

/** Writes a backup of every run into the folder named, each under its own file name. */
export async function exportEveryRun(store: Store, argumentsGiven: string[], workingFolder: string, takenAt: Date): Promise<string[]> {
  const { positionals } = parseArgs({ args: withoutSeparator(argumentsGiven), allowPositionals: true, strict: true, options: {} });
  const [folderGiven] = positionals;
  if (folderGiven === undefined || positionals.length > 1) throw new Refusal('Name the folder to write into: export-all <folder>.');
  const folder = resolve(workingFolder, folderGiven);
  const listings = await store.listRuns();
  const lines: string[] = [];
  for (const listing of listings) {
    const document = await store.exportRun(listing.run.slug);
    const fileName = await writeBackupFile(folder, document, takenAt);
    lines.push(`- ${document.runSlug}: ${fileName}`);
  }
  if (listings.length === 0) return ['The store holds no runs, so nothing was written.'];
  return [`Wrote a backup of each of ${listings.length} ${listings.length === 1 ? 'run' : 'runs'} into ${folder}:`, ...lines];
}

/** The backup file read as a document, refused with a plain sentence where it is not one. */
export async function readBackupFile(path: string): Promise<RunExportDocument> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Refusal(`There is no file at ${path}.`);
    if (code === 'EACCES' || code === 'EPERM') throw new Refusal(`${path} cannot be read by the user the command runs as.`);
    if (code === 'EISDIR') throw new Refusal(`${path} is a folder; name a backup file.`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Refusal(`${path} is not readable JSON, so it is not a backup of a run.`);
  }
  return readRunExportDocument(parsed);
}

/** Puts a run back from a backup file, replacing the run already there only when asked. */
export async function restoreOneRun(store: Store, argumentsGiven: string[], workingFolder: string): Promise<string[]> {
  const { positionals, values } = parseArgs({
    args: withoutSeparator(argumentsGiven), allowPositionals: true, strict: true, options: { replace: { type: 'boolean' } },
  });
  const [file] = positionals;
  if (file === undefined || positionals.length > 1) throw new Refusal('Name the backup file: restore-run <file> [--replace].');
  const document = await readBackupFile(resolve(workingFolder, file));
  const report = await store.restoreRun(document, { replace: values.replace === true });
  return restoredRunInWords(report).split('\n');
}

/**
 * A refusal made fit for a console. The store's refusal of a value of the wrong kind quotes up to
 * sixty characters of it, which may be a line of the author's canon; here it is said as "a value".
 * Every other refusal names tables, columns and slugs only, and is said as it is.
 */
export function refusalForTheConsole(sentence: string): string {
  return sentence.replace(/(row \d+ of \w+ holds ).*?( in "\w+", which must be )/s, '$1a value$2');
}

async function openStoreFromEnvironment(): Promise<Store> {
  let databaseUrl: string;
  try {
    databaseUrl = databaseAddressFromEnvironment(process.env);
  } catch (error) {
    // The sentence names settings and never their values, so it is safe to say on the console.
    if (error instanceof DatabaseAddressNotSet) throw new Refusal(error.message);
    throw error;
  }
  const schema = process.env['TIMEWEFT_DATABASE_SCHEMA']?.trim();
  return openStore(databaseUrl, schema === undefined || schema === '' ? {} : { schema });
}

/** Runs one command against the store the environment names, and answers with the lines to print. */
export async function runBackupCommand(name: BackupCommandName, argumentsGiven: string[]): Promise<string[]> {
  const store = await openStoreFromEnvironment();
  try {
    await store.migrate();
    const workingFolder = process.env['INIT_CWD'] ?? process.cwd();
    switch (name) {
      case 'export-run': return await exportOneRun(store, argumentsGiven, workingFolder);
      case 'export-all': return await exportEveryRun(store, argumentsGiven, workingFolder, new Date());
      case 'restore-run': return await restoreOneRun(store, argumentsGiven, workingFolder);
    }
  } finally {
    await store.close();
  }
}

function isBackupCommandName(text: string | undefined): text is BackupCommandName {
  return (BACKUP_COMMAND_NAMES as readonly string[]).includes(text ?? '');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, ...rest] = process.argv.slice(2);
  const running = isBackupCommandName(name)
    ? runBackupCommand(name, rest)
    : Promise.reject(new Refusal(`Name one of ${BACKUP_COMMAND_NAMES.join(', ')}.`));
  running.then((lines) => {
    for (const line of lines) console.log(line);
  }, (error: unknown) => {
    // A refusal is the store or this command saying something the author can act on. Anything
    // else might carry a line of a run in its message, so only its kind is printed.
    if (error instanceof Refusal) console.error(refusalForTheConsole(error.message));
    else console.error(`The command failed (${error instanceof Error ? error.name : 'unknown error'}).`);
    process.exit(1);
  });
}
