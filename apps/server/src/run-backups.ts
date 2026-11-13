/**
 * Backups of runs, as files in a folder: the one file a backup is, written whole or not at all,
 * and the rules for which backups a folder keeps.
 *
 * A backup file is the bare export document, written as JSON with two spaces of indentation, in
 * UTF-8, under the name `backupFileName` gives it: the run's slug, two hyphens, the moment it was
 * taken in UTC, and `.timeweft-run.json`. That name sorts oldest first, which is how the newest is
 * found and how the oldest are let go.
 *
 * The rules (which files are a run's, which to let go, whether a run changed since its newest
 * backup) are pure and tested on their own. The functions that touch the folder are thin.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RUN_EXPORT_FILE_ENDING, backupFileName, runExportDocumentAsText, type RunExportDocument, type Store,
} from '@timeweft/contract';

/**
 * A backup holds the author's canon, author-only material included, so a file is readable and
 * writable by the user the server runs as and nobody else, and a folder the server makes is open
 * to that user only. A folder made beforehand keeps the mode it was made with.
 */
export const BACKUP_FILE_MODE = 0o600;
export const BACKUP_FOLDER_MODE = 0o700;

/** The moment in a backup's name, as `backupFileName` writes it: `20261113T093000Z`. */
const MOMENT_IN_A_NAME = /^\d{8}T\d{6}Z$/;

/** A backup file's name read back into the run it is of and the moment it was taken. */
export interface BackupFileNameRead {
  fileName: string;
  runSlug: string;
  takenAt: string;
}

/**
 * Reads a file name as a backup's, or answers null where it is not one. The slug is everything
 * before the last two hyphens. A slug never holds two hyphens together (every door that writes one,
 * a restore included, holds it to `RUN_SLUG_PATTERN`), so the split is never in doubt.
 */
export function readBackupFileName(fileName: string): BackupFileNameRead | null {
  if (!fileName.endsWith(RUN_EXPORT_FILE_ENDING)) return null;
  const withoutEnding = fileName.slice(0, -RUN_EXPORT_FILE_ENDING.length);
  const separator = withoutEnding.lastIndexOf('--');
  if (separator <= 0) return null;
  const takenAt = withoutEnding.slice(separator + 2);
  if (!MOMENT_IN_A_NAME.test(takenAt)) return null;
  return { fileName, runSlug: withoutEnding.slice(0, separator), takenAt };
}

/** The backups of one run among a folder's file names, oldest first. Anything else is left out. */
export function backupsOfRun(fileNames: readonly string[], runSlug: string): string[] {
  return fileNames
    .map(readBackupFileName)
    .filter((read): read is BackupFileNameRead => read !== null && read.runSlug === runSlug)
    .sort((first, second) => first.takenAt.localeCompare(second.takenAt))
    .map((read) => read.fileName);
}

/** The newest backup of one run among a folder's file names, or null where it has none. */
export function newestBackupOfRun(fileNames: readonly string[], runSlug: string): string | null {
  const backups = backupsOfRun(fileNames, runSlug);
  return backups.at(-1) ?? null;
}

/** The backups of one run to let go so that only the newest `backupsToKeep` stay. */
export function backupsToLetGo(fileNames: readonly string[], runSlug: string, backupsToKeep: number): string[] {
  const backups = backupsOfRun(fileNames, runSlug);
  return backups.slice(0, Math.max(0, backups.length - backupsToKeep));
}

/**
 * A fingerprint of what a run holds. Two exports of an unchanged run differ only in when they were
 * taken, and the tables come out in a fixed order, so the same run gives the same fingerprint.
 * Write marks cannot be used for this, since some rows (collisions, thread touches) carry none.
 */
export function fingerprintOfRun(document: Pick<RunExportDocument, 'tables'>): string {
  return createHash('sha256').update(JSON.stringify(document.tables)).digest('hex');
}

/**
 * Whether a run needs a new backup: where it has none, where its newest could not be read, or where
 * what it holds has changed since.
 */
export function runNeedsABackup(newestBackupFingerprint: string | null, currentFingerprint: string): boolean {
  return newestBackupFingerprint === null || newestBackupFingerprint !== currentFingerprint;
}

