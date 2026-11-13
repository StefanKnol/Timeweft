/**
 * The one way the pages reach the server: `POST /api/operations/<name>` with the access token.
 *
 * Every answer comes back as a `CallOutcome`, never as a thrown error, so a page has to say what
 * it does with a refusal and with a fault rather than letting one vanish.
 */
import type { AnswerByOperation, OperationName, RequestOf } from '@timeweft/contract';
import { outcomeOfResponse, routeOfOperation, type CallOutcome } from './shaping.ts';

const ACCESS_TOKEN_KEY = 'timeweft.accessToken';

/**
 * The token travels three ways at once, and the server takes any one of them. Behind a hub the
 * page is served on the hub's own address, and the hub may keep the `Authorization` header for
 * its own sign-in, so the token also goes in a header of the app's own and in a cookie. These two
 * names are the server's, in apps/server/src/access.ts.
 */
const ACCESS_TOKEN_HEADER = 'x-timeweft-token';
const ACCESS_TOKEN_COOKIE = 'timeweft_access_token';

/**
 * The cookie is kept to the folder the pages are served from, so that on a hub's address it goes
 * to this app's own mount and to nothing else there. It never leaves with a request from another
 * site, and it ends with the browser session, as the stored token does.
 */
function writeAccessTokenCookie(token: string | null): void {
  try {
    const folder = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1) || '/';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = token === null
      ? `${ACCESS_TOKEN_COOKIE}=; Path=${folder}; Max-Age=0; SameSite=Strict${secure}`
      : `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=${folder}; SameSite=Strict${secure}`;
  } catch {
    // A browser that refuses cookies still sends the two headers.
  }
}

/** Session storage can throw in a private window; the page then simply asks each time. */
export function readStoredAccessToken(): string | null {
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeAccessToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    else sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // Nothing to do: the token lives in memory for this page instead.
  }
  writeAccessTokenCookie(token);
}

export type CallOperation = <Name extends OperationName>(
  name: Name,
  input: RequestOf<Name>,
) => Promise<CallOutcome<AnswerByOperation[Name]>>;

export async function callOperationWithToken<Name extends OperationName>(
  name: Name,
  input: RequestOf<Name>,
  accessToken: string,
): Promise<CallOutcome<AnswerByOperation[Name]>> {
  let response: Response;
  try {
    response = await fetch(routeOfOperation(name), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, [ACCESS_TOKEN_HEADER]: accessToken },
      body: JSON.stringify(input),
    });
  } catch (error) {
    return { kind: 'fault', fault: `The server could not be reached (${error instanceof Error ? error.message : String(error)}).` };
  }
  const bodyText = await response.text();
  return outcomeOfResponse<AnswerByOperation[Name]>(response.status, bodyText);
}
