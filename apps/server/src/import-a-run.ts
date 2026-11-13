/**
 * The one import of a run kept by hand: the five files read by the weaver-files reader and
 * written through the store. The command and the import_run operation both come through here, so
 * a run imported from the pages and one imported from a shell cannot be read two ways.
 *
 * It never prints anything. What the caller says about the answer is the caller's: the pages show
 * the author their own text, and the command keeps every line of it off the console.
 */
import { Refusal, type ImportedRunReport, type RunSnapshot, type RunStatus, type Store, type WeaverFiles } from '@timeweft/contract';
import { readWeaverFiles, type ReadWeaverFilesOptions } from '@timeweft/weaver-files';

export interface ImportOptions {
  slug: string;
  title?: string;
  setting?: string;
  status?: RunStatus;
}

/** The names of the five files, as the refusal for an empty import says them. */
export const RUN_FILE_NAMES = { log: 'log.md', state: 'state.md', cast: 'cast.md', items: 'items.md', places: 'places.md' } as const;

/**
 * The refusal for five empty files. It quotes nothing from them, so unlike a refusal from the
 * store it may be said anywhere, the console included, and the command tells the two apart by it.
 */
export class NothingToImport extends Refusal {}

/**
 * Five empty files would write a run holding nothing under the name asked for, which is a wrong
 * pick of files rather than a run. A file of only blank lines is as empty as one of nothing.
 */
export function refusalForFilesThatHoldNothing(files: WeaverFiles): NothingToImport | null {
  const names = Object.keys(RUN_FILE_NAMES) as Array<keyof typeof RUN_FILE_NAMES>;
  if (names.some((name) => (files[name] ?? '').trim() !== '')) return null;
  return new NothingToImport(`All five files are empty, so there is no run to import. Give at least one of ${Object.values(RUN_FILE_NAMES).join(', ')}.`);
}

/** What an import wrote, counted off the store's own snapshot rather than off what was read. */
export function importedRunReportOf(snapshot: RunSnapshot, unplaced: string[]): ImportedRunReport {
  return {
    run: snapshot.run,
    counts: {
      scenes: snapshot.scenes.filter((scene) => scene.status === 'standing').length,
      entries: snapshot.entries.length,
      facts: snapshot.facts.length,
      trailNotes: snapshot.notes.length,
      rulings: snapshot.rulings.length,
      threads: snapshot.threads.length,
      waypoints: snapshot.waypoints.length,
      journeyLegs: snapshot.legs.length,
      clocks: snapshot.clocks.length,
    },
    unplaced: [...unplaced],
  };
}

/**
 * Reads the files and writes the run. A refusal from the store is thrown as it is: it lists what
 * the store could not resolve, which quotes the files, so where it may be said is the caller's to
 * decide.
 */
export async function importWeaverFiles(store: Store, files: WeaverFiles, options: ImportOptions): Promise<ImportedRunReport> {
  const empty = refusalForFilesThatHoldNothing(files);
  if (empty !== null) throw empty;
  const readerOptions: ReadWeaverFilesOptions = { slug: options.slug };
  if (options.title !== undefined) readerOptions.title = options.title;
  if (options.setting !== undefined) readerOptions.setting = options.setting;
  if (options.status !== undefined) readerOptions.status = options.status;
  const run = readWeaverFiles(files, readerOptions);
  const snapshot = await store.importRun(run);
  return importedRunReportOf(snapshot, run.unplaced);
}