/** The text a backup file holds: the contract's one way of writing a document out. */
export const backupFileText = runExportDocumentAsText;

/**
 * Writes a file whole or not at all: under a temporary name first, then renamed, so a reader never
 * finds half a backup under a backup's name, and a failure part way leaves nothing that looks like
 * one.
 */
export async function writeFileWhole(path: string, text: string): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  try {
    await writeFile(temporaryPath, text, { encoding: 'utf8', mode: BACKUP_FILE_MODE });
    // The mode given above applies only to a file the write creates; a temporary file left behind
    // by an earlier failure would keep its own, so it is set again before the rename.
    await chmod(temporaryPath, BACKUP_FILE_MODE);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/** Writes one backup into the folder, whole or not at all, and answers with its file name. */
export async function writeBackupFile(folder: string, document: RunExportDocument, takenAt: Date): Promise<string> {
  await mkdir(folder, { recursive: true, mode: BACKUP_FOLDER_MODE });
  const fileName = backupFileName(document.runSlug, takenAt);
  await writeFileWhole(join(folder, fileName), backupFileText(document));
  return fileName;
}

/** The fingerprint of a backup file, or null where it cannot be read as one. */
async function fingerprintOfFile(path: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { tables?: unknown };
    if (typeof parsed !== 'object' || parsed === null || parsed.tables === undefined) return null;
    return fingerprintOfRun(parsed as Pick<RunExportDocument, 'tables'>);
  } catch {
    return null;
  }
}

export interface BackupRoundSettings {
  folder: string;
  backupsToKeep: number;
}

/** What one round of backups did, by slug. Slugs and counts only, never content. */
export interface BackupRoundReport {
  written: string[];
  unchanged: string[];
  failed: Array<{ runSlug: string; reason: string }>;
  filesLetGo: number;
}

/**
 * A failure said without its message, which might quote a run. Only its kind is told, and a file
 * system error's code, such as EACCES where the folder cannot be written to.
 */
export function failureInWords(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? `${error.name}, ${code}` : error.name;
}

/**
 * Backs up every run the store holds into the folder: a run unchanged since its newest backup is
 * not written again, and each run keeps its newest `backupsToKeep` files. One run failing does not
 * stop the others; the failure is in the report.
 */
export async function backUpEveryRun(store: Store, settings: BackupRoundSettings, takenAt: Date): Promise<BackupRoundReport> {
  const report: BackupRoundReport = { written: [], unchanged: [], failed: [], filesLetGo: 0 };
  await mkdir(settings.folder, { recursive: true, mode: BACKUP_FOLDER_MODE });
  const listings = await store.listRuns();
  for (const listing of listings) {
    const runSlug = listing.run.slug;
    try {
      const document = await store.exportRun(runSlug);
      const fileNamesBefore = await readdir(settings.folder);
      const newest = newestBackupOfRun(fileNamesBefore, runSlug);
      const newestFingerprint = newest === null ? null : await fingerprintOfFile(join(settings.folder, newest));
      if (runNeedsABackup(newestFingerprint, fingerprintOfRun(document))) {
        await writeBackupFile(settings.folder, document, takenAt);
        report.written.push(runSlug);
      } else {
        report.unchanged.push(runSlug);
      }
      const fileNamesAfter = await readdir(settings.folder);
      for (const fileName of backupsToLetGo(fileNamesAfter, runSlug, settings.backupsToKeep)) {
        await rm(join(settings.folder, fileName), { force: true });
        report.filesLetGo += 1;
      }
    } catch (error) {
      report.failed.push({ runSlug, reason: failureInWords(error) });
    }
  }
  return report;
}

/** A round of backups said in one line, for the server's log. */
export function backupRoundInWords(report: BackupRoundReport): string {
  const parts = [
    `${report.written.length} written`,
    `${report.unchanged.length} unchanged since their last backup`,
    `${report.filesLetGo} older ${report.filesLetGo === 1 ? 'file' : 'files'} let go`,
  ];
  const failed = report.failed.length === 0
    ? ''
    : ` ${report.failed.length} failed: ${report.failed.map((failure) => `${failure.runSlug} (${failure.reason})`).join(', ')}.`;
  return `Backups of every run: ${parts.join(', ')}.${failed}`;
}
