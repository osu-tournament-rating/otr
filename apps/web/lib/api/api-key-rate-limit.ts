/** Windows tracked before the ended ones are dropped. */
const PRUNE_ABOVE = 10_000;

type KeyWindow = { startedAt: number; requests: number; windowMs: number };

declare global {
  // Shared by every bundle that loads this module in the process
  var __otrApiKeyRateLimit: Map<string, KeyWindow> | undefined;
}

const windows = () => (globalThis.__otrApiKeyRateLimit ??= new Map());

/** A key's limit as its row stores it, which an admin can raise. */
export type ApiKeyLimit = {
  id: string;
  rateLimitEnabled: boolean;
  rateLimitMax: number | null;
  rateLimitTimeWindow: number | null;
};

export type ApiKeyRateLimitResult =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Counts one request against the key, in windows of its time window: a key's
 * first request after its window ends opens the next one. A key whose limit
 * is turned off or unset is not counted, as the auth plugin treated it.
 *
 * The counts live in memory, like the /rpc limits, because Caddy sends
 * traffic to one web container at a time. A restart starts every count over.
 */
export function consumeApiKeyRequest(
  key: ApiKeyLimit,
  now = Date.now()
): ApiKeyRateLimitResult {
  const { rateLimitEnabled, rateLimitMax, rateLimitTimeWindow } = key;

  if (!rateLimitEnabled || rateLimitMax === null || !rateLimitTimeWindow) {
    return { allowed: true };
  }

  const tracked = windows();
  const current = tracked.get(key.id);

  if (!current || now - current.startedAt >= rateLimitTimeWindow) {
    tracked.set(key.id, {
      startedAt: now,
      requests: 1,
      windowMs: rateLimitTimeWindow,
    });

    if (tracked.size > PRUNE_ABOVE) {
      for (const [id, window] of tracked) {
        if (now - window.startedAt >= window.windowMs) {
          tracked.delete(id);
        }
      }
    }

    return { allowed: true };
  }

  if (current.requests >= rateLimitMax) {
    return {
      allowed: false,
      retryAfterMs: current.startedAt + rateLimitTimeWindow - now,
    };
  }

  current.requests += 1;
  return { allowed: true };
}
