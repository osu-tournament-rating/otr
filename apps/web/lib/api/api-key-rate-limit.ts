import { ADMIN_API_KEY_RATE_LIMIT } from '@/lib/auth/api-key-policy';

/** Windows tracked before the ended ones are dropped. */
const PRUNE_ABOVE = 10_000;

type KeyWindow = {
  startedAt: number;
  requests: number;
  windowMs: number;
  /** The limit the window's latest request counted against. */
  maxRequests: number;
};

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

/**
 * The limit a key's requests count against: the limit stored on the key,
 * raised to the admin limit while the key's owner is an admin. Callers read
 * the owner's role for each request they count, so a key gains the admin
 * limit when its owner becomes an admin and loses it when they stop. A higher
 * limit stored on the key still applies, and a key with no limit stays
 * unlimited.
 */
export function limitForOwnerRole<Key extends ApiKeyLimit>(
  key: Key,
  ownerIsAdmin: boolean
): Key {
  const { rateLimitEnabled, rateLimitMax, rateLimitTimeWindow } = key;

  if (
    !ownerIsAdmin ||
    !rateLimitEnabled ||
    rateLimitMax === null ||
    !rateLimitTimeWindow
  ) {
    return key;
  }

  const admin = ADMIN_API_KEY_RATE_LIMIT;
  // Compared as rates, since a key edited by hand can store another window
  const storedIsHigher =
    rateLimitMax * admin.timeWindowMs >=
    admin.maxRequests * rateLimitTimeWindow;

  return storedIsHigher
    ? key
    : {
        ...key,
        rateLimitMax: admin.maxRequests,
        rateLimitTimeWindow: admin.timeWindowMs,
      };
}

/**
 * How long until the key's current window ends when that window is already
 * full, or null when the request still needs counting. A window is full once
 * its requests reach both the limit its latest request counted against and
 * the limit stored on the key. Callers refuse such a request before they read
 * the key's owner, so requests over the limit cost no owner lookup. A limit
 * raised on the key applies at once, and a change to the owner's role applies
 * from the key's next window.
 */
export function fullApiKeyWindow(
  key: ApiKeyLimit,
  now = Date.now()
): number | null {
  const { rateLimitEnabled, rateLimitMax, rateLimitTimeWindow } = key;
  const current = windows().get(key.id);

  const full =
    current !== undefined &&
    rateLimitEnabled &&
    rateLimitMax !== null &&
    !!rateLimitTimeWindow &&
    now - current.startedAt < current.windowMs &&
    current.requests >= current.maxRequests &&
    current.requests >= rateLimitMax;

  return full ? current.startedAt + current.windowMs - now : null;
}

export type ApiKeyRateLimitResult =
  | {
      allowed: true;
      /** Requests in the key's current window, or null when it is not counted. */
      requests: number | null;
    }
  | { allowed: false; retryAfterMs: number };

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
    return { allowed: true, requests: null };
  }

  const tracked = windows();
  const current = tracked.get(key.id);

  if (!current || now - current.startedAt >= rateLimitTimeWindow) {
    tracked.set(key.id, {
      startedAt: now,
      requests: 1,
      windowMs: rateLimitTimeWindow,
      maxRequests: rateLimitMax,
    });

    if (tracked.size > PRUNE_ABOVE) {
      for (const [id, window] of tracked) {
        if (now - window.startedAt >= window.windowMs) {
          tracked.delete(id);
        }
      }
    }

    return { allowed: true, requests: 1 };
  }

  // fullApiKeyWindow reads the limit this request counted against
  current.windowMs = rateLimitTimeWindow;
  current.maxRequests = rateLimitMax;

  if (current.requests >= rateLimitMax) {
    return {
      allowed: false,
      retryAfterMs: current.startedAt + rateLimitTimeWindow - now,
    };
  }

  current.requests += 1;
  return { allowed: true, requests: current.requests };
}
