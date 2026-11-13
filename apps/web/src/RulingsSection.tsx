import { useState } from 'react';
import type { RunSnapshot } from '@timeweft/contract';
import {
  RULINGS_SHOWN_AT_A_TIME, rulingsToDraw, sceneNumbersById, shownAfterShowingOlder,
} from './shaping.ts';

export function RulingsSection({ snapshot }: { snapshot: RunSnapshot }) {
  const [filterText, setFilterText] = useState('');
  const [shownCount, setShownCount] = useState(RULINGS_SHOWN_AT_A_TIME);
  const newest = rulingsToDraw(snapshot.rulings, filterText, shownCount);
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const entryNames = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  return (
    <>
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
        {newest.matchingCount} of {snapshot.rulings.length} rulings
        {newest.olderNotShown > 0 && `, the newest ${newest.shown.length} drawn`}
      </p>
      {newest.olderNotShown > 0 && (
        <p>
          <button type="button" onClick={() => setShownCount(shownAfterShowingOlder(shownCount, RULINGS_SHOWN_AT_A_TIME, newest.matchingCount))}>
            Show older ({newest.showOlderWouldAdd} more of {newest.olderNotShown})
          </button>
        </p>
      )}
      <ol className="plain-list">
        {newest.shown.map((ruling) => {
          const givenAt = ruling.sceneId === null ? null : sceneNumbers.get(ruling.sceneId) ?? null;
          const withdrawnAt = ruling.withdrawnInSceneId === null ? null : sceneNumbers.get(ruling.withdrawnInSceneId) ?? null;
          return (
            <li key={ruling.id} className="card">
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
            </li>
          );
        })}
      </ol>
    </>
  );
}
