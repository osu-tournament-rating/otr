import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { rpcRejections } from '@/lib/metrics';

import {
  checkRateLimit,
  consume,
  MAX_TRACKED_KEYS,
  RATE_LIMITS,
  rateLimitedError,
  resolveRateLimitMode,
} from '../rate-limit';

const env = process.env as Record<string, string | undefined>;
const originalMode = env.RPC_RATE_LIMIT;

beforeEach(() => {
  env.RPC_RATE_LIMIT = 'enforce';
  globalThis.__otrRpcRateLimit = undefined;
});

afterEach(() => {
  if (originalMode === undefined) {
    delete env.RPC_RATE_LIMIT;
  } else {
    env.RPC_RATE_LIMIT = originalMode;
  }
  globalThis.__otrRpcRateLimit = undefined;
});

const NOW = 1_000_000;

/** Takes `count` calls at `now` and returns the last result. */
const drain = (key: string, count: number, now = NOW) => {
  let result = consume('search', key, now);
  for (let call = 1; call < count; call++) {
    result = consume('search', key, now);
  }
  return result;
};

const rejectionCount = async (labels: Record<string, string>) => {
  const metric = await rpcRejections.get();
  return (
    metric.values.find((value) =>
      Object.entries(labels).every(
        ([name, expected]) =>
          (value.labels as Record<string, unknown>)[name] === expected
      )
    )?.value ?? 0
  );
};

describe('consume', () => {
  it('allows a burst up to the capacity, then refuses', () => {
    const { capacity } = RATE_LIMITS.search;

    expect(drain('ip:a', capacity)).toMatchObject({
      allowed: true,
      limited: false,
    });
    expect(consume('search', 'ip:a', NOW)).toEqual({
      allowed: false,
      limited: true,
      unkeyed: false,
      retryAfterSeconds: 1,
      enforced: true,
    });
  });

  it('refills at the bucket rate', () => {
    const { capacity, refillPerSecond } = RATE_LIMITS.general;
    for (let call = 0; call < capacity; call++) {
      consume('general', 'ip:a', NOW);
    }

    expect(consume('general', 'ip:a', NOW).allowed).toBe(false);
    // A quarter-second later the general bucket has one call again
    const later = NOW + 1000 / refillPerSecond;
    expect(consume('general', 'ip:a', later).allowed).toBe(true);
    expect(consume('general', 'ip:a', later).allowed).toBe(false);
  });

  it('rounds the wait up to whole seconds', () => {
    drain('ip:a', RATE_LIMITS.search.capacity + 1);

    // 0.3 s of refill leaves 0.7 of a call to wait for
    expect(consume('search', 'ip:a', NOW + 300).retryAfterSeconds).toBe(1);
  });

  it('never refills past the capacity', () => {
    consume('search', 'ip:a', NOW);
    const muchLater = NOW + 24 * 60 * 60 * 1000;

    expect(drain('ip:a', RATE_LIMITS.search.capacity, muchLater).allowed).toBe(
      true
    );
    expect(consume('search', 'ip:a', muchLater).allowed).toBe(false);
  });

  it('keeps keys and buckets apart', () => {
    drain('ip:a', RATE_LIMITS.search.capacity + 1);

    expect(consume('search', 'ip:b', NOW).allowed).toBe(true);
    expect(consume('general', 'ip:a', NOW).allowed).toBe(true);
  });

  it('lets an unkeyed call through uncounted', () => {
    expect(consume('search', null, NOW)).toEqual({
      allowed: true,
      limited: false,
      unkeyed: true,
      retryAfterSeconds: 0,
      enforced: true,
    });
    expect(globalThis.__otrRpcRateLimit?.buckets.size ?? 0).toBe(0);
  });

  it('keeps the tracked keys under the cap', () => {
    for (let index = 0; index <= MAX_TRACKED_KEYS; index++) {
      consume('search', `ip:${index}`, NOW + index);
    }

    const entries = globalThis.__otrRpcRateLimit!.buckets.get('search')!;
    expect(entries.size).toBe(MAX_TRACKED_KEYS);
    // The oldest goes first
    expect(entries.has('ip:0')).toBe(false);
    expect(entries.has(`ip:${MAX_TRACKED_KEYS}`)).toBe(true);
  });

  it('drops every fully refilled key when pruning', () => {
    for (let index = 0; index < MAX_TRACKED_KEYS; index++) {
      consume('search', `ip:${index}`, NOW);
    }

    const { capacity, refillPerSecond } = RATE_LIMITS.search;
    consume('search', 'ip:new', NOW + (capacity / refillPerSecond) * 1000);

    const entries = globalThis.__otrRpcRateLimit!.buckets.get('search')!;
    expect([...entries.keys()]).toEqual(['ip:new']);
  });

  it('only observes in observe mode', () => {
    env.RPC_RATE_LIMIT = 'observe';

    expect(drain('ip:a', RATE_LIMITS.search.capacity + 1)).toEqual({
      allowed: true,
      limited: true,
      unkeyed: false,
      retryAfterSeconds: 1,
      enforced: false,
    });
  });

  it('skips the limits when off', () => {
    env.RPC_RATE_LIMIT = 'off';

    expect(drain('ip:a', RATE_LIMITS.search.capacity + 1)).toMatchObject({
      allowed: true,
      limited: false,
    });
    expect(globalThis.__otrRpcRateLimit?.buckets.size ?? 0).toBe(0);
  });
});

