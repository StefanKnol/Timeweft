/**
 * What every form of the author's hand shares: calling a writing operation, saying what came of
 * it, and asking once more before a lasting act.
 *
 * A form keeps what was typed after a refusal, since the author will want to change a word and
 * press again; it clears only after the server took it. After an answer the run is read again, so
 * every section draws what the store now holds.
 */
import { useCallback, useId, useState } from 'react';
import type { AnswerByOperation, OperationName, RequestOf } from '@timeweft/contract';
import { useCallOperation } from './calling.tsx';
import { cautionsOfAnswer } from './shaping.ts';

export type ActState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'refused'; message: string }
  | { state: 'done'; cautions: string[] };

export interface Act {
  actState: ActState;
  busy: boolean;
  /** Calls the operation; true where the server took it. */
  act: <Name extends OperationName>(name: Name, input: RequestOf<Name>) => Promise<boolean>;
  /** Shows a reason the form found itself, before anything is sent. */
  refuse: (message: string) => void;
  /** Takes down what was said, once it no longer answers anything on screen. */
  clear: () => void;
}

/** One writing call and what came of it. `readAgain` is called after every answer. */
export function useAct(readAgain: () => void): Act {
  const callOperation = useCallOperation();
  const [actState, setActState] = useState<ActState>({ state: 'idle' });
  const act = useCallback(async <Name extends OperationName>(name: Name, input: RequestOf<Name>): Promise<boolean> => {
    setActState({ state: 'running' });
    const outcome = await callOperation(name, input);
    if (outcome.kind === 'answer') {
      setActState({ state: 'done', cautions: cautionsOfAnswer(outcome.answer as AnswerByOperation[Name]) });
      readAgain();
      return true;
    }
    if (outcome.kind === 'refusal') setActState({ state: 'refused', message: outcome.refusal });
    else if (outcome.kind === 'fault') setActState({ state: 'refused', message: `Something went wrong: ${outcome.fault}` });
    else setActState({ state: 'idle' });
    return false;
  }, [callOperation, readAgain]);
  const refuse = useCallback((message: string) => setActState({ state: 'refused', message }), []);
  const clear = useCallback(() => setActState({ state: 'idle' }), []);
  return { actState, busy: actState.state === 'running', act, refuse, clear };
}

/** The server's refusal as it said it, or a short word that it was saved, with any cautions. */
export function ActMessage({ actState, doneWords = 'Saved.' }: { actState: ActState; doneWords?: string }) {
  if (actState.state === 'running') return <p className="quiet" role="status">Saving…</p>;
  if (actState.state === 'refused') return <p className="refusal" role="alert">{actState.message}</p>;
  if (actState.state === 'done') {
    return (
      <div role="status">
        <p className="quiet">{doneWords}</p>
        {actState.cautions.map((caution) => <p key={caution} className="attention">{caution}</p>)}
      </div>
    );
  }
  return null;
}

/**
 * A button for a lasting act. The first press says in one line what the act does and that nothing
 * is deleted, and offers to go on or not; only the second press acts. Where the act cannot be made
 * yet, the reason is said and the button is not offered.
 */
export function ConfirmingButton({ label, confirmLabel, explanation, whyNot, busy, onConfirm }: {
  label: string;
  confirmLabel: string;
  explanation: string;
  whyNot: string | null;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const explanationId = useId();
  if (whyNot !== null) return <p className="quiet field-hint">{label}: {whyNot}</p>;
  if (!asking) {
    return <button type="button" className="quiet-button" disabled={busy} onClick={() => setAsking(true)}>{label}</button>;
  }
  return (
    <div className="confirming" role="group" aria-label={label}>
      <p id={explanationId}>{explanation}</p>
      <div className="button-row">
        <button
          type="button" disabled={busy} aria-describedby={explanationId}
          onClick={() => { setAsking(false); onConfirm(); }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="quiet-button" onClick={() => setAsking(false)}>Not now</button>
      </div>
    </div>
  );
}
