import { useId, useState } from 'react';
import { ENTRY_KINDS, VISIBILITIES } from '@timeweft/contract';
import type { EntryKind, EntryRecord, RunSnapshot, Visibility } from '@timeweft/contract';
import { ActMessage, ConfirmingButton, useAct, type Act } from './authoring.tsx';
import { AuthorOnlyMark } from './marks.tsx';
import {
  EMPTY_FACT_FORM, asOfNowInWords, changedWhenInWords, entriesByName, entriesGroupedByKind, entryDetailsFormOf, entryEditToSend,
  entryHistoryInWords, factToSend, factsOfEntryByProperty, heldSpanInWords, lastingActInWords, newEntryToSend, propertiesOfEntry,
  renameToSend, trailOfEntry, whyAnActNeedsAScene, type EntryDetailsForm, type FactAsDrawn, type FactForm, type NewEntryForm,
  quotedNamesInWords, rowsForLinesOf,
} from './shaping.ts';

const KIND_HEADINGS: Record<EntryKind, string> = {
  person: 'People',
  group: 'Groups and peoples',
  place: 'Places',
  item: 'Things',
  other: 'Other',
};

const KIND_WORDS: Record<EntryKind, string> = {
  person: 'A person',
  group: 'A group or people',
  place: 'A place',
  item: 'A thing',
  other: 'Something else',
};

const VISIBILITY_WORDS: Record<Visibility, string> = {
  open: 'Open: a story is told of it',
  'author-only': 'Author only: only these pages show it',
};

