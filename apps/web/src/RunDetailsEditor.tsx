import { useEffect, useId, useState } from 'react';
import { RUN_STATUSES } from '@timeweft/contract';
import type { RunSnapshot, RunStatus } from '@timeweft/contract';
import { ActMessage, useAct, type Act } from './authoring.tsx';
import { changedWhenInWords, runDetailsFormOf, runEditToSend, runHistoryInWords, type RunDetailsForm } from './shaping.ts';

const STATUS_WORDS: Record<RunStatus, string> = {
  binding: 'Binding: what it establishes is canon',
  telling: 'A telling: its facts stay in the run',
};

/**
 * The run's own details, at the top of its page: a form to change the title, the setting, how it
 * is narrated and its status, and the earlier values behind a "show history" control.
 */
export function RunDetailsEditor({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const history = runHistoryInWords(snapshot);
  const [showingHistory, setShowingHistory] = useState(false);
  const historyId = useId();
  const { run } = snapshot;
  const action = useAct(readAgain);
  // A refusal answers the press that made it and nothing after: it goes once the run is read
  // again for any other act on the page, once another part of the run is opened, once the form is
  // changed, and once the editor is closed.
  const { actState, clear } = action;
  const refused = actState.state === 'refused';
  const [snapshotRefusedAt, setSnapshotRefusedAt] = useState<RunSnapshot | null>(null);
  if (refused && snapshotRefusedAt === null) setSnapshotRefusedAt(snapshot);
  if (!refused && snapshotRefusedAt !== null) setSnapshotRefusedAt(null);
  useEffect(() => {
    if (refused && snapshotRefusedAt !== null && snapshotRefusedAt !== snapshot) clear();
  }, [refused, snapshotRefusedAt, snapshot, clear]);
  useEffect(() => {
    if (!refused) return undefined;
    window.addEventListener('hashchange', clear);
    return () => window.removeEventListener('hashchange', clear);
  }, [refused, clear]);
  return (
    <>
      <details className="author-form" onToggle={(event) => { if (!event.currentTarget.open && refused) clear(); }}>
        <summary>Change the title, setting or narration</summary>
        {/* Keyed by what the run holds, so after a save the form starts from the new values. */}
        <RunDetailsFormFields key={JSON.stringify(runDetailsFormOf(run))} snapshot={snapshot} action={action} />
        <ActMessage actState={action.actState} />
      </details>
      {history.length > 0 && (
        <>
          <p>
            <input id={historyId} type="checkbox" checked={showingHistory} onChange={(event) => setShowingHistory(event.target.checked)} />{' '}
            <label htmlFor={historyId}>Show history ({history.length} {history.length === 1 ? 'change' : 'changes'} to the run)</label>
          </p>
          {showingHistory && (
            <ol className="history-list" aria-label="Changes to the run, oldest first">
              {history.map((change, index) => (
                <li key={index}>
                  {change.label}, {changedWhenInWords(change.changedAfterSceneNumber)}: was {change.earlier}, became {change.later}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}

function RunDetailsFormFields({ snapshot, action }: { snapshot: RunSnapshot; action: Act }) {
  const { run } = snapshot;
  const idPrefix = useId();
  const [form, setForm] = useState<RunDetailsForm>(runDetailsFormOf(run));
  const { busy, act, refuse, clear, actState } = action;
  const change = (next: RunDetailsForm) => {
    if (actState.state === 'refused') clear();
    setForm(next);
  };
  const save = async () => {
    const toSend = runEditToSend(run.slug, run, form);
    if (!toSend.ok) return refuse(toSend.reason);
    await act('edit_run', toSend.input);
  };
  return (
    <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="quiet field-hint">What it said before is kept, with when it changed.</p>
      <label htmlFor={`${idPrefix}-title`}>Title</label>
      <input id={`${idPrefix}-title`} value={form.title} onChange={(event) => change({ ...form, title: event.target.value })} />
      <label htmlFor={`${idPrefix}-setting`}>Setting: where and when it is set</label>
      <textarea id={`${idPrefix}-setting`} rows={3} value={form.setting} onChange={(event) => change({ ...form, setting: event.target.value })} />
      <label htmlFor={`${idPrefix}-register`}>How it is narrated: voice, spelling, point of view</label>
      <textarea id={`${idPrefix}-register`} rows={3} value={form.register} onChange={(event) => change({ ...form, register: event.target.value })} />
      <fieldset className="choice-row">
        <legend>Status</legend>
        {RUN_STATUSES.map((status) => (
          <label key={status}>
            <input type="radio" name={`${idPrefix}-status`} value={status} checked={form.status === status} onChange={() => change({ ...form, status })} />
            {STATUS_WORDS[status]}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={busy}>Save the run's details</button>
    </form>
  );
}
