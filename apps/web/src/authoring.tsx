/**
 * What every form of the author's hand shares: calling a writing operation, saying what came of
 * it, and asking once more before a lasting act.
 *
 * What an act did is said in the one notice at the foot of the page (`NoticeArea.tsx`), where the
 * author sees it wherever they are looking. A refusal is said beside the form it answers, keeps
 * what was typed so a word can be changed and the act pressed again, and goes as soon as the form
 * is edited. After an answer the run is read again, so every section draws what the store now
 * holds; forms are not drawn afresh, so focus stays where it was.
 */
import { useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import type { AnswerByOperation, OperationName, RequestOf } from '@timeweft/contract';
import { useCallOperation } from './calling.tsx';
import { useNotices } from './NoticeArea.tsx';
import { actStateAfter, cautionsOfAnswer, type ActState, type NoticeLink } from './shaping.ts';

export type { ActState } from './shaping.ts';

/** What the notice says after the server took an act. */
export interface ActReport {
  words: string;
  /** Where the item the act touched now is, where it moved out of sight. */
  link?: NoticeLink | null;
  /**
   * Set where the form or button that made the act leaves the page with the item (a thread closed,
   * a waypoint reached), so focus goes to the notice rather than to nothing.
   */
  focusTheNotice?: boolean;
}

export interface Act {
  actState: ActState;
  busy: boolean;
  /**
   * Calls the operation; true where the server took it. `report` says what the notice says,
   * worked out from the answer where it needs something only the answer holds (a new id).
   */
  act: <Name extends OperationName>(
    name: Name,
    input: RequestOf<Name>,
    report: ActReport | ((answer: AnswerByOperation[Name]) => ActReport),
  ) => Promise<boolean>;
  /** Shows a reason the form found itself, before anything is sent. */
  refuse: (message: string) => void;
  /** The form was edited: a refusal beside it no longer answers what is in it, so it goes. */
  edited: () => void;
}

/** One writing call and what came of it. `readAgain` is called after every answer. */
export function useAct(readAgain: () => void): Act {
  const callOperation = useCallOperation();
  const notices = useNotices();
  const [actState, dispatch] = useReducer(actStateAfter, { state: 'idle' });
  // Buttons are not disabled while an act runs, since a disabled button drops focus; a second
  // press is ignored here instead.
  const running = useRef(false);
  const act = useCallback(async <Name extends OperationName>(
    name: Name,
    input: RequestOf<Name>,
    report: ActReport | ((answer: AnswerByOperation[Name]) => ActReport),
  ): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    dispatch({ kind: 'started' });
    notices.actStarted();
    const outcome = await callOperation(name, input);
    running.current = false;
    if (outcome.kind === 'answer') {
      const answer = outcome.answer as AnswerByOperation[Name];
      const said = typeof report === 'function' ? report(answer) : report;
      dispatch({ kind: 'taken' });
      notices.show(
        { words: said.words, link: said.link ?? null, cautions: cautionsOfAnswer(answer).map(notices.cautionInWords) },
        said.focusTheNotice ?? false,
      );
      readAgain();
      return true;
    }
    if (outcome.kind === 'refusal') dispatch({ kind: 'refused', message: outcome.refusal });
    else if (outcome.kind === 'fault') dispatch({ kind: 'refused', message: `Something went wrong: ${outcome.fault}` });
    else dispatch({ kind: 'not-sent' });
    return false;
  }, [callOperation, notices, readAgain]);
  const refuse = useCallback((message: string) => dispatch({ kind: 'refused', message }), []);
  const edited = useCallback(() => dispatch({ kind: 'edited' }), []);
  return { actState, busy: actState.state === 'running', act, refuse, edited };
}

/** Beside a form: "Saving…" while it is sent, or why the server or the form said no. */
export function ActMessage({ actState }: { actState: ActState }) {
  if (actState.state === 'running') return <p className="quiet">Saving…</p>;
  if (actState.state === 'refused') return <p className="refusal" role="alert">{actState.message}</p>;
  return null;
}

/**
 * A fold holding a form that changes something already written: rename, reword, change details.
 * The form is drawn only while the fold is open, so each opening starts from what the store now
 * holds. `close` folds it again and puts focus on its summary, where the new value is in view.
 */
export function EditFold({ summary, onClosed, children }: {
  summary: string;
  onClosed?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const summaryReference = useRef<HTMLElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    summaryReference.current?.focus();
  }, []);
  return (
    <details
      className="author-form" open={open}
      onToggle={(event) => {
        const nowOpen = event.currentTarget.open;
        setOpen(nowOpen);
        if (!nowOpen) onClosed?.();
      }}
    >
      <summary ref={summaryReference}>{summary}</summary>
      {open && children(close)}
    </details>
  );
}

/**
 * A button for a lasting act. The first press says in one line what the act does and offers to
 * go on or not; only the second press acts. Focus goes to the button that acts while it asks, and
 * back to the first button after. Where the act cannot be made yet, the reason is said and the
 * button is not offered.
 */
export function ConfirmingButton({ label, confirmLabel, explanation, whyNot, busy, onConfirm, buttonClassName = 'quiet-button' }: {
  label: string;
  confirmLabel: string;
  explanation: string;
  whyNot: string | null;
  busy: boolean;
  onConfirm: () => void;
  buttonClassName?: string;
}) {
  const [asking, setAsking] = useState(false);
  const explanationId = useId();
  const openingButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  // Set when the asking ends by a press, so focus returns to the opening button once it is drawn.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking) {
      confirmButton.current?.focus();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      openingButton.current?.focus();
    }
  }, [asking]);
  const stopAsking = () => {
    returnFocus.current = true;
    setAsking(false);
  };
  if (whyNot !== null) return <p className="quiet field-hint">{label}: {whyNot}</p>;
  if (!asking) {
    return (
      <button
        ref={openingButton} type="button" className={buttonClassName} aria-disabled={busy || undefined}
        onClick={() => { if (!busy) setAsking(true); }}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="confirming" role="group" aria-label={label}>
      <p id={explanationId}>{explanation}</p>
      <div className="button-row">
        <button
          ref={confirmButton} type="button" aria-disabled={busy || undefined} aria-describedby={explanationId}
          onClick={() => {
            if (busy) return;
            stopAsking();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="quiet-button" onClick={stopAsking}>Not now</button>
      </div>
    </div>
  );
}

/** The id of the element an item's card carries, so a link to the item can scroll to it. */
export function itemElementId(itemId: string): string {
  return `item-${itemId}`;
}

/**
 * Scrolls to the item the address names and puts focus on it, once per item, as soon as it is
 * drawn (after an act it may be drawn only once the run is read again). Its card carries
 * `id={itemElementId(id)}` and `tabIndex={-1}`.
 */
export function useScrollToShownItem(shownItemId: string | null): void {
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (shownItemId === null) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === shownItemId) return;
    const element = document.getElementById(itemElementId(shownItemId));
    if (element === null) return;
    scrolledTo.current = shownItemId;
    element.scrollIntoView({ block: 'center' });
    element.focus({ preventScroll: true });
  });
}
