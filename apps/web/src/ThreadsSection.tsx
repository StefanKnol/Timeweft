import type { RunSnapshot } from '@timeweft/contract';
import { threadsOpenFirst, type ThreadAsDrawn } from './shaping.ts';

export function ThreadsSection({ snapshot }: { snapshot: RunSnapshot }) {
  const { open, closed } = threadsOpenFirst(snapshot.threads, snapshot.scenes);
  const entryNames = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  const aboutWords = (item: ThreadAsDrawn) =>
    item.thread.aboutEntryIds.length === 0 ? '' : `About ${item.thread.aboutEntryIds.map((id) => entryNames.get(id) ?? 'an entry').join(', ')}. `;
  const lastTouchedWords = (item: ThreadAsDrawn) =>
    item.lastTouchedInSceneNumber === null || item.lastTouchedInSceneNumber === item.openedInSceneNumber
      ? ''
      : `, last touched at scene ${item.lastTouchedInSceneNumber}${item.lastTouchNote === '' ? '' : ` (${item.lastTouchNote})`}`;
  return (
    <>
      <h3>Open ({open.length})</h3>
      {open.length === 0 ? <p className="quiet">Nothing is left open.</p> : (
        <ul className="plain-list">
          {open.map((item) => (
            <li key={item.thread.id} className="card">
              <p>{item.thread.text}</p>
              <p className="quiet">{aboutWords(item)}Opened {item.openedInSceneNumber === null ? 'before the scenes' : `at scene ${item.openedInSceneNumber}`}{lastTouchedWords(item)}.</p>
            </li>
          ))}
        </ul>
      )}
      <h3>Closed ({closed.length})</h3>
      {closed.length === 0 ? <p className="quiet">No thread has closed yet.</p> : (
        <ul className="plain-list">
          {closed.map((item) => (
            <li key={item.thread.id} className="card">
              <p>{item.thread.text}</p>
              <p><strong>How it closed:</strong> {item.thread.resolution === '' ? 'not said' : item.thread.resolution}</p>
              <p className="quiet">
                {aboutWords(item)}Opened {item.openedInSceneNumber === null ? 'before the scenes' : `at scene ${item.openedInSceneNumber}`}, closed at scene {item.closedInSceneNumber ?? '?'}.
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