export function EntriesSection({ snapshot, openEntryId, readAgain }: { snapshot: RunSnapshot; openEntryId: string | null; readAgain: () => void }) {
  const groups = entriesGroupedByKind(snapshot.entries);
  // Changing an entry's kind moves it to another group, so that it moved is said here.
  const [lastMoved, setLastMoved] = useState<string | null>(null);
  return (
    <>
      <AddEntryForm runSlug={snapshot.run.slug} readAgain={readAgain} />
      {lastMoved !== null && <p className="quiet" role="status">{lastMoved}</p>}
      {groups.length === 0 && <p>No people, places or things have been named yet.</p>}
      {groups.map((group) => (
        <section key={group.kind} aria-labelledby={`kind-${group.kind}`}>
          <h3 id={`kind-${group.kind}`}>{KIND_HEADINGS[group.kind]}</h3>
          <ul className="plain-list">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <EntryDetails
                  entry={entry} snapshot={snapshot} startsOpen={entry.id === openEntryId} readAgain={readAgain}
                  onMoved={(kind) => setLastMoved(`Saved. ${entry.name} is now under ${KIND_HEADINGS[kind]}.`)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function EntryDetails({ entry, snapshot, startsOpen, readAgain, onMoved }: {
  entry: EntryRecord;
  snapshot: RunSnapshot;
  startsOpen: boolean;
  readAgain: () => void;
  onMoved: (kind: EntryKind) => void;
}) {
  const [showingHistory, setShowingHistory] = useState(false);
  const properties = factsOfEntryByProperty(entry.id, snapshot);
  const trail = trailOfEntry(entry.id, snapshot);
  const changes = entryHistoryInWords(entry.id, snapshot);
  const closedFactCount = properties.reduce((count, property) => count + property.history.length, 0);
  const historyCount = closedFactCount + changes.length;
  const historyCheckboxId = `history-${entry.id}`;
  // Ending a fact moves it into the history; what came of it is said under the facts.
  const ending = useAct(readAgain);
  // Renaming, changing details and turning open or author-only share one message under those forms.
  const editing = useAct(readAgain);

  return (
    <details className="card" open={startsOpen}>
      <summary>
        <span className="entry-name">{entry.name}</span> <AuthorOnlyMark visibility={entry.visibility} />
        {entry.alsoKnownAs.length > 0 && <span className="quiet"> also {quotedNamesInWords(entry.alsoKnownAs)}</span>}
      </summary>
      <p className="quiet">
        {entry.kind}{entry.pronoun === '' ? '' : `, ${entry.pronoun}`}; named by {entry.source}
      </p>
      {historyCount > 0 && (
        <p>
          <input
            id={historyCheckboxId}
            type="checkbox"
            checked={showingHistory}
            onChange={(event) => setShowingHistory(event.target.checked)}
          />{' '}
          <label htmlFor={historyCheckboxId}>Show history ({historyWords(closedFactCount, changes.length)})</label>
        </p>
      )}
      {showingHistory && changes.length > 0 && (
        <ol className="history-list" aria-label={`Changes to ${entry.name}, oldest first`}>
          {changes.map((change, index) => (
            <li key={index}>{change.label}, {changedWhenInWords(change.changedAfterSceneNumber)}: was {change.earlier}, became {change.later}</li>
          ))}
        </ol>
      )}
      {properties.length === 0 ? (
        <p className="quiet">No facts recorded.</p>
      ) : (
        <dl className="property-list">
          {properties.map((property) => (
            <div key={property.property}>
              <dt>{property.property}</dt>
              {property.holding.length === 0 && <dd className="quiet">Nothing holds now.</dd>}
              {property.holding.map((item) => (
                <dd key={item.fact.id}>
                  <FactValue item={item} />
                  <ConfirmingButton
                    label="End this fact" confirmLabel="End the fact"
                    explanation={lastingActInWords('end-fact', snapshot)}
                    whyNot={whyAnActNeedsAScene(snapshot)} busy={ending.busy}
                    onConfirm={() => void ending.act('end_fact', { fact: item.fact.id })}
                  />
                </dd>
              ))}
              {showingHistory && property.history.length > 0 && (
                <dd>
                  <ol className="history-list" aria-label={`History of ${property.property}, oldest first`}>
                    {property.history.map((item) => (
                      <li key={item.fact.id}><FactValue item={item} /></li>
                    ))}
                  </ol>
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
      <ActMessage actState={ending.actState} doneWords="Ended. It is kept in the history." />
      <StateFactForm entry={entry} snapshot={snapshot} readAgain={readAgain} />
      <h4>Trail</h4>
      {trail.length === 0 ? (
        <p className="quiet">Nothing has happened to them in a scene yet.</p>
      ) : (
        <ol className="plain-list trail-list">
          {trail.map(({ note, sceneNumber }) => (
            <li key={note.id}>
              <span className="quiet">Scene {sceneNumber ?? '?'}:</span> {note.text} <AuthorOnlyMark visibility={note.visibility} />
            </li>
          ))}
        </ol>
      )}
      <h4>Change this entry</h4>
      <details className="author-form">
        <summary>Rename it</summary>
        {/* Keyed by the name, so after a rename the box starts from the new one. */}
        <RenameForm key={entry.name} entry={entry} editing={editing} />
      </details>
      <details className="author-form">
        <summary>Change its kind, other names or pronoun</summary>
        <EntryDetailsFormFields key={JSON.stringify(entryDetailsFormOf(entry))} entry={entry} editing={editing} onMoved={onMoved} />
      </details>
      <ConfirmingButton
        label={entry.visibility === 'open' ? 'Turn it author only' : 'Turn it open'}
        confirmLabel={entry.visibility === 'open' ? 'Turn it author only' : 'Turn it open'}
        explanation={lastingActInWords(entry.visibility === 'open' ? 'turn-author-only' : 'turn-open', snapshot)}
        whyNot={null} busy={editing.busy}
        onConfirm={() => void editing.act('set_entry_visibility', { entry: entry.id, visibility: entry.visibility === 'open' ? 'author-only' : 'open' })}
      />
      <ActMessage actState={editing.actState} />
    </details>
  );
}

function historyWords(closedFactCount: number, changeCount: number): string {
  const parts: string[] = [];
  if (closedFactCount > 0) parts.push(`${closedFactCount} closed ${closedFactCount === 1 ? 'fact' : 'facts'}`);
  if (changeCount > 0) parts.push(`${changeCount} ${changeCount === 1 ? 'change' : 'changes'} to the entry`);
  return parts.join(', ');
}

function FactValue({ item }: { item: FactAsDrawn }) {
  const { fact } = item;
  return (
    <>
      {fact.value}
      {item.aboutName !== null && <span> ({item.aboutName})</span>}
      <span className="quiet"> {heldSpanInWords(item.fromSceneNumber, item.untilSceneNumber)}; said by {fact.source}</span>
      {fact.note !== '' && <span className="quiet">. {fact.note}</span>}
      {' '}<AuthorOnlyMark visibility={fact.visibility} />
    </>
  );
}

function VisibilityChoice({ name, value, onChange }: { name: string; value: Visibility; onChange: (visibility: Visibility) => void }) {
  return (
    <fieldset className="choice-row">
      <legend>Who sees it</legend>
      {VISIBILITIES.map((visibility) => (
        <label key={visibility}>
          <input type="radio" name={name} checked={value === visibility} onChange={() => onChange(visibility)} />
          {VISIBILITY_WORDS[visibility]}
        </label>
      ))}
    </fieldset>
  );
}

function KindChoice({ id, value, onChange }: { id: string; value: EntryKind; onChange: (kind: EntryKind) => void }) {
  return (
    <>
      <label htmlFor={id}>What it is</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as EntryKind)}>
        {ENTRY_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_WORDS[kind]}</option>)}
      </select>
    </>
  );
}

const EMPTY_NEW_ENTRY: NewEntryForm = { name: '', kind: 'person', alsoKnownAsText: '', pronoun: '', visibility: 'open' };

function AddEntryForm({ runSlug, readAgain }: { runSlug: string; readAgain: () => void }) {
  const idPrefix = useId();
  const [form, setForm] = useState<NewEntryForm>(EMPTY_NEW_ENTRY);
  const { actState, busy, act, refuse } = useAct(readAgain);
  const add = async () => {
    const toSend = newEntryToSend(runSlug, form);
    if (!toSend.ok) return refuse(toSend.reason);
    if (await act('add_entry', toSend.input)) setForm(EMPTY_NEW_ENTRY);
  };
  return (
    <details className="author-form">
      <summary>Add a person, group, place or thing</summary>
      <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <KindChoice id={`${idPrefix}-kind`} value={form.kind} onChange={(kind) => setForm({ ...form, kind })} />
        <label htmlFor={`${idPrefix}-also`}>Other names it goes by, one per line</label>
        <textarea id={`${idPrefix}-also`} rows={rowsForLinesOf(form.alsoKnownAsText)} value={form.alsoKnownAsText} onChange={(event) => setForm({ ...form, alsoKnownAsText: event.target.value })} />
        <label htmlFor={`${idPrefix}-pronoun`}>For a person: how the narration refers to them</label>
        <input id={`${idPrefix}-pronoun`} value={form.pronoun} onChange={(event) => setForm({ ...form, pronoun: event.target.value })} />
        <VisibilityChoice name={`${idPrefix}-visibility`} value={form.visibility} onChange={(visibility) => setForm({ ...form, visibility })} />
        <button type="submit" disabled={busy}>Add it</button>
        <ActMessage actState={actState} doneWords="Added." />
      </form>
    </details>
  );
}

function RenameForm({ entry, editing }: { entry: EntryRecord; editing: Act }) {
  const nameId = useId();
  const [name, setName] = useState(entry.name);
  const { busy, act, refuse } = editing;
  const rename = async () => {
    const toSend = renameToSend(entry, name);
    if (!toSend.ok) return refuse(toSend.reason);
    await act('rename_entry', toSend.input);
  };
  return (
    <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
      <label htmlFor={nameId}>The name it is known by from now on</label>
      <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
      <p className="quiet field-hint">The old name joins its other names, so it is still found by it.</p>
      <button type="submit" disabled={busy}>Rename it</button>
    </form>
  );
}

function EntryDetailsFormFields({ entry, editing, onMoved }: { entry: EntryRecord; editing: Act; onMoved: (kind: EntryKind) => void }) {
  const idPrefix = useId();
  const [form, setForm] = useState<EntryDetailsForm>(entryDetailsFormOf(entry));
  const { busy, act, refuse } = editing;
  const save = async () => {
    const toSend = entryEditToSend(entry, form);
    if (!toSend.ok) return refuse(toSend.reason);
    const taken = await act('edit_entry', toSend.input);
    if (taken && toSend.input.kind !== undefined) onMoved(toSend.input.kind);
  };
  return (
    <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <KindChoice id={`${idPrefix}-kind`} value={form.kind} onChange={(kind) => setForm({ ...form, kind })} />
      <label htmlFor={`${idPrefix}-also`}>Other names it goes by, one per line</label>
      <textarea id={`${idPrefix}-also`} rows={rowsForLinesOf(form.alsoKnownAsText)} value={form.alsoKnownAsText} onChange={(event) => setForm({ ...form, alsoKnownAsText: event.target.value })} />
      <label htmlFor={`${idPrefix}-pronoun`}>For a person: how the narration refers to them</label>
      <input id={`${idPrefix}-pronoun`} value={form.pronoun} onChange={(event) => setForm({ ...form, pronoun: event.target.value })} />
      <p className="quiet field-hint">What it said before is kept, with when it changed.</p>
      <button type="submit" disabled={busy}>Save the changes</button>
    </form>
  );
}

function StateFactForm({ entry, snapshot, readAgain }: { entry: EntryRecord; snapshot: RunSnapshot; readAgain: () => void }) {
  const idPrefix = useId();
  const [form, setForm] = useState<FactForm>(EMPTY_FACT_FORM);
  const { actState, busy, act, refuse } = useAct(readAgain);
  const others = entriesByName(snapshot.entries.filter((other) => other.id !== entry.id));
  const knownProperties = propertiesOfEntry(entry.id, snapshot);
  const state = async () => {
    const toSend = factToSend(snapshot.run.slug, entry.id, form);
    if (!toSend.ok) return refuse(toSend.reason);
    if (await act('state_fact', toSend.input)) setForm(EMPTY_FACT_FORM);
  };
  return (
    <details className="author-form">
      <summary>State a fact</summary>
      <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void state(); }}>
        <label htmlFor={`${idPrefix}-property`}>What is being said: where, who, state, held by, or any other</label>
        <input
          id={`${idPrefix}-property`} list={`${idPrefix}-properties`} value={form.property}
          onChange={(event) => setForm({ ...form, property: event.target.value })}
        />
        <datalist id={`${idPrefix}-properties`}>
          {knownProperties.map((property) => <option key={property} value={property} />)}
        </datalist>
        <label htmlFor={`${idPrefix}-value`}>What is so, in a sentence or less</label>
        <input id={`${idPrefix}-value`} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
        <label htmlFor={`${idPrefix}-about`}>Another entry it points at, if any</label>
        <select id={`${idPrefix}-about`} value={form.aboutEntryId} onChange={(event) => setForm({ ...form, aboutEntryId: event.target.value })}>
          <option value="">None</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>{other.name}{other.visibility === 'author-only' ? ' (author only)' : ''}</option>
          ))}
        </select>
        <VisibilityChoice name={`${idPrefix}-visibility`} value={form.visibility} onChange={(visibility) => setForm({ ...form, visibility })} />
        <label htmlFor={`${idPrefix}-note`}>A remark on it, if one is needed</label>
        <input id={`${idPrefix}-note`} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        <p className="quiet field-hint">
          It holds {asOfNowInWords(snapshot)} and replaces what the property held in the same lane. What held before is kept as history.
        </p>
        <button type="submit" disabled={busy}>State the fact</button>
        <ActMessage actState={actState} doneWords="Stated." />
      </form>
    </details>
  );
}
