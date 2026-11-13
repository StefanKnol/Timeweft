/**
 * The server's automatic backups. Where TIMEWEFT_BACKUP_FOLDER is set, the server writes a backup
 * of every run there a little while after it starts and then every TIMEWEFT_BACKUP_EVERY_HOURS
 * hours (24 unless set), keeping the newest TIMEWEFT_BACKUPS_TO_KEEP files of each run (14 unless
 * set). A run unchanged since its newest backup is not written again.
 *
 * A round that fails is logged and the server carries on: a backup must never be the thing that
 * stops the author working. The rules live in run-backups.ts; this is only the timer.
 */
import type { Store } from '@timeweft/contract';
import { backUpEveryRun, backupRoundInWords, failureInWords, type BackupRoundSettings } from './run-backups.ts';

export const DEFAULT_BACKUP_EVERY_HOURS = 24;
export const DEFAULT_BACKUPS_TO_KEEP = 14;

/**
 * The longest wait between rounds: 24 days. A Node timer cannot wait longer than about 24.8 days,
 * and asked to, it fires at once, over and over.
 */
export const LONGEST_BACKUP_EVERY_HOURS = 24 * 24;

/** How long after the server starts the first round runs, so it does not slow the start itself. */
export const FIRST_BACKUP_AFTER_MILLISECONDS = 60 * 1000;

export interface ScheduledBackupSettings extends BackupRoundSettings {
  everyHours: number;
}

/**
 * The backup settings, or null where no folder is named and the server backs nothing up. A
 * setting that is set and cannot be read stops the server from starting, with a sentence saying
 * which, as a bad PORT does: a backup the author believes is running and is not is the worst case.
 */
export function scheduledBackupSettingsFromEnvironment(environment: NodeJS.ProcessEnv): ScheduledBackupSettings | null {
  const folder = environment['TIMEWEFT_BACKUP_FOLDER']?.trim() ?? '';
  if (folder === '') return null;
  const everyHoursText = environment['TIMEWEFT_BACKUP_EVERY_HOURS']?.trim() ?? '';
  const everyHours = everyHoursText === '' ? DEFAULT_BACKUP_EVERY_HOURS : Number(everyHoursText);
  if (!Number.isFinite(everyHours) || everyHours <= 0 || everyHours > LONGEST_BACKUP_EVERY_HOURS) {
    throw new Error(`TIMEWEFT_BACKUP_EVERY_HOURS must be a number of hours above 0 and at most ${LONGEST_BACKUP_EVERY_HOURS} (24 days); "${everyHoursText}" is not.`);
  }
  const keepText = environment['TIMEWEFT_BACKUPS_TO_KEEP']?.trim() ?? '';
  const backupsToKeep = keepText === '' ? DEFAULT_BACKUPS_TO_KEEP : Number(keepText);
  if (!Number.isInteger(backupsToKeep) || backupsToKeep < 1) {
    throw new Error(`TIMEWEFT_BACKUPS_TO_KEEP must be a whole number of 1 or more; "${keepText}" is not.`);
  }
  return { folder, everyHours, backupsToKeep };
}

export interface ScheduledBackups {
  /** Runs one round now, unless one is already running. Never throws. */
  runOnce(): Promise<void>;
  stop(): void;
}

/** What the timer writes to. The server passes the console; a test passes a list. */
export interface BackupLog {
  info(line: string): void;
  error(line: string): void;
}

/**
 * Starts the timer. Neither timer keeps the process alive, so stopping the server is never held up
 * by a backup waiting to run. A round never overlaps another.
 */
export function startScheduledBackups(
  store: Store, settings: ScheduledBackupSettings, log: BackupLog, options: { firstAfterMilliseconds?: number; now?: () => Date } = {},
): ScheduledBackups {
  const now = options.now ?? (() => new Date());
  let roundRunning = false;
  const runOnce = async (): Promise<void> => {
    if (roundRunning) return;
    roundRunning = true;
    try {
      const report = await backUpEveryRun(store, settings, now());
      const line = backupRoundInWords(report);
      if (report.failed.length === 0) log.info(line);
      else log.error(line);
    } catch (error) {
      log.error(`The backups of every run failed (${failureInWords(error)}); the server carries on and tries again next time.`);
    } finally {
      roundRunning = false;
    }
  };
  const firstTimer = setTimeout(() => { void runOnce(); }, options.firstAfterMilliseconds ?? FIRST_BACKUP_AFTER_MILLISECONDS);
  firstTimer.unref();
  const repeatingTimer = setInterval(() => { void runOnce(); }, settings.everyHours * 60 * 60 * 1000);
  repeatingTimer.unref();
  return {
    runOnce,
    stop() {
      clearTimeout(firstTimer);
      clearInterval(repeatingTimer);
    },
  };
}
