import { useEffect, useId, useRef, useState } from 'react';
import type { RunOutline } from '@timeweft/contract';
import { ActMessage, itemElementId, useAct, useScrollToShownItem } from './authoring.tsx';
import { collisionStateInWords, collisionsWithBothSides, hashOfRoute, settleCollisionQuestion, type CollisionAsDrawn } from './shaping.ts';

export function CollisionsSection({ snapshot, shownItemId, readAgain }: { snapshot: RunOutline; shownItemId: string | null; readAgain: () => void }) {
  const { waiting, settled } = collisionsWithBothSides(snapshot);
  useScrollToShownItem(shownItemId);
  return (
    <>
      <p>A story tried to replace something the author stated. The author&apos;s fact stands until it is decided here.</p>
      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 ? <p className="quiet">Nothing is waiting.</p> : (
        <ul className="plain-list">
          {waiting.map((item) => <li key={item.collision.id}><CollisionCard item={item} snapshot={snapshot} shown={item.collision.id === shownItemId} readAgain={readAgain} /></li>)}
        </ul>
      )}
      {settled.length > 0 && (
        <>
          <h3>Settled ({settled.length})</h3>
          <ul className="plain-list">
            {settled.map((item) => <li key={item.collision.id}><CollisionCard item={item} snapshot={snapshot} shown={item.collision.id === shownItemId} readAgain={readAgain} /></li>)}
          </ul>
        </>
      )}
    </>
  );
}

function CollisionCard({ item, snapshot, shown, readAgain }: { item: CollisionAsDrawn; snapshot: RunOutline; shown: boolean; readAgain: () => void }) {
  const { actState, busy, act } = useAct(readAgain);
  const isWaiting = item.collision.state === 'waiting';
  const settle = (take: 'author' | 'story') => void act('settle_collision', { collision: item.collision.id, take }, {
    words: take === 'author'
      ? `Kept the author's fact for ${item.entryName}'s ${item.property}.`
      : `Took the story's fact for ${item.entryName}'s ${item.property}.`,
    link: { href: hashOfRoute({ page: 'run', slug: snapshot.run.slug, section: 'collisions', itemId: item.collision.id }), words: 'Show it' },
    // The card moves from Waiting to Settled, and its buttons go.
    focusTheNotice: true,
  });

  return (
    <div className={shown ? 'card item-shown' : 'card'} id={itemElementId(item.collision.id)} tabIndex={-1}>
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
      {isWaiting && <SettleButtons item={item} busy={busy} onSettle={settle} />}
      <ActMessage actState={actState} />
    </div>
  );
}

/**
 * The two ways to settle, each asked once more before it acts: the first press puts the question
 * naming both values, with only that answer and "Not now" beside it; the second settles. Focus
 * goes to the answer while it asks, and back to the first button after "Not now".
 */
function SettleButtons({ item, busy, onSettle }: { item: CollisionAsDrawn; busy: boolean; onSettle: (take: 'author' | 'story') => void }) {
  const [asking, setAsking] = useState<'author' | 'story' | null>(null);
  const questionId = useId();
  const firstButton = useRef<HTMLButtonElement>(null);
  const answerButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking !== null) answerButton.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      firstButton.current?.focus();
    }
  }, [asking]);
  const labelOf = (take: 'author' | 'story') => (take === 'author' ? 'Keep mine' : "Take the story's");
  if (asking === null) {
    return (
      <div className="button-row">
        <button ref={firstButton} type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) setAsking('author'); }}>{labelOf('author')}</button>
        <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) setAsking('story'); }}>{labelOf('story')}</button>
      </div>
    );
  }
  return (
    <div className="confirming" role="group" aria-label={labelOf(asking)}>
      <p id={questionId}>{settleCollisionQuestion(item, asking)}</p>
      <div className="button-row">
        <button
          ref={answerButton} type="button" aria-disabled={busy || undefined} aria-describedby={questionId}
          onClick={() => {
            if (busy) return;
            const take = asking;
            setAsking(null);
            onSettle(take);
          }}
        >
          {labelOf(asking)}
        </button>
        <button type="button" className="quiet-button" onClick={() => { returnFocus.current = true; setAsking(null); }}>Not now</button>
      </div>
    </div>
  );
}
