import { useCallback, useEffect, useMemo, useState } from 'react';
import { callOperationWithToken, readStoredAccessToken, storeAccessToken, type CallOperation } from './api.ts';
import { CallOperationContext } from './calling.tsx';
import { routeFromHash, titleOfRoute, type Route } from './shaping.ts';
import { RunsPage } from './RunsPage.tsx';
import { RunPage, SECTION_HEADING_ID } from './RunPage.tsx';

export function App() {
  const [accessToken, setAccessToken] = useState<string | null>(readStoredAccessToken);
  const [accessNotice, setAccessNotice] = useState<string>('');
  const route = useHashRoute();

  const forgetToken = useCallback(() => {
    storeAccessToken(null);
    setAccessToken(null);
    setAccessNotice('The server did not accept that token. Enter it again.');
  }, []);

  const callOperation = useMemo<CallOperation | null>(() => {
    if (accessToken === null) return null;
    return async (name, input) => {
      const outcome = await callOperationWithToken(name, input, accessToken);
      if (outcome.kind === 'access-needed') forgetToken();
      return outcome;
    };
  }, [accessToken, forgetToken]);

  useEffect(() => {
    // A run's page names itself once it has read the run; every other page is named here.
    if (callOperation === null) document.title = 'Access token · Timeweft';
    else if (route.page === 'runs') document.title = titleOfRoute(route, null);
  }, [callOperation, route]);

  const forgetTokenByHand = () => {
    storeAccessToken(null);
    setAccessToken(null);
    setAccessNotice('');
  };

  return (
    <>
      <SkipLink onRunPage={callOperation !== null && route.page === 'run'} />
      <header className="masthead">
        <a className="masthead-name" href="#/runs">Timeweft</a>
        {callOperation !== null && route.page === 'run' && <a className="masthead-link" href="#/runs">All runs</a>}
      </header>
      <main className="page" id={PAGE_CONTENT_ID} tabIndex={-1}>
        {callOperation === null ? (
          <AccessForm
            notice={accessNotice}
            onToken={(token) => {
              storeAccessToken(token);
              setAccessToken(token);
              setAccessNotice('');
            }}
          />
        ) : (
          <CallOperationContext.Provider value={callOperation}>
            {route.page === 'runs' ? <RunsPage /> : <RunPage key={route.slug} route={route} />}
          </CallOperationContext.Provider>
        )}
      </main>
      {accessToken !== null && (
        <footer className="page-foot">
          <button type="button" className="quiet-button" onClick={forgetTokenByHand}>Forget token</button>
        </footer>
      )}
    </>
  );
}

const PAGE_CONTENT_ID = 'page-content';

/**
 * The first thing a keyboard reaches. The address after the `#` is the router's, so the link moves
 * focus by hand rather than by pointing its address at an id.
 */
function SkipLink({ onRunPage }: { onRunPage: boolean }) {
  return (
    <a
      className="skip-link"
      href={`#${PAGE_CONTENT_ID}`}
      onClick={(event) => {
        event.preventDefault();
        const target = document.getElementById(SECTION_HEADING_ID) ?? document.getElementById(PAGE_CONTENT_ID);
        if (target === null) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start' });
      }}
    >
      {onRunPage ? 'Skip to the section' : 'Skip to the page'}
    </a>
  );
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  useEffect(() => {
    const followHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);
  return route;
}

function AccessForm({ notice, onToken }: { notice: string; onToken: (token: string) => void }) {
  const [typed, setTyped] = useState('');
  return (
    <section aria-labelledby="access-heading">
      <h1 id="access-heading">Access token</h1>
      <p>The server asks for its access token. It is kept for this browser tab only.</p>
      {notice !== '' && <p className="refusal" role="alert">{notice}</p>}
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          const token = typed.trim();
          if (token !== '') onToken(token);
        }}
      >
        <label htmlFor="access-token">Token</label>
        <input
          id="access-token"
          type="password"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          required
        />
        <button type="submit">Use this token</button>
      </form>
    </section>
  );
}
