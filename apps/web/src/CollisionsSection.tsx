import { useState } from 'react';
import type { RunSnapshot } from '@timeweft/contract';
import { useCallOperation } from './calling.tsx';
import { collisionStateInWords, collisionsWithBothSides, type CollisionAsDrawn } from './shaping.ts';

export function CollisionsSection({ snapshot, readAgain }: { snapshot: RunSnapshot; readAgain: () => void }) {
  const { waiting, settled } = collisionsWithBothSides(snapshot);
  return (
    <>
      <p>A story tried to replace something the author stated. The author&apos;s fact stands until it is decided here.</p>
      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 ? <p className="quiet">Nothing is waiting.</p> : (
        <ul className="plain-list">
          {waiting.map((item) => <li key={item.collision.id}><CollisionCard item={item} readAgain={readAgain} /></li>)}
        </ul>
      )}
      {settled.length > 0 && (
        <>
          <h3>Settled ({settled.length})</h3>
          <ul className="plain-list">
            {settled.map((item) => <li key={item.collision.id}><CollisionCard item={item} readAgain={readAgain} /></li>)}
          </ul>
        </>
      )}
    </>
  );
}

function CollisionCard({ item, readAgain }: { item: CollisionAsDrawn; readAgain: () => void }) {
  const callOperation = useCallOperation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const isWaiting = item.collision.state === 'waiting';

  async function settle(take: 'author' | 'story') {
    setBusy(true);
    setMessage('');
    const outcome = await callOperation('settle_collision', { collision: item.collision.id, take });
    setBusy(false);
    if (outcome.kind === 'answer') readAgain();
    else if (outcome.kind === 'refusal') setMessage(outcome.refusal);
    else if (outcome.kind === 'fault') setMessage(`Something went wrong: ${outcome.fault}`);
  }

  return (
    <div className="card">
      <h4 className="card-title">{item.entryName}, {item.property}</h4>
      <p className="quiet">{item.sceneNumber === null ? 'Outside a scene.' : `At scene ${item.sceneNumber}.`} {collisionStateInWords(item.collision)}</p>
      <div className="two-sides">
        <div>
          <h5>The author&apos;s fact</h5>
          <p>{item.authorsValue ?? 'The store no longer holds it.'}{item.authorsAboutName !== null && ` (${item.authorsAboutName})`}</p>
        </div>
        <div>
          <h5>The story&apos;s</h5>
          <p>{item.storysValue}{item.storysAboutName !== null && ` (${item.storysAboutName})`}</p>
        </div>
      </div>
      {isWaiting && (
        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => void settle('author')}>Keep mine</button>
          <button type="button" disabled={busy} onClick={() => void settle('story')}>Take the story&apos;s</button>
        </div>
      )}
      {message !== '' && <p className="refusal" role="alert">{message}</p>}
    </div>
  );
}
