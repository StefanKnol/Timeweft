/**
 * The one place the run page says what an act did: a notice fixed at the foot of the screen, so
 * the author sees it wherever they are looking, and only the latest one.
 *
 * A plain notice goes after a few seconds, at the next act or when the author moves to another
 * part of the run. One that holds a link, or something the author should know besides, stays
 * until it is dismissed or replaced. Either is kept while the pointer is over it or focus is in it.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode,
} from 'react';
import type { RunOutline } from '@timeweft/contract';
import {
  NOTICE_PLAIN_STAYS_MILLISECONDS, cautionInWords, noticeAfter, noticeStaysUntilDismissed, type Notice, type NoticeEvent, type NoticeState,
} from './shaping.ts';

export interface Notices {
  /** Says what an act did. Where `focusTheNotice` is set, focus moves to the notice once it is drawn. */
  show: (notice: Notice, focusTheNotice: boolean) => void;
  /** An act was sent: a plain notice from the act before goes. */
  actStarted: () => void;
  /** A caution from the store in the words the page says it in. */
  cautionInWords: (caution: string) => string;
}

const NoticesContext = createContext<Notices | null>(null);

export function useNotices(): Notices {
  const notices = useContext(NoticesContext);
  if (notices === null) throw new Error('useNotices is used outside the run page.');
  return notices;
}

/** Holds the notice for everything inside it, and draws the notice area after it. */
export function NoticeProvider({ snapshot, children }: { snapshot: RunOutline | null; children: ReactNode }) {
  const [state, dispatch] = useReducer(noticeAfter, null);
  // The cautions are put in words against the run as it stood when the act was made.
  const snapshotReference = useRef(snapshot);
  snapshotReference.current = snapshot;

  useEffect(() => {
    const routeChanged = () => dispatch({ kind: 'route-changed' });
    window.addEventListener('hashchange', routeChanged);
    return () => window.removeEventListener('hashchange', routeChanged);
  }, []);

  const notices = useMemo<Notices>(() => ({
    show: (notice, focusTheNotice) => dispatch({ kind: 'act-done', notice, focusWhenShown: focusTheNotice }),
    actStarted: () => dispatch({ kind: 'act-started' }),
    cautionInWords: (caution) => (snapshotReference.current === null ? caution : cautionInWords(caution, snapshotReference.current)),
  }), []);

  return (
    <NoticesContext.Provider value={notices}>
      {children}
      <NoticeArea state={state} dispatch={dispatch} />
    </NoticesContext.Provider>
  );
}

function NoticeArea({ state, dispatch }: { state: NoticeState; dispatch: (event: NoticeEvent) => void }) {
  const noticeReference = useRef<HTMLDivElement>(null);
  const [pointerOver, setPointerOver] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const held = pointerOver || focusInside;
  const number = state?.number ?? null;
  const stays = state !== null && noticeStaysUntilDismissed(state.notice);

  useEffect(() => {
    if (state === null || !state.focusWhenShown) return;
    noticeReference.current?.focus();
    dispatch({ kind: 'focus-moved' });
  }, [state, dispatch]);

  // A plain notice goes by itself, counted afresh each time the pointer or focus leaves it.
  useEffect(() => {
    if (number === null || stays || held) return undefined;
    const timer = window.setTimeout(() => dispatch({ kind: 'time-passed', number }), NOTICE_PLAIN_STAYS_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [number, stays, held, dispatch]);

  // A notice taken away takes the pointer and focus it held with it.
  useEffect(() => {
    if (number !== null) return;
    setPointerOver(false);
    setFocusInside(false);
  }, [number]);

  const dismiss = useCallback(() => {
    const focusWasInside = noticeReference.current?.contains(document.activeElement) ?? false;
    dispatch({ kind: 'dismissed' });
    // Focus is not left on nothing: it goes to the section's heading, or to the page.
    if (focusWasInside) (document.getElementById('section-heading') ?? document.getElementById('page-content'))?.focus();
  }, [dispatch]);

  return (
    <div className="notice-area" role="status" aria-live="polite">
      {state !== null && (
        <div
          key={state.number}
          ref={noticeReference}
          className="notice"
          tabIndex={-1}
          onPointerEnter={() => setPointerOver(true)}
          onPointerLeave={() => setPointerOver(false)}
          onFocus={() => setFocusInside(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false);
          }}
        >
          <div className="notice-words">
            <p>
              {state.notice.words}
              {state.notice.link !== null && (
                <>
                  {' '}<span aria-hidden="true">·</span>{' '}
                  <a href={state.notice.link.href}>{state.notice.link.words}</a>
                </>
              )}
            </p>
            {state.notice.cautions.map((caution) => <p key={caution} className="attention">{caution}</p>)}
          </div>
          <button type="button" className="notice-dismiss" aria-label="Dismiss this notice" onClick={dismiss}>×</button>
        </div>
      )}
    </div>
  );
}
