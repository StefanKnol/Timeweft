import { useId, useRef, useState } from 'react';
import { RUN_STATUSES } from '@timeweft/contract';
import type { ImportedRunReport, RunStatus } from '@timeweft/contract';
import { useCallOperation } from './calling.tsx';
import {
  IMPORT_PARTS, hashOfRoute, importCountsInWords, importRunInput, matchFilesToParts, sizeInWords, slugShown,
  titleFromLogText, unplacedInWords, whyImportCannotStart, type ImportPart,
} from './shaping.ts';

type ImportResult =
  | { state: 'none' }
  | { state: 'running' }
  | { state: 'imported'; report: ImportedRunReport }
  | { state: 'refused'; refusal: string }
  | { state: 'fault'; fault: string };

/**
 * Importing a run kept by hand: five Markdown files read in the browser and sent as one
 * `import_run`. Every decision is in shaping.ts; this only draws them and reads the files.
 */
export function ImportRunSection({ onImported }: { onImported: () => void }) {
  const callOperation = useCallOperation();
  const idPrefix = useId();
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [titleOfLog, setTitleOfLog] = useState<string | null>(null);
  const [typedSlug, setTypedSlug] = useState('');
  const [authorTypedSlug, setAuthorTypedSlug] = useState(false);
  const [title, setTitle] = useState('');
  const [setting, setSetting] = useState('');
  const [status, setStatus] = useState<RunStatus>('binding');
  const [result, setResult] = useState<ImportResult>({ state: 'none' });
  const [unplacedShown, setUnplacedShown] = useState(false);
  // Counts the picks, so a log read for an earlier pick never lands after a later one.
  const pickNumber = useRef(0);

  const matched = matchFilesToParts(pickedFiles);
  const slug = slugShown(typedSlug, authorTypedSlug, titleOfLog);
  const whyNot = whyImportCannotStart(matched, slug);
  const running = result.state === 'running';

  const pickFiles = async (files: File[]) => {
    pickNumber.current += 1;
    const thisPick = pickNumber.current;
    setPickedFiles(files);
    setResult({ state: 'none' });
    // The log's title line is read now, to offer a slug before Import is pressed.
    const logFile = matchFilesToParts(files).byPart.log;
    let title: string | null = null;
    if (logFile !== null) {
      try {
        title = titleFromLogText(await textOfFile(logFile));
      } catch {
        title = null;
      }
    }
    if (thisPick === pickNumber.current) setTitleOfLog(title);
  };

  const startImport = async () => {
    if (whyNot !== null || running) return;
    setResult({ state: 'running' });
    setUnplacedShown(false);
    let textByPart: Partial<Record<ImportPart, string>>;
    try {
      textByPart = Object.fromEntries(await Promise.all(IMPORT_PARTS.flatMap((part) => {
        const file = matched.byPart[part];
        return file === null ? [] : [textOfFile(file).then((text) => [part, text] as const)];
      })));
    } catch (error) {
      setResult({ state: 'fault', fault: `A file could not be read (${error instanceof Error ? error.message : String(error)}).` });
      return;
    }
    const outcome = await callOperation('import_run', importRunInput({ slug, title, setting, status }, textByPart));
    if (outcome.kind === 'answer') {
      setResult({ state: 'imported', report: outcome.answer });
      onImported();
    } else if (outcome.kind === 'refusal') setResult({ state: 'refused', refusal: outcome.refusal });
    else if (outcome.kind === 'fault') setResult({ state: 'fault', fault: outcome.fault });
    // An access refusal is answered by the gate asking for the token again.
    else setResult({ state: 'none' });
  };

  return (
    <details className="card import-run">
      <summary className="import-run-summary">Import a run kept by hand</summary>
      <p>
        Reads the five Markdown files a story kept by hand: <code>log.md</code>, <code>state.md</code>,{' '}
        <code>cast.md</code>, <code>items.md</code> and <code>places.md</code>. A file the run did not keep may
        be left out.
      </p>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void startImport();
        }}
      >
        <label htmlFor={`${idPrefix}-files`}>The files (pick several at once)</label>
        <input
          id={`${idPrefix}-files`}
          type="file"
          multiple
          accept=".md,text/markdown,text/plain"
          disabled={running}
          onChange={(event) => void pickFiles(Array.from(event.target.files ?? []))}
        />

        <h3 id={`${idPrefix}-parts-heading`} className="import-parts-heading">What each part is read from</h3>
        <ul className="plain-list import-parts" aria-labelledby={`${idPrefix}-parts-heading`}>
          {IMPORT_PARTS.map((part) => {
            const file = matched.byPart[part];
            return (
              <li key={part}>
                <code>{part}.md</code>:{' '}
                {file === null ? <span className="quiet">not given</span> : <>{file.name}, {sizeInWords(file.size)}</>}
              </li>
            );
          })}
          {matched.notUsed.map((file, index) => (
            <li key={`not-used-${index}`}>
              <span className="quiet">not used:</span> {file.name}
            </li>
          ))}
        </ul>
        {matched.refusals.map((refusal) => (
          <p key={refusal} className="refusal" role="alert">{refusal}</p>
        ))}

        <label htmlFor={`${idPrefix}-slug`}>Slug</label>
        <input
          id={`${idPrefix}-slug`}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={slug}
          aria-describedby={`${idPrefix}-slug-hint`}
          onChange={(event) => {
            setAuthorTypedSlug(true);
            setTypedSlug(event.target.value);
          }}
        />
        <p id={`${idPrefix}-slug-hint`} className="quiet field-hint">
          Lower case letters, digits and hyphens. Offered from the log's title line where it has one.
        </p>

        <label htmlFor={`${idPrefix}-title`}>Title (optional)</label>
        <input id={`${idPrefix}-title`} type="text" value={title} placeholder={titleOfLog ?? ''} onChange={(event) => setTitle(event.target.value)} />

        <label htmlFor={`${idPrefix}-setting`}>Setting (optional)</label>
        <input id={`${idPrefix}-setting`} type="text" value={setting} onChange={(event) => setSetting(event.target.value)} />

        <fieldset className="choice-row">
          <legend>Binding or telling</legend>
          {RUN_STATUSES.map((each) => (
            <label key={each}>
              <input type="radio" name={`${idPrefix}-status`} value={each} checked={status === each} onChange={() => setStatus(each)} />{' '}
              {each === 'binding' ? 'Binding' : 'Telling'}
            </label>
          ))}
        </fieldset>

        <button type="submit" disabled={whyNot !== null || running} aria-describedby={`${idPrefix}-why-not`}>
          {running ? 'Importing…' : 'Import'}
        </button>
        <p id={`${idPrefix}-why-not`} className="quiet field-hint">{running ? '' : whyNot ?? ''}</p>
      </form>

      <div aria-live="polite" className="import-result">
        {result.state === 'running' && <p className="quiet">Importing the run…</p>}
        {result.state === 'imported' && (
          <>
            <h3>Imported</h3>
            <ul className="plain-list import-counts">
              {importCountsInWords(result.report.counts).map((each) => (
                <li key={each.label}>{each.label}: {each.count}</li>
              ))}
            </ul>
            <p>{unplacedInWords(result.report.unplaced.length)}</p>
            {result.report.unplaced.length > 0 && (
              <>
                <button
                  type="button"
                  className="quiet-button"
                  aria-expanded={unplacedShown}
                  aria-controls={`${idPrefix}-unplaced`}
                  onClick={() => setUnplacedShown((shown) => !shown)}
                >
                  {unplacedShown ? 'Hide them' : 'Show them'}
                </button>
                {unplacedShown && (
                  <div id={`${idPrefix}-unplaced`} className="scrolling-text" tabIndex={0} aria-label="Lines not placed">
                    {result.report.unplaced.join('\n')}
                  </div>
                )}
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
            <p className="refusal">The store refused the import:</p>
            <div className="scrolling-text refusal" tabIndex={0} aria-label="Why the import was refused">{result.refusal}</div>
          </>
        )}
        {result.state === 'fault' && <p className="refusal">Something went wrong: {result.fault}</p>}
      </div>
    </details>
  );
}

/** A file's text, decoded as UTF-8, which is what `File.text` always does. */
function textOfFile(file: File): Promise<string> {
  return file.text();
}
