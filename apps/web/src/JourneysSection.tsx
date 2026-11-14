import { useId, useState, type ReactNode } from 'react';
import type { RunSnapshot } from '@timeweft/contract';
import { ActMessage, ConfirmingButton, useAct, type Act } from './authoring.tsx';
import {
  changedWhenInWords, hashOfRoute, journeysInSceneOrder, lastingActInWords, standingSceneNumbers, typedTextOrReason,
  waypointMoveInWords, waypointsAheadFirst, whyAnActNeedsAScene, type JourneyAsDrawn, type WaypointMove, type WaypointAsDrawn,
} from './shaping.ts';

/**
 * The scenes the author wants the run to reach, and the journeys travelled so far. Both are in
 * the snapshot; this is the one page that draws them whole, and the one place the author sets,
 * rewords, marks reached and withdraws a waypoint.
 */
export function JourneysSection({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const { ahead, reached, withdrawn } = waypointsAheadFirst(snapshot);
  const { travelled, inStruckTakes } = journeysInSceneOrder(snapshot);
  // Marking reached and withdrawing move a waypoint to another list, so what came of them is said
  // here, naming the waypoint and where it went.
  const move = useAct(readAgain);
  const [lastMove, setLastMove] = useState<WaypointMove | null>(null);
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
      <p className="quiet">Scenes the author wants the run to reach. A story steers towards them and never narrates them.</p>
      <AddWaypointForm runSlug={snapshot.run.slug} readAgain={readAgain} />
      <ActMessage actState={move.actState} doneWords={lastMove === null ? 'Saved.' : waypointMoveInWords(lastMove)} />
      {ahead.length === 0 ? <p className="quiet">Nothing is left to reach.</p> : (
        <ul className="plain-list">
          {ahead.map((item) => (
            <li key={item.waypoint.id} className="card">
              <WaypointCard item={item} snapshot={snapshot} readAgain={readAgain} move={move} onMoved={setLastMove} />
            </li>
          ))}
        </ul>
      )}
      <h3>Waypoints reached ({reached.length})</h3>
      {reached.length === 0 ? <p className="quiet">No waypoint has been reached yet.</p> : (
        <ul className="plain-list">
          {reached.map((item) => (
            <li key={item.waypoint.id} className="card">
              <WaypointCard item={item} snapshot={snapshot} readAgain={readAgain} move={move} onMoved={setLastMove} reachedWords={<>Reached at {sceneWords(item.reachedInSceneNumber)}.</>} />
            </li>
          ))}
        </ul>
      )}
      {withdrawn.length > 0 && (
        <details className="struck-takes">
          <summary>{withdrawn.length === 1 ? '1 waypoint withdrawn' : `${withdrawn.length} waypoints withdrawn`}</summary>
          <ul className="plain-list">
            {withdrawn.map((item) => (
              <li key={item.waypoint.id} className="struck">
                <p><s>{item.waypoint.text}</s></p>
                <p className="quiet">
                  Withdrawn {item.withdrawnInSceneNumber === null ? 'before the scenes' : `at scene ${item.withdrawnInSceneNumber}`}
                  {item.reachedInSceneNumber !== null && `, after it was reached at scene ${item.reachedInSceneNumber}`}. Never told to a story again.
                </p>
                <EarlierWordings item={item} />
              </li>
            ))}
          </ul>
        </details>
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

function AddWaypointForm({ runSlug, readAgain }: { runSlug: string; readAgain: () => void }) {
  const textId = useId();
  const [text, setText] = useState('');
  const { actState, busy, act, refuse } = useAct(readAgain);
  const add = async () => {
    const toSend = typedTextOrReason(text, 'the scene to reach');
    if (!toSend.ok) return refuse(toSend.reason);
    if (await act('add_waypoint', { run: runSlug, text: toSend.input })) setText('');
  };
  return (
    <details className="author-form">
      <summary>Add a waypoint</summary>
      <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <label htmlFor={textId}>The scene to reach, in a sentence or two</label>
        <textarea id={textId} rows={2} value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit" disabled={busy}>Add the waypoint</button>
        <ActMessage actState={actState} doneWords="Added." />
      </form>
    </details>
  );
}

function EarlierWordings({ item }: { item: WaypointAsDrawn }) {
  const [showing, setShowing] = useState(false);
  const checkboxId = useId();
  if (item.earlierWordings.length === 0) return null;
  return (
    <>
      <p>
        <input id={checkboxId} type="checkbox" checked={showing} onChange={(event) => setShowing(event.target.checked)} />{' '}
        <label htmlFor={checkboxId}>Show history ({item.earlierWordings.length} earlier {item.earlierWordings.length === 1 ? 'wording' : 'wordings'})</label>
      </p>
      {showing && (
        <ol className="history-list" aria-label="Earlier wordings, oldest first">
          {item.earlierWordings.map((wording, index) => (
            <li key={index}><q>{wording.text}</q> <span className="quiet">(changed {changedWhenInWords(wording.changedAfterSceneNumber)})</span></li>
          ))}
        </ol>
      )}
    </>
  );
}

function WaypointCard({ item, snapshot, readAgain, move, onMoved, reachedWords }: {
  item: WaypointAsDrawn;
  snapshot: RunSnapshot;
  readAgain: () => void;
  move: Act;
  onMoved: (moved: WaypointMove) => void;
  reachedWords?: ReactNode;
}) {
  const { busy, act } = move;
  const rewording = useAct(readAgain);
  const isAhead = item.reachedInSceneNumber === null;
  return (
    <>
      <p>{item.waypoint.text}</p>
      {reachedWords !== undefined && <p className="quiet">{reachedWords}</p>}
      <EarlierWordings item={item} />
      <details className="author-form">
        <summary>Reword it</summary>
        {/* Keyed by the words, so after a save the box starts from the new ones. */}
        <RewordForm key={item.waypoint.text} item={item} rewording={rewording} />
        <ActMessage actState={rewording.actState} />
      </details>
      {isAhead && <MarkReachedForm item={item} snapshot={snapshot} move={move} onMoved={onMoved} />}
      <ConfirmingButton
        label="Withdraw it" confirmLabel="Withdraw the waypoint"
        explanation={lastingActInWords('withdraw-waypoint', snapshot)}
        whyNot={whyAnActNeedsAScene(snapshot)} busy={busy}
        onConfirm={() => {
          // Said before the call, so the line under the add form names this move the moment it is done.
          onMoved({ kind: 'withdrawn', text: item.waypoint.text });
          void act('withdraw_waypoint', { waypoint: item.waypoint.id });
        }}
      />
    </>
  );
}

function RewordForm({ item, rewording }: { item: WaypointAsDrawn; rewording: Act }) {
  const textId = useId();
  const [text, setText] = useState(item.waypoint.text);
  const { busy, act, refuse } = rewording;
  const reword = async () => {
    const toSend = typedTextOrReason(text, 'the new words');
    if (!toSend.ok) return refuse(toSend.reason);
    await act('reword_waypoint', { waypoint: item.waypoint.id, text: toSend.input });
  };
  return (
    <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void reword(); }}>
      <label htmlFor={textId}>New words for this waypoint</label>
      <textarea id={textId} rows={2} value={text} onChange={(event) => setText(event.target.value)} />
      <p className="quiet field-hint">What it said before is kept as history.</p>
      <button type="submit" disabled={busy}>Save the new words</button>
    </form>
  );
}

function MarkReachedForm({ item, snapshot, move, onMoved }: { item: WaypointAsDrawn; snapshot: RunSnapshot; move: Act; onMoved: (moved: WaypointMove) => void }) {
  const selectId = useId();
  const numbers = standingSceneNumbers(snapshot);
  const newestNumber = numbers.at(-1);
  const [sceneNumber, setSceneNumber] = useState<number | null>(null);
  const { busy, act } = move;
  if (newestNumber === undefined) return <p className="quiet field-hint">It can be marked reached once a scene is saved.</p>;
  // The newest standing scene is offered first; a choice the run no longer has falls back to it.
  const chosen = sceneNumber !== null && numbers.includes(sceneNumber) ? sceneNumber : newestNumber;
  return (
    <form className="inline-form" onSubmit={(event) => {
      event.preventDefault();
      onMoved({ kind: 'reached', text: item.waypoint.text, sceneNumber: chosen });
      void act('mark_waypoint_reached', { waypoint: item.waypoint.id, scene: chosen });
    }}>
      <label htmlFor={selectId}>Reached at scene</label>
      <select id={selectId} value={chosen} onChange={(event) => setSceneNumber(Number(event.target.value))}>
        {numbers.map((number) => <option key={number} value={number}>{number}</option>)}
      </select>
      <button type="submit" className="quiet-button" disabled={busy}>Mark it reached</button>
    </form>
  );
}
