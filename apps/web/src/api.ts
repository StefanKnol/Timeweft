/**
 * The one way the pages reach the server: `POST /api/operations/<name>` with the access token.
 *
 * Every answer comes back as a `CallOutcome`, never as a thrown error, so a page has to say what
 * it does with a refusal and with a fault rather than letting one vanish.
 */
import type { AnswerByOperation, OperationName, RequestOf } from '@timeweft/contract';
import { outcomeOfResponse, routeOfOperation, type CallOutcome } from './shaping.ts';

const ACCESS_TOKEN_KEY = 'timeweft.accessToken';

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
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  } catch (error) {
    return { kind: 'fault', fault: `The server could not be reached (${error instanceof Error ? error.message : String(error)}).` };
  }
  const bodyText = await response.text();
  return outcomeOfResponse<AnswerByOperation[Name]>(response.status, bodyText);
}
