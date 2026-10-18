import { createHmac } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { createLogger } from '@otr/core/logging';
import { optionalEnv } from '@otr/core/utils/env';

import { rpcRejections } from '@/lib/metrics';

import { resolveInternalRpcSecret } from './internal-token';

export type RateLimitMode = 'enforce' | 'observe' | 'off';
export type RateLimitBucket = 'general' | 'search';
export type RateLimitCaller = 'browser' | 'internal' | 'api';

/**
 * Token buckets: a key can burst up to `capacity` calls, and regains
 * `refillPerSecond` calls a second. A page makes at most about 6 browser
 * calls, and the biggest bursts (an admin merging pasted match IDs, ten tabs
 * at once) are about 60, so a person stays well clear of both.
 */
export const RATE_LIMITS: Record<
  RateLimitBucket,
  { capacity: number; refillPerSecond: number }
> = {
  // Every browser call to /rpc, by IP
  general: { capacity: 240, refillPerSecond: 4 },
  // Searches with a term, from anywhere, by user or else IP
  search: { capacity: 60, refillPerSecond: 1 },
};

/** Keys tracked per bucket before idle and then the oldest are dropped. */
export const MAX_TRACKED_KEYS = 50_000;

const WARN_INTERVAL_MS = 60_000;

/**
 * RPC_RATE_LIMIT: `enforce` refuses calls over a limit, `observe` only counts
 * and logs them, and `off` skips the limits. Unset, it follows NODE_ENV: a
 * production build enforces (production and PR previews run one), and
 * `next dev` is off.
 */
export function resolveRateLimitMode(
  env: { RPC_RATE_LIMIT?: string; NODE_ENV?: string } = process.env
): RateLimitMode {
  const mode = optionalEnv(env.RPC_RATE_LIMIT)?.toLowerCase();

  if (mode === 'enforce' || mode === 'observe' || mode === 'off') {
    return mode;
  }

  return env.NODE_ENV === 'production' ? 'enforce' : 'off';
}

type BucketEntry = { tokens: number; updatedAt: number };

type RateLimitStore = {
  buckets: Map<RateLimitBucket, Map<string, BucketEntry>>;
  warnedAt: Map<string, number>;
  warnedUnkeyed: boolean;
};

declare global {
  // Shared by every bundle that loads this module in the process
  var __otrRpcRateLimit: RateLimitStore | undefined;
}

const store = (): RateLimitStore =>
  (globalThis.__otrRpcRateLimit ??= {
    buckets: new Map(),
    warnedAt: new Map(),
    warnedUnkeyed: false,
  });

const entriesFor = (bucket: RateLimitBucket) => {
  const { buckets } = store();
  let entries = buckets.get(bucket);

  if (!entries) {
    entries = new Map();
    buckets.set(bucket, entries);
  }

  return entries;
};

/**
 * Entries are kept in order of last use, so the front holds the idlest. An
 * entry idle long enough to refill completely is the same as no entry.
 */
const prune = (
  entries: Map<string, BucketEntry>,
  bucket: RateLimitBucket,
  now: number
) => {
  const { capacity, refillPerSecond } = RATE_LIMITS[bucket];
  const refillMs = (capacity / refillPerSecond) * 1000;

  for (const [key, entry] of entries) {
    if (entries.size <= MAX_TRACKED_KEYS && now - entry.updatedAt < refillMs) {
      break;
    }

    entries.delete(key);
  }
};

export type RateLimitResult = {
  /** False only when the bucket is empty and the limit is enforced. */
  allowed: boolean;
  /** The bucket was empty, whether or not the limit is enforced. */
  limited: boolean;
  /** There was no key to count against, so the call passed uncounted. */
  unkeyed: boolean;
  retryAfterSeconds: number;
  enforced: boolean;
};