describe('resolveRateLimitMode', () => {
  it('enforces in production and is off elsewhere by default', () => {
    expect(resolveRateLimitMode({ NODE_ENV: 'production' })).toBe('enforce');
    expect(resolveRateLimitMode({ NODE_ENV: 'development' })).toBe('off');
    expect(resolveRateLimitMode({ NODE_ENV: 'test' })).toBe('off');
  });

  it('follows RPC_RATE_LIMIT, treating blank or unknown as unset', () => {
    expect(
      resolveRateLimitMode({ NODE_ENV: 'production', RPC_RATE_LIMIT: 'off' })
    ).toBe('off');
    expect(
      resolveRateLimitMode({
        NODE_ENV: 'development',
        RPC_RATE_LIMIT: 'Enforce',
      })
    ).toBe('enforce');
    expect(
      resolveRateLimitMode({ NODE_ENV: 'production', RPC_RATE_LIMIT: ' ' })
    ).toBe('enforce');
    expect(
      resolveRateLimitMode({ NODE_ENV: 'development', RPC_RATE_LIMIT: 'nope' })
    ).toBe('off');
  });
});

describe('checkRateLimit', () => {
  const report = { caller: 'browser', path: '/rpc/search/query' } as const;

  it('counts calls over the limit', async () => {
    const labels = {
      reason: 'rate_limit',
      bucket: 'search',
      caller: 'browser',
      enforced: 'true',
    };
    const before = await rejectionCount(labels);

    drain('ip:a', RATE_LIMITS.search.capacity);
    checkRateLimit('search', 'ip:a', report, NOW);
    checkRateLimit('search', 'ip:a', report, NOW);

    expect(await rejectionCount(labels)).toBe(before + 2);
  });

  it('counts unkeyed calls', async () => {
    const labels = {
      reason: 'unkeyed',
      bucket: 'general',
      caller: 'browser',
      enforced: 'true',
    };
    const before = await rejectionCount(labels);

    expect(checkRateLimit('general', null, report, NOW).allowed).toBe(true);
    expect(await rejectionCount(labels)).toBe(before + 1);
  });
});

describe('rateLimitedError', () => {
  it('says when to try again', () => {
    expect(rateLimitedError(1)).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      message: 'Too many requests. Try again in 1 second.',
      data: { code: 'RATE_LIMITED', retryAfter: 1 },
    });
    expect(rateLimitedError(3).message).toBe(
      'Too many requests. Try again in 3 seconds.'
    );
  });
});
