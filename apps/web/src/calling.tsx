import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AnswerByOperation, OperationName, RequestOf } from '@timeweft/contract';
import type { CallOperation } from './api.ts';

/** The page's way to call an operation. A 401 is handled where this is provided. */
export const CallOperationContext = createContext<CallOperation | null>(null);

export function useCallOperation(): CallOperation {
  const callOperation = useContext(CallOperationContext);
  if (callOperation === null) throw new Error('useCallOperation is used outside the access gate.');
  return callOperation;
}

export type Loaded<Answer> =
  | { state: 'loading' }
  | { state: 'answer'; answer: Answer }
  | { state: 'refusal'; message: string }
  | { state: 'fault'; message: string };

/**
 * Calls a reading operation when the page opens and whenever the input changes, and hands back
 * a way to read it again. The input is compared by its JSON so a fresh object each render is fine.
 */
export function useOperation<Name extends OperationName>(
  name: Name,
  input: RequestOf<Name>,
): { loaded: Loaded<AnswerByOperation[Name]>; readAgain: () => void } {
  const callOperation = useCallOperation();
  const [loaded, setLoaded] = useState<Loaded<AnswerByOperation[Name]>>({ state: 'loading' });
  const [readingNumber, setReadingNumber] = useState(0);
  const inputKey = JSON.stringify(input);

  useEffect(() => {
    let stillWanted = true;
    callOperation(name, JSON.parse(inputKey) as RequestOf<Name>).then((outcome) => {
      if (!stillWanted) return;
      if (outcome.kind === 'answer') setLoaded({ state: 'answer', answer: outcome.answer });
      else if (outcome.kind === 'refusal') setLoaded({ state: 'refusal', message: outcome.refusal });
      else if (outcome.kind === 'fault') setLoaded({ state: 'fault', message: outcome.fault });
      // An access refusal is answered by the gate asking for the token; nothing to draw here.
    });
    return () => {
      stillWanted = false;
    };
  }, [callOperation, name, inputKey, readingNumber]);

  const readAgain = useCallback(() => setReadingNumber((number) => number + 1), []);
  return { loaded, readAgain };
}

/** What every page draws while it waits or after the server said no. */
export function LoadedMessage({ loaded }: { loaded: Loaded<unknown> }) {
  if (loaded.state === 'loading') return <p className="quiet" role="status">Reading…</p>;
  if (loaded.state === 'refusal') return <p className="refusal" role="alert">{loaded.message}</p>;
  if (loaded.state === 'fault') return <p className="refusal" role="alert">Something went wrong: {loaded.message}</p>;
  return null;
}