/** Takes one call from `key`'s bucket. A null key passes uncounted. */
export function consume(
  bucket: RateLimitBucket,
  key: string | null,
  now = Date.now()
): RateLimitResult {
  const mode = resolveRateLimitMode();
  const enforced = mode === 'enforce';
  const pass = {
    allowed: true,
    limited: false,
    retryAfterSeconds: 0,
    enforced,
  };

  if (mode === 'off') {
    return { ...pass, unkeyed: false };
  }

  if (key === null) {
    return { ...pass, unkeyed: true };
  }

  const { capacity, refillPerSecond } = RATE_LIMITS[bucket];
  const entries = entriesFor(bucket);
  const entry = entries.get(key);
  const elapsedSeconds = entry ? Math.max(0, now - entry.updatedAt) / 1000 : 0;
  let tokens = entry
    ? Math.min(capacity, entry.tokens + elapsedSeconds * refillPerSecond)
    : capacity;

  const limited = tokens < 1;
  if (!limited) {
    tokens -= 1;
  }

  // Re-inserted so the map stays in order of last use
  entries.delete(key);
  entries.set(key, { tokens, updatedAt: now });

  if (entries.size > MAX_TRACKED_KEYS) {
    prune(entries, bucket, now);
  }

  return {
    allowed: !(limited && enforced),
    limited,
    unkeyed: false,
    retryAfterSeconds: limited
      ? Math.max(1, Math.ceil((1 - tokens) / refillPerSecond))
      : 0,
    enforced,
  };
}

const logger = createLogger('otr-web');

/**
 * Names a key in the logs without the IP or user it holds: a keyed hash, since
 * a plain hash of an IPv4 address can be reversed by trying them all.
 */
const keyRef = (key: string): string | null => {
  try {
    return createHmac('sha256', resolveInternalRpcSecret())
      .update(key)
      .digest('hex')
      .slice(0, 12);
  } catch {
    return null;
  }
};

/** At most one warning per key a minute, so a flood doesn't flood the logs. */
const shouldWarn = (id: string, now: number): boolean => {
  const { warnedAt } = store();
  const last = warnedAt.get(id);

  if (last !== undefined && now - last < WARN_INTERVAL_MS) {
    return false;
  }

  if (warnedAt.size >= MAX_TRACKED_KEYS) {
    for (const [entryId, at] of warnedAt) {
      if (warnedAt.size < MAX_TRACKED_KEYS && now - at < WARN_INTERVAL_MS) {
        break;
      }

      warnedAt.delete(entryId);
    }
  }

  warnedAt.delete(id);
  warnedAt.set(id, now);
  return true;
};

type RateLimitReport = {
  caller: RateLimitCaller;
  /** URL path only: on a GET, the query string carries the input. */
  path: string | null;
  procedure?: string;
};

/** {@link consume}, then counts and logs a call over the limit or unkeyed. */
export function checkRateLimit(
  bucket: RateLimitBucket,
  key: string | null,
  report: RateLimitReport,
  now = Date.now()
): RateLimitResult {
  const result = consume(bucket, key, now);
  const enforced = String(result.enforced);

  if (result.unkeyed) {
    rpcRejections
      .labels({ reason: 'unkeyed', bucket, caller: report.caller, enforced })
      .inc();

    const current = store();
    if (!current.warnedUnkeyed) {
      current.warnedUnkeyed = true;
      logger.warn('rpc rate limit has no client ip, letting calls through', {
        bucket,
        caller: report.caller,
        path: report.path,
      });
    }
  }

  if (result.limited && key !== null) {
    rpcRejections
      .labels({ reason: 'rate_limit', bucket, caller: report.caller, enforced })
      .inc();

    if (shouldWarn(`${bucket}|${key}`, now)) {
      logger.warn('rpc rate limit reached', {
        bucket,
        caller: report.caller,
        keyKind: key.slice(0, key.indexOf(':')),
        keyRef: keyRef(key),
        path: report.path,
        procedure: report.procedure,
        retryAfter: result.retryAfterSeconds,
        enforced: result.enforced,
      });
    }
  }

  return result;
}

export const rateLimitedError = (retryAfterSeconds: number) =>
  new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message: `Too many requests. Try again in ${retryAfterSeconds} ${
      retryAfterSeconds === 1 ? 'second' : 'seconds'
    }.`,
    data: { code: 'RATE_LIMITED', retryAfter: retryAfterSeconds },
  });
