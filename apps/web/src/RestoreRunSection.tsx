import { useId, useState } from 'react';
import type { RestoredRunReport } from '@timeweft/contract';
import { RUN_EXPORT_FILE_ENDING } from '@timeweft/contract';
import { useCallOperation } from './calling.tsx';
import {
  LARGEST_RESTORE_BODY_BYTES, REPLACE_ON_RESTORE_LABEL, REPLACE_ON_RESTORE_SENTENCE, hashOfRoute, megabytesInWords,
  restoreButtonText, restoreToSend, restoredInWords, runRowCountsInWords, sizeInWords, whyBackupFileCannotStart,
} from './shaping.ts';

type RestoreResult =
  | { state: 'none' }
  | { state: 'running' }
  | { state: 'restored'; report: RestoredRunReport }
  | { state: 'refused'; refusal: string }
  | { state: 'not-sent'; reason: string }
  | { state: 'fault'; fault: string };

/**
 * "Restore a run from a backup file": one file read in the browser, checked on the outside, and
 * sent as `restore_run`. Every decision is in shaping.ts; this only draws them and reads the file.
 */
export function RestoreRunSection({ onRestored }: { onRestored: () => void }) {
  const callOperation = useCallOperation();
  const idPrefix = useId();
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [replaceTicked, setReplaceTicked] = useState(false);
  const [result, setResult] = useState<RestoreResult>({ state: 'none' });
  const running = result.state === 'running';
  const whyNot = whyBackupFileCannotStart(pickedFile);

  const startRestore = async () => {
    if (pickedFile === null || whyNot !== null || running) return;
    setResult({ state: 'running' });
    let fileText: string;
    try {
      fileText = await pickedFile.text();
    } catch (error) {
      setResult({ state: 'fault', fault: `The file could not be read (${error instanceof Error ? error.message : String(error)}).` });
      return;
    }
    const toSend = restoreToSend(fileText, replaceTicked);
    if (!toSend.ok) {
      setResult({ state: 'not-sent', reason: toSend.reason });
      return;
    }
    const outcome = await callOperation('restore_run', toSend.input);
    if (outcome.kind === 'answer') {
      setResult({ state: 'restored', report: outcome.answer });
      setReplaceTicked(false);
      onRestored();
    } else if (outcome.kind === 'refusal') setResult({ state: 'refused', refusal: outcome.refusal });
    else if (outcome.kind === 'fault') setResult({ state: 'fault', fault: outcome.fault });
    // An access refusal is answered by the gate asking for the token again.
    else setResult({ state: 'none' });
  };

  return (
    <details className="card import-run">
      <summary className="import-run-summary">Restore a run from a backup file</summary>
      <p>
        Puts a run back exactly as a backup held it: every scene, fact, ruling, thread and change, with its
        ids, order and times. A backup is a file ending in <code>{RUN_EXPORT_FILE_ENDING}</code>, saved from a
        run's page or written by the server's own backups. A backup is sent without its file's spacing,
        and the page sends at most {megabytesInWords(LARGEST_RESTORE_BODY_BYTES)}.
      </p>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void startRestore();
        }}
      >
        <label htmlFor={`${idPrefix}-file`}>The backup file</label>
        <input
          id={`${idPrefix}-file`}
          type="file"
          accept={`${RUN_EXPORT_FILE_ENDING},.json,application/json`}
          disabled={running}
          onChange={(event) => {
            setPickedFile(event.target.files?.[0] ?? null);
            setResult({ state: 'none' });
          }}
        />
        {pickedFile !== null && <p className="quiet">{pickedFile.name}, {sizeInWords(pickedFile.size)}</p>}

        <label className="replace-earlier-import">
          <input
            type="checkbox"
            checked={replaceTicked}
            disabled={running}
            aria-describedby={`${idPrefix}-replace-hint`}
            onChange={(event) => setReplaceTicked(event.target.checked)}
          />{' '}
          {REPLACE_ON_RESTORE_LABEL}
        </label>
        <p id={`${idPrefix}-replace-hint`} className="quiet field-hint">{REPLACE_ON_RESTORE_SENTENCE}</p>

        <button type="submit" disabled={whyNot !== null || running} aria-describedby={`${idPrefix}-why-not`}>
          {restoreButtonText(running, replaceTicked)}
        </button>
        <p id={`${idPrefix}-why-not`} className="quiet field-hint">{running ? '' : whyNot ?? ''}</p>
      </form>

      <div aria-live="polite" className="import-result">
        {result.state === 'running' && <p className="quiet">Restoring the run…</p>}
        {result.state === 'restored' && (
          <>
            <h3>Restored</h3>
            <p>{restoredInWords(result.report)}</p>
            <ul className="plain-list import-counts">
              {runRowCountsInWords(result.report.rowsRestored).map((each) => (
                <li key={each.label}>{each.label}: {each.count}</li>
              ))}
            </ul>
            {result.report.replaced !== null && (
              <>
                <p>The run removed held:</p>
                <ul className="plain-list import-counts">
                  {runRowCountsInWords(result.report.replaced.rowsRemoved).map((each) => (
                    <li key={each.label}>{each.label}: {each.count}</li>
                  ))}
                </ul>
              </>
            )}
            <p>
              <a href={hashOfRoute({ page: 'run', slug: result.report.run.slug, section: 'scenes', itemId: null })}>
                Open {result.report.run.title}
              </a>
            </p>
          </>
        )}
        {result.state === 'refused' && (
          <>
            <p className="refusal">The server refused the restore:</p>
            <div className="scrolling-text refusal" tabIndex={0} aria-label="Why the restore was refused">{result.refusal}</div>
          </>
        )}
        {result.state === 'not-sent' && <p className="refusal" role="alert">{result.reason}</p>}
        {result.state === 'fault' && <p className="refusal">Something went wrong: {result.fault}</p>}
      </div>
    </details>
  );
}
