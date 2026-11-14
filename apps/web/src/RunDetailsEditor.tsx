import { useId, useState } from 'react';
import { RUN_STATUSES } from '@timeweft/contract';
import type { RunOutline, RunStatus } from '@timeweft/contract';
import { ActMessage, EditFold, useAct, type Act } from './authoring.tsx';
import { changedWhenAndAtInWords, runDetailsFormOf, runEditToSend, runHistoryInWords, type RunDetailsForm } from './shaping.ts';

const STATUS_WORDS: Record<RunStatus, string> = {
  binding: 'Binding: what it establishes is canon',
  telling: 'A telling: its facts stay in the run',
};

/**
 * The run's own details, under "About this run": a form to change the title, the setting, how it
 * is narrated and its status, and the earlier values behind a "show history" control.
 */
export function RunDetailsEditor({ snapshot, readAgain }: { snapshot: RunOutline; readAgain: () => void }) {
  const history = runHistoryInWords(snapshot);
  const [showingHistory, setShowingHistory] = useState(false);
  const historyId = useId();
  const action = useAct(readAgain);
  return (
    <>
      {/* The form is drawn while the fold is open, so each opening starts from what the run holds;
          a refusal goes once the form is edited or the fold is closed. */}
      <EditFold summary="Change the title, setting or narration" onClosed={action.edited}>
        {(close) => (
          <>
            <RunDetailsFormFields snapshot={snapshot} action={action} onSaved={close} />
            <ActMessage actState={action.actState} />
          </>
        )}
      </EditFold>
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
                  {change.label}, {changedWhenAndAtInWords(change.changedAfterSceneNumber, change.writtenAt)}: was {change.earlier}, became {change.later}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}

function RunDetailsFormFields({ snapshot, action, onSaved }: { snapshot: RunOutline; action: Act; onSaved: () => void }) {
  const { run } = snapshot;
  const idPrefix = useId();
  const [form, setForm] = useState<RunDetailsForm>(runDetailsFormOf(run));
  const { busy, act, refuse, edited } = action;
  const change = (next: RunDetailsForm) => setForm(next);
  const save = async () => {
    const toSend = runEditToSend(run.slug, run, form);
    if (!toSend.ok) return refuse(toSend.reason);
    if (await act('edit_run', toSend.input, { words: "Saved the run's details. What they said before is kept under Show history." })) onSaved();
  };
  return (
    <form className="stacked-form" onInput={edited} onSubmit={(event) => { event.preventDefault(); void save(); }}>
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
      <button type="submit" aria-disabled={busy || undefined}>Save the run's details</button>
    </form>
  );
}
