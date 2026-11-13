import { useCallback, useEffect, useMemo, useState } from 'react';
import { callOperationWithToken, readStoredAccessToken, storeAccessToken, type CallOperation } from './api.ts';
import { CallOperationContext } from './calling.tsx';
import { routeFromHash, type Route } from './shaping.ts';
import { RunsPage } from './RunsPage.tsx';
import { RunPage } from './RunPage.tsx';

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

  return (
    <>
      <header className="masthead">
        <a className="masthead-name" href="#/runs">Timeweft</a>
        <span className="masthead-note">First version of the reader</span>
        {accessToken !== null && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              storeAccessToken(null);
              setAccessToken(null);
              setAccessNotice('');
            }}
          >
            Forget token
          </button>
        )}
      </header>
      <main className="page">
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
    </>
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
