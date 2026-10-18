import { AsyncLocalStorage } from 'node:async_hooks';

const OSU_HOST = 'osu.ppy.sh';
const MAX_RETRY_AFTER_MS = 6 * 60 * 60_000;

const store = new AsyncLocalStorage<{ retryAfterMs?: number }>();

/** Milliseconds a Retry-After header asks for, as seconds or an HTTP date. */
export const parseRetryAfter = (
  value: string | null,
  now = Date.now()
): number | undefined => {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;

  return Number.isFinite(ms) && ms > 0
    ? Math.min(ms, MAX_RETRY_AFTER_MS)
    : undefined;
};

/** Runs `fn` so the longest wait osu! asks for during it can be read back. */
export const trackOsuRetryAfter = <T>(fn: () => Promise<T>) =>
  store.run({}, fn);

/** The longest wait osu! asked for inside the current trackOsuRetryAfter. */
export const osuRetryAfterMs = () => store.getStore()?.retryAfterMs;

/**
 * Wraps fetch to note the Retry-After of osu!'s 429 and 503 responses. The
 * osu! API client throws without exposing response headers.
 */
type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export const captureOsuRetryAfter = <F extends FetchFunction>(
  original: F
): F => {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);

    if (response.status === 429 || response.status === 503) {
      const tracked = store.getStore();
      const url = input instanceof Request ? input.url : String(input);
      if (tracked && new URL(url).hostname.endsWith(OSU_HOST)) {
        const ms = parseRetryAfter(response.headers.get('retry-after'));
        if (ms !== undefined) {
          tracked.retryAfterMs = Math.max(tracked.retryAfterMs ?? 0, ms);
        }
      }
    }

    return response;
  };

  return Object.assign(wrapped, original) as F;
};
