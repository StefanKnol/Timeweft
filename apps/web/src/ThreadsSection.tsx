import { useId, useState } from 'react';
import type { RunOutline } from '@timeweft/contract';
import { ActMessage, itemElementId, useAct, useScrollToShownItem } from './authoring.tsx';
import {
  asOfNowInWords, entriesAThreadMayBeAbout, hashOfRoute, quotedSentence, lastingActInWords, threadLastTouchInWords, threadsOpenFirst, typedTextOrReason, whyAnActNeedsAScene, type ThreadAsDrawn,
} from './shaping.ts';

export function ThreadsSection({ snapshot, shownItemId, readAgain }: { snapshot: RunOutline; shownItemId: string | null; readAgain: () => void }) {
  const { open, closed } = threadsOpenFirst(snapshot.threads, snapshot.scenes);
  useScrollToShownItem(shownItemId);
  const cardProperties = (item: ThreadAsDrawn) => ({
    id: itemElementId(item.thread.id),
    tabIndex: -1,
    className: item.thread.id === shownItemId ? 'card item-shown' : 'card',
  });
  const entryNames = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  const aboutWords = (item: ThreadAsDrawn) =>
    item.thread.aboutEntryIds.length === 0 ? '' : `About ${item.thread.aboutEntryIds.map((id) => entryNames.get(id) ?? 'an entry').join(', ')}. `;
  const lastTouchLine = (item: ThreadAsDrawn) => {
    const words = threadLastTouchInWords(item);
    return words === '' ? null : <p>{words}</p>;
  };
  return (
    <>
      <OpenThreadForm snapshot={snapshot} readAgain={readAgain} />
      <h3>Open ({open.length})</h3>
      {open.length === 0 ? <p className="quiet">Nothing is left open.</p> : (
        <ul className="plain-list">
          {open.map((item) => (
            <li key={item.thread.id} {...cardProperties(item)}>
              <p>{item.thread.text}</p>
              <p className="quiet">{aboutWords(item)}Opened {item.openedInSceneNumber === null ? 'before the scenes' : `at scene ${item.openedInSceneNumber}`}.</p>
              {lastTouchLine(item)}
              <TouchThreadForm item={item} snapshot={snapshot} readAgain={readAgain} />
              <CloseThreadForm item={item} snapshot={snapshot} readAgain={readAgain} />
            </li>
          ))}
        </ul>
      )}
      <h3>Closed ({closed.length})</h3>
      {closed.length === 0 ? <p className="quiet">No thread has closed yet.</p> : (
        <ul className="plain-list">
          {closed.map((item) => (
            <li key={item.thread.id} {...cardProperties(item)}>
              <p>{item.thread.text}</p>
              <p><strong>How it closed:</strong> {item.thread.resolution === '' ? 'not said' : item.thread.resolution}</p>
              <p className="quiet">
                {aboutWords(item)}Opened {item.openedInSceneNumber === null ? 'before the scenes' : `at scene ${item.openedInSceneNumber}`}, closed at scene {item.closedInSceneNumber ?? '?'}.
              </p>
              {lastTouchLine(item)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function OpenThreadForm({ snapshot, readAgain }: { snapshot: RunOutline; readAgain: () => void }) {
  const idPrefix = useId();
  const [text, setText] = useState('');
  const [aboutEntryIds, setAboutEntryIds] = useState<string[]>([]);
  const { actState, busy, act, refuse, edited } = useAct(readAgain);
  const entries = entriesAThreadMayBeAbout(snapshot.entries);
  const openIt = async () => {
    const toSend = typedTextOrReason(text, 'what is left open');
    if (!toSend.ok) return refuse(toSend.reason);
    // An entry the run no longer holds is not sent, so a stale tick cannot be refused for it.
    const stillHeld = aboutEntryIds.filter((id) => entries.some((entry) => entry.id === id));
    const taken = await act('open_thread', { run: snapshot.run.slug, text: toSend.input, aboutEntryIds: stillHeld }, (answer) => ({
      words: quotedSentence('Opened ', answer.text),
      link: { href: hashOfRoute({ page: 'run', slug: snapshot.run.slug, section: 'threads', itemId: answer.id }), words: 'Show it' },
    }));
    if (taken) {
      setText('');
      setAboutEntryIds([]);
    }
  };
  return (
    <details className="author-form">
      <summary>Open a thread</summary>
      <form className="stacked-form" onInput={edited} onSubmit={(event) => { event.preventDefault(); void openIt(); }}>
        <label htmlFor={`${idPrefix}-text`}>What is left open: a question, a promise, a tension</label>
        <textarea id={`${idPrefix}-text`} rows={2} value={text} onChange={(event) => setText(event.target.value)} />
        {entries.length > 0 && (
          <fieldset className="choice-list">
            <legend>Who or what it touches (open entries only, since a story is told of the thread)</legend>
            {entries.map((entry) => (
              <label key={entry.id}>
                <input
                  type="checkbox" checked={aboutEntryIds.includes(entry.id)}
                  onChange={(event) => setAboutEntryIds(event.target.checked ? [...aboutEntryIds, entry.id] : aboutEntryIds.filter((id) => id !== entry.id))}
                />
                {entry.name}
              </label>
            ))}
          </fieldset>
        )}
        <p className="quiet field-hint">It opens {asOfNowInWords(snapshot)}.</p>
        <button type="submit" aria-disabled={busy || undefined}>Open the thread</button>
        <ActMessage actState={actState} />
      </form>
    </details>
  );
}

function TouchThreadForm({ item, snapshot, readAgain }: { item: ThreadAsDrawn; snapshot: RunOutline; readAgain: () => void }) {
  const noteId = useId();
  const [note, setNote] = useState('');
  const { actState, busy, act, edited } = useAct(readAgain);
  const whyNot = whyAnActNeedsAScene(snapshot);
  return (
    <details className="author-form">
      <summary>Say it moved on</summary>
      {whyNot !== null ? <p className="quiet field-hint">{whyNot}</p> : (
        <form
          className="stacked-form"
          onInput={edited}
          onSubmit={async (event) => {
            event.preventDefault();
            const said = { words: `${quotedSentence('Touched ', item.thread.text)} It counts as moved on ${asOfNowInWords(snapshot)}.` };
            if (await act('touch_thread', { thread: item.thread.id, note: note.trim() }, said)) setNote('');
          }}
        >
          <label htmlFor={noteId}>What moved, in a sentence or less (may be left empty)</label>
          <input id={noteId} value={note} onChange={(event) => setNote(event.target.value)} />
          <p className="quiet field-hint">It counts as touched {asOfNowInWords(snapshot)}, so a resume ranks it as live.</p>
          <button type="submit" aria-disabled={busy || undefined}>Touch the thread</button>
          <ActMessage actState={actState} />
        </form>
      )}
    </details>
  );
}

function CloseThreadForm({ item, snapshot, readAgain }: { item: ThreadAsDrawn; snapshot: RunOutline; readAgain: () => void }) {
  const resolutionId = useId();
  const explanationId = useId();
  const [resolution, setResolution] = useState('');
  const { actState, busy, act, refuse, edited } = useAct(readAgain);
  const whyNot = whyAnActNeedsAScene(snapshot);
  const closeIt = async () => {
    const toSend = typedTextOrReason(resolution, 'how it resolved');
    if (!toSend.ok) return refuse(toSend.reason);
    // The form goes with the thread when it moves to Closed, so focus goes to the notice.
    await act('close_thread', { thread: item.thread.id, resolution: toSend.input }, {
      words: `${quotedSentence('Closed ', item.thread.text)} It is kept under Closed.`,
      link: { href: hashOfRoute({ page: 'run', slug: snapshot.run.slug, section: 'threads', itemId: item.thread.id }), words: 'Show it' },
      focusTheNotice: true,
    });
  };
  return (
    <details className="author-form">
      <summary>Close it</summary>
      {whyNot !== null ? <p className="quiet field-hint">{whyNot}</p> : (
        <form className="stacked-form" onInput={edited} onSubmit={(event) => { event.preventDefault(); void closeIt(); }}>
          <label htmlFor={resolutionId}>How it resolved, in a sentence</label>
          <input id={resolutionId} value={resolution} aria-describedby={explanationId} onChange={(event) => setResolution(event.target.value)} />
          <p id={explanationId} className="quiet field-hint">{lastingActInWords('close-thread', snapshot)}</p>
          <button type="submit" aria-disabled={busy || undefined}>Close the thread</button>
          <ActMessage actState={actState} />
        </form>
      )}
    </details>
  );
}
