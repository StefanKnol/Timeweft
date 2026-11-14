import { useId, useState } from 'react';
import { useCallOperation } from './calling.tsx';
import { BACKUP_DOWNLOAD_HINT, backupDownloadOf } from './shaping.ts';

type DownloadResult =
  | { state: 'none' }
  | { state: 'running' }
  | { state: 'saved'; fileName: string }
  | { state: 'refused'; refusal: string }
  | { state: 'fault'; fault: string };

/**
 * "Download a backup of this run": asks the server for `export_run` and saves the answer as a
 * file. What the file is called and holds is decided in shaping.ts; this only fetches and saves.
 */
export function BackupDownload({ runSlug }: { runSlug: string }) {
  const callOperation = useCallOperation();
  const idPrefix = useId();
  const [result, setResult] = useState<DownloadResult>({ state: 'none' });
  const running = result.state === 'running';

  const download = async () => {
    if (running) return;
    setResult({ state: 'running' });
    const outcome = await callOperation('export_run', { run: runSlug });
    if (outcome.kind === 'answer') {
      const { fileName, text } = backupDownloadOf(outcome.answer, new Date());
      saveTextAsFile(fileName, text);
      setResult({ state: 'saved', fileName });
    } else if (outcome.kind === 'refusal') setResult({ state: 'refused', refusal: outcome.refusal });
    else if (outcome.kind === 'fault') setResult({ state: 'fault', fault: outcome.fault });
    // An access refusal is answered by the gate asking for the token again.
    else setResult({ state: 'none' });
  };

  return (
    <div className="backup-download">
      <button type="button" disabled={running} aria-describedby={`${idPrefix}-hint`} onClick={() => void download()}>
        {running ? 'Preparing the backup…' : 'Download a backup of this run'}
      </button>
      <p id={`${idPrefix}-hint`} className="quiet field-hint">{BACKUP_DOWNLOAD_HINT}</p>
      <div aria-live="polite">
        {result.state === 'saved' && <p className="quiet">Saved as <code>{result.fileName}</code>.</p>}
        {result.state === 'refused' && <p className="refusal" role="alert">The server refused the backup: {result.refusal}</p>}
        {result.state === 'fault' && <p className="refusal" role="alert">Something went wrong: {result.fault}</p>}
      </div>
    </div>
  );
}

/** Hands the browser a file to save, then lets go of it. */
function saveTextAsFile(fileName: string, text: string): void {
  const address = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = address;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser starts the save on the click; the address is let go once it has.
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}
