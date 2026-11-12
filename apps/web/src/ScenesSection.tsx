import { useEffect, useRef } from 'react';
import type { RunSnapshot, SceneRecord } from '@timeweft/contract';
import { AuthorOnlyMark, KeptText } from './marks.tsx';
import {
  hashOfRoute, heldSpanInWords, readingsWithClockNames, sceneNumbersById,
  scenesByNumber, whatASceneEstablished,
} from './shaping.ts';

export function ScenesSection({ snapshot, selectedSceneId }: { snapshot: RunSnapshot; selectedSceneId: string | null }) {
  const slots = scenesByNumber(snapshot.scenes);
  const selectedScene = selectedSceneId === null ? null : snapshot.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const linkTo = (sceneId: string | null) => hashOfRoute({ page: 'run', slug: snapshot.run.slug, section: 'scenes', itemId: sceneId });

  if (selectedScene !== null) {
    return (
      <>
        <p><a href={linkTo(null)}>All scenes</a></p>
        <SceneInFull scene={selectedScene} snapshot={snapshot} />
      </>
    );
  }
  if (selectedSceneId !== null) {
    return <p className="refusal" role="alert">This run holds no scene with that id. <a href={linkTo(null)}>All scenes</a></p>;
  }
  if (slots.length === 0) return <p>No scenes have been saved yet.</p>;

  return (
    <ol className="plain-list">
      {slots.map((slot) => (
        <li key={slot.number} className="card">
          {slot.standing === null ? (
            <p className="quiet">Scene {slot.number}: every take was struck.</p>
          ) : (
            <SceneLine scene={slot.standing} href={linkTo(slot.standing.id)} />
          )}
          {slot.struck.length > 0 && (
            <details className="struck-takes">
              <summary>{slot.struck.length === 1 ? '1 struck take' : `${slot.struck.length} struck takes`}</summary>
              <ul className="plain-list">
                {slot.struck.map((scene) => (
                  <li key={scene.id} className="struck">
                    <SceneLine scene={scene} href={linkTo(scene.id)} nested />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function SceneLine({ scene, href, nested = false }: { scene: SceneRecord; href: string; nested?: boolean }) {
  // A struck take sits inside its number's card, so its heading is one level down.
  const Heading = nested ? 'h4' : 'h3';
  const isStruck = scene.status === 'struck';
  const title = `${scene.number}. ${scene.title}`;
  return (
    <>
      <Heading className="card-title">
        <a href={href}>{isStruck ? <s>{title}</s> : title}</a>
        {isStruck && <span className="quiet"> (struck)</span>}
        {scene.starred && <span className="star"><span aria-hidden="true"> ★</span><span className="visually-hidden"> starred</span></span>}
      </Heading>
      <p className="quiet">{scene.whenTyped}</p>
      <p>{isStruck ? <s>{scene.summary}</s> : scene.summary}</p>
    </>
  );
}

function SceneInFull({ scene, snapshot }: { scene: SceneRecord; snapshot: RunSnapshot }) {
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
      <h4>Record</h4>
      <KeptText text={scene.record} emptyWords="No record beyond the summary." />
      <h4>Steer</h4>
      <KeptText text={scene.steer} emptyWords="The author steered nothing at this scene." />
      <h4>Where things stood after</h4>
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
      {established.threadsClosed.length > 0 && (
        <>
          <h5>Threads closed</h5>
          <ul>{established.threadsClosed.map((thread) => <li key={thread.id}>{thread.text}: {thread.resolution}</li>)}</ul>
        </>
      )}
      {Object.values(established).every((items) => items.length === 0) && <p className="quiet">Nothing recorded as established here.</p>}
    </div>
  );
}
