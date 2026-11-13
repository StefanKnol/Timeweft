/**
 * Who may call the server.
 *
 * This is the first and simplest gate: one shared token, named by TIMEWEFT_ACCESS_TOKEN, carried
 * as "Authorization: Bearer <token>", or in the app's own header or cookie where something in
 * front of the app keeps that header for itself. Whoever holds it over the web routes is the author; whoever
 * holds it over MCP is a story chat and gets the story operations only. Sign-in per person
 * replaces this once more than the author is let in, and each person's grants then decide what
 * they may call.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export interface AccessSettings {
  /** The token every /api and /mcp request must carry, or null where the gate is switched off. */
  accessToken: string | null;
}

/**
 * Reads the gate's settings from the environment. Refuses to start without a token unless the
 * person running it has said in so many words that this is a local, open installation.
 */
export function accessSettingsFromEnvironment(environment: NodeJS.ProcessEnv): AccessSettings {
  const token = environment['TIMEWEFT_ACCESS_TOKEN']?.trim() ?? '';
  if (token !== '') return { accessToken: token };
  if (environment['TIMEWEFT_ALLOW_NO_TOKEN'] === 'yes') return { accessToken: null };
  throw new Error('TIMEWEFT_ACCESS_TOKEN is not set, so anybody who could reach this server could read and write every run. Set it, or set TIMEWEFT_ALLOW_NO_TOKEN=yes for a local installation nobody else can reach.');
}

/** A header of the app's own that carries the token where something in front keeps `Authorization` for itself. */
export const ACCESS_TOKEN_HEADER = 'x-timeweft-token';

/** The cookie the author's pages set, for the same reason. */
export const ACCESS_TOKEN_COOKIE = 'timeweft_access_token';

/** The headers of a request that may carry the token. */
export interface HeadersThatMayCarryTheToken {
  authorization?: string | undefined;
  cookie?: string | undefined;
  [ACCESS_TOKEN_HEADER]?: string | string[] | undefined;
}

/**
 * Every token a request offers, from the three places one may travel in.
 *
 * `Authorization: Bearer` is the ordinary place. A hub or proxy in front of the app may keep that
 * header for its own sign-in and never pass the caller's on, which is why the pages also send the
 * token in a header of the app's own and in a cookie. A request is let in where any one of them
 * is the token, so a header the proxy filled in with something else does not lock the caller out.
 */
export function tokensOffered(headers: HeadersThatMayCarryTheToken): string[] {
  const offered: string[] = [];
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization?.trim() ?? '');
  if (bearer?.[1] !== undefined) offered.push(bearer[1].trim());
  const ownHeader = headers[ACCESS_TOKEN_HEADER];
  for (const value of Array.isArray(ownHeader) ? ownHeader : [ownHeader]) {
    if (value !== undefined && value.trim() !== '') offered.push(value.trim());
  }
  for (const part of (headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== ACCESS_TOKEN_COOKIE) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      offered.push(decodeURIComponent(raw));
    } catch {
      // A cookie that is not properly encoded is not a token; it is simply not offered.
    }
  }
  return offered.filter((token) => token !== '');
}

/**
 * Compares in constant time. Both sides are hashed first, so the comparison takes the same time
 * whatever the lengths are and a caller learns nothing from how long a refusal took.
 */
export function carriesTheToken(headers: HeadersThatMayCarryTheToken, settings: AccessSettings): boolean {
  if (settings.accessToken === null) return true;
  const expectedDigest = createHash('sha256').update(settings.accessToken).digest();
  let carried = false;
  // Every offered token is compared, whether or not an earlier one matched, so the time taken
  // does not say which place the right one was in.
  for (const offered of tokensOffered(headers)) {
    const offeredDigest = createHash('sha256').update(offered).digest();
    if (timingSafeEqual(offeredDigest, expectedDigest)) carried = true;
  }
  return carried;
}
