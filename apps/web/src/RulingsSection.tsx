import { useId, useState } from 'react';
import { RULING_SCOPES } from '@timeweft/contract';
import type { RulingRecord, RunSnapshot } from '@timeweft/contract';
import { ActMessage, ConfirmingButton, useAct, type Act } from './authoring.tsx';
import {
  RULINGS_SHOWN_AT_A_TIME, entriesARulingMayName, lastingActInWords, rulingToSend, rulingsSplitByWithdrawal, rulingsToDraw,
  sceneNumbersById, shownAfterShowingOlder, whyAnActNeedsAScene, type RulingForm,
} from './shaping.ts';

const EMPTY_RULING_FORM: RulingForm = { text: '', scope: 'run', topicsText: '', aboutEntryIds: [] };

export function RulingsSection({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const [filterText, setFilterText] = useState('');
  const [shownCount, setShownCount] = useState(RULINGS_SHOWN_AT_A_TIME);
  const [showingWithdrawn, setShowingWithdrawn] = useState(false);
  const withdrawnCheckboxId = useId();
  const { inForce, withdrawn } = rulingsSplitByWithdrawal(snapshot.rulings);
  const newest = rulingsToDraw(inForce, filterText, shownCount);
  const withdrawnMatching = rulingsToDraw(withdrawn, filterText, withdrawn.length).shown;
  // One act for every withdrawal, kept here because a withdrawn ruling leaves the list it was in.
  const withdrawal = useAct(readAgain);
  return (
    <>
      <AddRulingForm snapshot={snapshot} readAgain={readAgain} />
      <p className="stacked-form">
        <label htmlFor="ruling-filter">Filter by words, topic, scope or source</label>
        <input
          id="ruling-filter" type="search" value={filterText}
          onChange={(event) => {
            setFilterText(event.target.value);
            // A new search starts from its own newest step rather than however far back the last one was opened.
            setShownCount(RULINGS_SHOWN_AT_A_TIME);
          }}
        />
      </p>
      <p className="quiet" role="status">
        {newest.matchingCount} of {inForce.length} rulings in force
        {newest.olderNotShown > 0 && `, the newest ${newest.shown.length} drawn`}
      </p>
      <ActMessage actState={withdrawal.actState} doneWords="Withdrawn. It is kept under the history below." />
      {newest.olderNotShown > 0 && (
        <p>
          <button type="button" onClick={() => setShownCount(shownAfterShowingOlder(shownCount, RULINGS_SHOWN_AT_A_TIME, newest.matchingCount))}>
            Show older ({newest.showOlderWouldAdd} more of {newest.olderNotShown})
          </button>
        </p>
      )}
      <ol className="plain-list">
        {newest.shown.map((ruling) => (
          <li key={ruling.id} className="card"><RulingCard ruling={ruling} snapshot={snapshot} withdrawal={withdrawal} /></li>
        ))}
      </ol>
      {withdrawn.length > 0 && (
        <>
          <p>
            <input id={withdrawnCheckboxId} type="checkbox" checked={showingWithdrawn} onChange={(event) => setShowingWithdrawn(event.target.checked)} />{' '}
            <label htmlFor={withdrawnCheckboxId}>
              Show history ({withdrawn.length} withdrawn {withdrawn.length === 1 ? 'ruling' : 'rulings'}{filterText.trim() === '' ? '' : `, ${withdrawnMatching.length} matching`})
            </label>
          </p>
          {showingWithdrawn && (
            <ol className="plain-list" aria-label="Withdrawn rulings">
              {withdrawnMatching.map((ruling) => (
                <li key={ruling.id} className="card struck"><RulingCard ruling={ruling} snapshot={snapshot} withdrawal={withdrawal} /></li>
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}

function RulingCard({ ruling, snapshot, withdrawal }: { ruling: RulingRecord; snapshot: RunSnapshot; withdrawal: Act }) {
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const entryNames = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  const { busy, act } = withdrawal;
  const givenAt = ruling.sceneId === null ? null : sceneNumbers.get(ruling.sceneId) ?? null;
  const withdrawnAt = ruling.withdrawnInSceneId === null ? null : sceneNumbers.get(ruling.withdrawnInSceneId) ?? null;
  return (
    <>
      <h3 className="card-title">Ruling {ruling.number}{ruling.withdrawnInSceneId !== null && <span className="quiet"> (withdrawn{withdrawnAt === null ? '' : ` at scene ${withdrawnAt}`})</span>}</h3>
      <blockquote className="kept-text">{ruling.text}</blockquote>
      <dl className="facts-row">
        <div><dt>Source</dt><dd>{ruling.source}</dd></div>
        <div><dt>Scope</dt><dd>{ruling.scope}</dd></div>
        <div><dt>Topics</dt><dd>{ruling.topics.length === 0 ? 'none' : ruling.topics.join(', ')}</dd></div>
        {ruling.aboutEntryIds.length > 0 && (
          <div><dt>About</dt><dd>{ruling.aboutEntryIds.map((id) => entryNames.get(id) ?? 'an entry').join(', ')}</dd></div>
        )}
        {givenAt !== null && <div><dt>Given at</dt><dd>scene {givenAt}</dd></div>}
      </dl>
      {ruling.withdrawnInSceneId === null && (
        <ConfirmingButton
          label="Withdraw it" confirmLabel="Withdraw the ruling"
          explanation={lastingActInWords('withdraw-ruling', snapshot)}
          whyNot={whyAnActNeedsAScene(snapshot)} busy={busy}
          onConfirm={() => void act('withdraw_ruling', { ruling: ruling.id })}
        />
      )}
    </>
  );
}

/**
 * The author adds a ruling with `record_ruling`, the operation a chat calls to keep the author's
 * instruction word for word: one act, written once (docs/decisions/0003). It names the entries a
 * ruling is about by name, so only open entries are offered.
 */
function AddRulingForm({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const idPrefix = useId();
  const [form, setForm] = useState<RulingForm>(EMPTY_RULING_FORM);
  const { actState, busy, act, refuse } = useAct(readAgain);
  const nameable = entriesARulingMayName(snapshot);
  const add = async () => {
    const toSend = rulingToSend(snapshot.run.slug, form, snapshot);
    if (!toSend.ok) return refuse(toSend.reason);
    if (await act('record_ruling', toSend.input)) setForm(EMPTY_RULING_FORM);
  };
  const toggleAbout = (entryId: string, chosen: boolean) =>
    setForm({ ...form, aboutEntryIds: chosen ? [...form.aboutEntryIds, entryId] : form.aboutEntryIds.filter((id) => id !== entryId) });
  return (
    <details className="author-form">
      <summary>Add a ruling</summary>
      <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <label htmlFor={`${idPrefix}-text`}>The ruling, word for word</label>
        <textarea id={`${idPrefix}-text`} rows={3} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} />
        <fieldset className="choice-row">
          <legend>What it binds</legend>
          {RULING_SCOPES.map((scope) => (
            <label key={scope}>
              <input type="radio" name={`${idPrefix}-scope`} checked={form.scope === scope} onChange={() => setForm({ ...form, scope })} />
              {scope === 'run' ? 'How this run is played' : 'How the world is'}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${idPrefix}-topics`}>Topics it bears on, between commas</label>
        <input id={`${idPrefix}-topics`} value={form.topicsText} onChange={(event) => setForm({ ...form, topicsText: event.target.value })} />
        {nameable.length > 0 && (
          <fieldset className="choice-list">
            <legend>Who or what it is about</legend>
            <p className="quiet field-hint">Only entries a story can see are offered, since a story is told the ruling.</p>
            {nameable.map(({ entry, sharesItsName }) => (
              <label key={entry.id}>
                <input type="checkbox" checked={form.aboutEntryIds.includes(entry.id)} onChange={(event) => toggleAbout(entry.id, event.target.checked)} />
                {entry.name}{sharesItsName && <span className="quiet"> (shares its name, so it cannot be named here)</span>}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" disabled={busy}>Add the ruling</button>
        <ActMessage actState={actState} doneWords="Added." />
      </form>
    </details>
  );
}
