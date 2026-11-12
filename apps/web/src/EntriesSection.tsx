import { useState } from 'react';
import type { EntryKind, EntryRecord, RunSnapshot } from '@timeweft/contract';
import { AuthorOnlyMark } from './marks.tsx';
import { entriesGroupedByKind, factsOfEntryByProperty, heldSpanInWords, trailOfEntry, type FactAsDrawn } from './shaping.ts';

const KIND_HEADINGS: Record<EntryKind, string> = {
  person: 'People',
  group: 'Groups and peoples',
  place: 'Places',
  item: 'Things',
  other: 'Other',
};

export function EntriesSection({ snapshot, openEntryId }: { snapshot: RunSnapshot; openEntryId: string | null }) {
  const groups = entriesGroupedByKind(snapshot.entries);
  if (groups.length === 0) return <p>No people, places or things have been named yet.</p>;
  return (
    <>
      {groups.map((group) => (
        <section key={group.kind} aria-labelledby={`kind-${group.kind}`}>
          <h3 id={`kind-${group.kind}`}>{KIND_HEADINGS[group.kind]}</h3>
          <ul className="plain-list">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <EntryDetails entry={entry} snapshot={snapshot} startsOpen={entry.id === openEntryId} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function EntryDetails({ entry, snapshot, startsOpen }: { entry: EntryRecord; snapshot: RunSnapshot; startsOpen: boolean }) {
  const [showingHistory, setShowingHistory] = useState(false);
  const properties = factsOfEntryByProperty(entry.id, snapshot);
  const trail = trailOfEntry(entry.id, snapshot);
  const historyCount = properties.reduce((count, property) => count + property.history.length, 0);
  const historyCheckboxId = `history-${entry.id}`;

  return (
    <details className="card" open={startsOpen}>
      <summary>
        <span className="entry-name">{entry.name}</span> <AuthorOnlyMark visibility={entry.visibility} />
        {entry.alsoKnownAs.length > 0 && <span className="quiet"> also {entry.alsoKnownAs.join(', ')}</span>}
      </summary>
      <p className="quiet">
        {entry.kind}{entry.pronoun === '' ? '' : `, ${entry.pronoun}`}; named by {entry.source}
      </p>
      {properties.length === 0 ? (
        <p className="quiet">No facts recorded.</p>
      ) : (
        <>
          {historyCount > 0 && (
            <p>
              <input
                id={historyCheckboxId}
                type="checkbox"
                checked={showingHistory}
                onChange={(event) => setShowingHistory(event.target.checked)}
              />{' '}
              <label htmlFor={historyCheckboxId}>Show history ({historyCount} closed {historyCount === 1 ? 'fact' : 'facts'})</label>
            </p>
          )}
          <dl className="property-list">
            {properties.map((property) => (
              <div key={property.property}>
                <dt>{property.property}</dt>
                {property.holding.length === 0 && <dd className="quiet">Nothing holds now.</dd>}
                {property.holding.map((item) => <FactLine key={item.fact.id} item={item} />)}
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
        </>
      )}
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
    </details>
  );
}

function FactLine({ item }: { item: FactAsDrawn }) {
  return <dd><FactValue item={item} /></dd>;
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
