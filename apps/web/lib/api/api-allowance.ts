/**
 * Each user's API allowance: the API key limit, `rateLimit` in the API key
 * plugin's options in `lib/auth/auth.ts`. The registrant filter charges its
 * lookups of players o!TR has never seen to the same allowance.
 */
export const API_REQUESTS_PER_MINUTE = 60;

const MINUTE_MS = 60_000;

/** The allowance refills one request this often. */
export const MS_PER_REQUEST = MINUTE_MS / API_REQUESTS_PER_MINUTE;

/**
 * How long the user's API calls wait, in whole seconds, given how far ahead
 * the allowance is full again (`users.api_allowance_full_at` minus now).
 * A call needs one request free, so it waits only once lookups have used
 * more than a minute's allowance less one request; 0 means it can go now.
 */
export function allowanceRetryAfterSeconds(msUntilFull: number): number {
  const overMs = msUntilFull - (MINUTE_MS - MS_PER_REQUEST);
  return overMs > 0 ? Math.ceil(overMs / 1000) : 0;
}
