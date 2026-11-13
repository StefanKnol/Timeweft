import type { RunSnapshot } from '@timeweft/contract';
import { hashOfRoute, journeysInSceneOrder, waypointsAheadFirst, type JourneyAsDrawn } from './shaping.ts';

/**
 * The scenes the author wants the run to reach, and the journeys travelled so far. Both are in
 * the snapshot; this is the one page that draws them whole.
 */
export function JourneysSection({ snapshot }: { snapshot: RunSnapshot }) {
  const { ahead, reached } = waypointsAheadFirst(snapshot);
  const { travelled, inStruckTakes } = journeysInSceneOrder(snapshot);
  const sceneLink = (sceneNumber: number) => {
    const scene = snapshot.scenes.find((candidate) => candidate.number === sceneNumber && candidate.status === 'standing');
    return scene === undefined ? null : hashOfRoute({ page: 'run', slug: snapshot.run.slug, section: 'scenes', itemId: scene.id });
  };
  const sceneWords = (sceneNumber: number | null) => {
    if (sceneNumber === null) return 'before the scenes';
    const link = sceneLink(sceneNumber);
    return link === null ? `scene ${sceneNumber}` : <a href={link}>scene {sceneNumber}</a>;
  };
  const legLine = (item: JourneyAsDrawn) => (
    <>
      <p><strong>From {item.leg.fromPlace} to {item.leg.toPlace}</strong>: {item.leg.duration}</p>
      {item.leg.note !== '' && <p>{item.leg.note}</p>}
      <p className="quiet">First travelled {sceneWords(item.sceneNumber)}.</p>
    </>
  );
  return (
    <>
      <h3>Waypoints ahead ({ahead.length})</h3>
      <p className="quiet">Scenes the author wants the run to reach. Never shown in the narration.</p>
      {ahead.length === 0 ? <p className="quiet">Nothing is left to reach.</p> : (
        <ul className="plain-list">
          {ahead.map((item) => <li key={item.waypoint.id} className="card"><p>{item.waypoint.text}</p></li>)}
        </ul>
      )}
      <h3>Waypoints reached ({reached.length})</h3>
      {reached.length === 0 ? <p className="quiet">No waypoint has been reached yet.</p> : (
        <ul className="plain-list">
          {reached.map((item) => (
            <li key={item.waypoint.id} className="card">
              <p>{item.waypoint.text}</p>
              <p className="quiet">Reached at {sceneWords(item.reachedInSceneNumber)}.</p>
            </li>
          ))}
        </ul>
      )}
      <h3>Journeys ({travelled.length})</h3>
      {travelled.length === 0 ? <p className="quiet">No journey has been recorded yet.</p> : (
        <ul className="plain-list">
          {travelled.map((item) => <li key={item.leg.id} className="card">{legLine(item)}</li>)}
        </ul>
      )}
      {inStruckTakes.length > 0 && (
        <details className="struck-takes">
          <summary>{inStruckTakes.length === 1 ? '1 journey from a struck take' : `${inStruckTakes.length} journeys from struck takes`}</summary>
          <ul className="plain-list">
            {inStruckTakes.map((item) => (
              <li key={item.leg.id} className="struck">
                <p><s>From {item.leg.fromPlace} to {item.leg.toPlace}: {item.leg.duration}</s></p>
                <p className="quiet">In a struck take of scene {item.sceneNumber}, never served.</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
