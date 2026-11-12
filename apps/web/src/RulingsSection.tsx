import { useState } from 'react';
import type { RunSnapshot } from '@timeweft/contract';
import { rulingsMatching, sceneNumbersById } from './shaping.ts';

export function RulingsSection({ snapshot }: { snapshot: RunSnapshot }) {
  const [filterText, setFilterText] = useState('');
  const shown = rulingsMatching(snapshot.rulings, filterText);
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const entryNames = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  return (
    <>
      <p className="stacked-form">
        <label htmlFor="ruling-filter">Filter by words, topic, scope or source</label>
        <input id="ruling-filter" type="search" value={filterText} onChange={(event) => setFilterText(event.target.value)} />
      </p>
      <p className="quiet" role="status">{shown.length} of {snapshot.rulings.length} rulings</p>
      <ol className="plain-list">
        {shown.map((ruling) => {
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
