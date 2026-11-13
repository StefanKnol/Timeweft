/**
 * Who may call the server.
 *
 * This is the first and simplest gate: one shared token, named by TIMEWEFT_ACCESS_TOKEN, carried
 * as "Authorization: Bearer <token>". Whoever holds it over the web routes is the author; whoever
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

/**
 * Compares in constant time. Both sides are hashed first, so the comparison takes the same time
 * whatever the lengths are and a caller learns nothing from how long a refusal took.
 */
export function carriesTheToken(authorizationHeader: string | undefined, settings: AccessSettings): boolean {
  if (settings.accessToken === null) return true;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader?.trim() ?? '');
  const offered = match?.[1]?.trim() ?? '';
  const offeredDigest = createHash('sha256').update(offered).digest();
  const expectedDigest = createHash('sha256').update(settings.accessToken).digest();
  return timingSafeEqual(offeredDigest, expectedDigest) && offered !== '';
}
