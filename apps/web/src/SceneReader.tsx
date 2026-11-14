/**
 * One scene read in full: its words, its text fetched on opening, and what it established.
 */
import { useEffect, useRef, useState } from 'react';
import type { RunOutline, SceneOutline, SceneText } from '@timeweft/contract';
import { AuthorOnlyMark, KeptText } from './marks.tsx';
import { useCallOperation, type Loaded } from './calling.tsx';
import { hashOfRoute, heldSpanInWords, readingsWithClockNames, recordVersionOf, sceneNumbersById, whatASceneEstablished } from './shaping.ts';

export function SceneReader({ scene, snapshot }: { scene: SceneOutline; snapshot: RunOutline }) {
  const headingReference = useRef<HTMLHeadingElement>(null);
  // Picking a scene replaces the list, so the reading position and focus move to the new heading.
  useEffect(() => {
    headingReference.current?.focus();
  }, [scene.id]);

  const established = whatASceneEstablished(scene.id, snapshot);
  const sceneNumbers = sceneNumbersById(snapshot.scenes);
  const entryNames = new Map(snapshot.entries.map((entry) => [entry.id, entry.name]));
  const place = scene.placeEntryId === null ? null : entryNames.get(scene.placeEntryId) ?? null;
  const readings = readingsWithClockNames(scene.readings, snapshot.clocks);
  const entryLink = (entryId: string) => hashOfRoute({ page: 'run', slug: snapshot.run.slug, section: 'entries', itemId: entryId });

  return (
    <div className="scene-in-full">
      <h3 ref={headingReference} tabIndex={-1}>
        {scene.status === 'struck' ? <s>{`${scene.number}. ${scene.title}`}</s> : `${scene.number}. ${scene.title}`}
        {scene.status === 'struck' && <span className="quiet"> (struck take, never served)</span>}
      </h3>
      <dl className="facts-row">
        <div><dt>When</dt><dd>{scene.whenTyped}</dd></div>
        {place !== null && <div><dt>Where</dt><dd>{place}</dd></div>}
        {readings.map((reading) => (
          <div key={reading.clockName}>
            <dt>{reading.clockName}</dt>
            <dd>{reading.count}{reading.partOfDay === '' ? '' : `, ${reading.partOfDay}`}</dd>
          </div>
        ))}
      </dl>
      <h4>Summary</h4>
      <KeptText text={scene.summary} emptyWords="No summary." />
      <h4>The scene{scene.recordWords > 0 && <span className="quiet"> ({wordCountInWords(scene.recordWords)})</span>}</h4>
      <SceneRecordText runSlug={snapshot.run.slug} scene={scene} recordVersion={recordVersionOf(scene.id, snapshot.sceneEdits)} />
      <h4>Steer</h4>
      <KeptText text={scene.steer} emptyWords="The author steered nothing at this scene." />
      <h4>Where things stood after it</h4>
      <KeptText text={scene.situationAfter} emptyWords="Not said." />

      <h4>What it established</h4>
      {established.entriesIntroduced.length > 0 && (
        <>
          <h5>Named for the first time</h5>
          <ul>
            {established.entriesIntroduced.map((entry) => (
              <li key={entry.id}><a href={entryLink(entry.id)}>{entry.name}</a> ({entry.kind}) <AuthorOnlyMark visibility={entry.visibility} /></li>
            ))}
          </ul>
        </>
      )}
      {established.factsEstablished.length > 0 && (
        <>
          <h5>Facts</h5>
          <ul>
            {established.factsEstablished.map((fact) => {
              const aboutName = fact.aboutEntryId === null ? null : entryNames.get(fact.aboutEntryId) ?? null;
              const untilNumber = fact.untilSceneId === null ? null : sceneNumbers.get(fact.untilSceneId) ?? null;
              return (
                <li key={fact.id}>
                  <strong>{entryNames.get(fact.entryId) ?? 'an entry'}</strong>, {fact.property}: {fact.value}
                  {aboutName === null ? '' : ` (${aboutName})`}
                  <span className="quiet"> {heldSpanInWords(scene.number, untilNumber)}; said by {fact.source}</span>
                  {' '}<AuthorOnlyMark visibility={fact.visibility} />
                </li>
              );
            })}
          </ul>
        </>
      )}
      {established.notes.length > 0 && (
        <>
          <h5>What happened to whom</h5>
          <ul>
            {established.notes.map((note) => (
              <li key={note.id}><strong>{entryNames.get(note.entryId) ?? 'an entry'}</strong>: {note.text} <AuthorOnlyMark visibility={note.visibility} /></li>
            ))}
          </ul>
        </>
      )}
      {established.rulings.length > 0 && (
        <>
          <h5>Rulings given</h5>
          <ul>{established.rulings.map((ruling) => <li key={ruling.id}>{ruling.number}. <span className="kept-text">{ruling.text}</span></li>)}</ul>
        </>
      )}
      {established.threadsOpened.length > 0 && (
        <>
          <h5>Threads opened</h5>
          <ul>{established.threadsOpened.map((thread) => <li key={thread.id}>{thread.text}</li>)}</ul>
        </>
      )}
      {established.threadsTouched.length > 0 && (
        <>
          <h5>Threads moved on</h5>
          <ul>{established.threadsTouched.map(({ thread, note }) => <li key={thread.id}>{thread.text}{note === '' ? '' : `: ${note}`}</li>)}</ul>
        </>
      )}
      {established.threadsClosed.length > 0 && (
        <>
          <h5>Threads closed</h5>
          <ul>{established.threadsClosed.map((thread) => <li key={thread.id}>{thread.text}: {thread.resolution}</li>)}</ul>
        </>
      )}
      {established.legs.length > 0 && (
        <>
          <h5>Journeys first travelled</h5>
          <ul>
            {established.legs.map((leg) => (
              <li key={leg.id}>From {leg.fromPlace} to {leg.toPlace}: {leg.duration}{leg.note === '' ? '' : ` (${leg.note})`}</li>
            ))}
          </ul>
        </>
      )}
      {Object.values(established).every((items) => items.length === 0) && <p className="quiet">Nothing recorded as established here.</p>}
    </div>
  );
}

/**
 * Records already fetched in this visit to the page, by run, take and version. The author can
 * change a take's record under the same id (edit_scene), so the key also holds the newest change
 * to that record (`recordVersionOf`): once the run is read again after an edit, the key is new and
 * the text is fetched again. Until then, a record is fetched once and kept until the page is reloaded.
 */
const recordsFetched = new Map<string, string>();

function recordKey(runSlug: string, sceneId: string, recordVersion: string): string {
  return `${runSlug}\u0000${sceneId}\u0000${recordVersion}`;
}

/** What the page says where a take holds no prose of its own. */
const NOTHING_BEYOND_THE_SUMMARY = 'Nothing beyond the summary.';

/** "1 word", "1,204 words". */
function wordCountInWords(count: number): string {
  return count === 1 ? '1 word' : `${count.toLocaleString('en-GB')} words`;
}

/**
 * The record of one take, fetched when the scene opens: the run is read without the scenes' prose,
 * so the prose is one request away. A take whose record is empty is never fetched.
 */
function SceneRecordText({ runSlug, scene, recordVersion }: { runSlug: string; scene: SceneOutline; recordVersion: string }) {
  const callOperation = useCallOperation();
  const key = recordKey(runSlug, scene.id, recordVersion);
  const alreadyFetched = recordsFetched.get(key);
  const [loaded, setLoaded] = useState<Loaded<SceneText>>({ state: 'loading' });

  useEffect(() => {
    if (scene.recordWords === 0 || recordsFetched.has(key)) return;
    let stillWanted = true;
    setLoaded({ state: 'loading' });
    callOperation('read_scene_text', { run: runSlug, sceneId: scene.id }).then((outcome) => {
      if (outcome.kind === 'answer') recordsFetched.set(key, outcome.answer.record);
      if (!stillWanted) return;
      if (outcome.kind === 'answer') setLoaded({ state: 'answer', answer: outcome.answer });
      else if (outcome.kind === 'refusal') setLoaded({ state: 'refusal', message: outcome.refusal });
      else if (outcome.kind === 'fault') setLoaded({ state: 'fault', message: outcome.fault });
    });
    return () => {
      stillWanted = false;
    };
  }, [callOperation, runSlug, scene.id, scene.recordWords, key]);

  if (scene.recordWords === 0) return <KeptText text="" emptyWords={NOTHING_BEYOND_THE_SUMMARY} />;
  if (alreadyFetched !== undefined) return <KeptText text={alreadyFetched} emptyWords={NOTHING_BEYOND_THE_SUMMARY} />;
  // The answer is checked against the take shown, so the take opened before never shows here.
  if (loaded.state === 'answer' && loaded.answer.sceneId === scene.id) return <KeptText text={loaded.answer.record} emptyWords={NOTHING_BEYOND_THE_SUMMARY} />;
  if (loaded.state === 'loading' || loaded.state === 'answer') return <p className="quiet" role="status">Loading the scene…</p>;
  if (loaded.state === 'refusal') return <p className="refusal" role="alert">{loaded.message}</p>;
  return <p className="refusal" role="alert">The scene’s text could not be read: {loaded.message}</p>;
}
