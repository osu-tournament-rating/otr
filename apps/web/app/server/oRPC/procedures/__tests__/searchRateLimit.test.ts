import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { call, ORPCError, os } from '@orpc/server';
import { z } from 'zod';

import { orpcProcedureCalls } from '@/lib/metrics';
import type { RpcCaller } from '@/lib/rpc/access';
import { RATE_LIMITS } from '@/lib/rpc/rate-limit';

import { publicProcedure, withSearchRateLimit } from '../base';

type TestContext = {
  headers: Headers;
  requestUrl?: string;
  rpc?: RpcCaller;
  resHeaders?: Headers;
  apiKey?: {
    id: string;
    userId: string;
    name: string | null;
    enabled: boolean;
  };
  session?: { user?: { id?: string | null } | null } | null;
};

const SearchInput = z.object({ q: z.string().trim().optional() });

/**
 * The middleware alone, with a context the test controls, since the public
 * chain would replace a hand-built session or key.
 */
const bareSearch = os
  .$context<TestContext>()
  .input(SearchInput)
  .use(withSearchRateLimit, (input) => input.q)
  .handler(() => 'ok');

/** The same middleware behind the full public chain, signed out. */
const publicSearch = publicProcedure
  .input(SearchInput)
  .use(withSearchRateLimit, (input) => input.q)
  .handler(() => 'ok');

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

const { capacity } = RATE_LIMITS.search;

const searchKeys = () => [
  ...(globalThis.__otrRpcRateLimit?.buckets.get('search')?.keys() ?? []),
];

const tokensLeft = (key: string) =>
  globalThis.__otrRpcRateLimit?.buckets.get('search')?.get(key)?.tokens;

/** How web_orpc_procedure_calls_total counted one procedure's calls. */
const procedureCalls = async (procedure: string) =>
  (await orpcProcedureCalls.get()).values
    .filter((value) => value.labels.procedure === procedure)
    .map(({ labels, value }) => ({
      status: labels.status,
      code: labels.code,
      value,
    }));

const browser = (clientIp: string | null): RpcCaller => ({
  kind: 'browser',
  clientIp,
});

describe('withSearchRateLimit', () => {
  it('charges a search with a term and lets a blank one through', async () => {
    const context = { headers: new Headers(), rpc: browser('203.0.113.7') };

    await call(bareSearch, { q: 'stage' }, { context });
    await call(bareSearch, { q: '  ' }, { context });
    await call(bareSearch, {}, { context });

    expect(tokensLeft('ip:203.0.113.7')).toBe(capacity - 1);
  });

  it('skips a call with a verified API key', async () => {
    await call(
      bareSearch,
      { q: 'stage' },
      {
        context: {
          headers: new Headers({ 'cf-connecting-ip': '203.0.113.7' }),
          apiKey: { id: 'key', userId: 'user', name: null, enabled: true },
        },
      }
    );

    expect(searchKeys()).toEqual([]);
  });

  it('charges a signed-in caller by user', async () => {
    await call(
      bareSearch,
      { q: 'stage' },
      {
        context: {
          headers: new Headers(),
          rpc: browser('203.0.113.7'),
          session: { user: { id: 'user-1' } },
        },
      }
    );

    expect(searchKeys()).toEqual(['user:user-1']);
  });

  it("charges a server render to the visitor's IP it forwarded", async () => {
    await call(
      bareSearch,
      { q: 'stage' },
      {
        context: {
          headers: new Headers({ 'cf-connecting-ip': '198.51.100.4' }),
          rpc: { kind: 'internal', clientIp: '203.0.113.7' },
        },
      }
    );

    expect(searchKeys()).toEqual(['ip:203.0.113.7']);
  });

  it('charges a public API call without a key by its IP', async () => {
    await call(
      bareSearch,
      { q: 'stage' },
      {
        context: {
          headers: new Headers({ 'cf-connecting-ip': '198.51.100.4' }),
        },
      }
    );

    expect(searchKeys()).toEqual(['ip:198.51.100.4']);
  });

  it('lets a caller with no IP through uncounted', async () => {
    expect(
      await call(
        bareSearch,
        { q: 'stage' },
        { context: { headers: new Headers(), rpc: browser(null) } }
      )
    ).toBe('ok');
    expect(searchKeys()).toEqual([]);
  });

  it('refuses with a 429 and Retry-After once the bucket is empty', async () => {
    const resHeaders = new Headers();
    const context = {
      headers: new Headers(),
      rpc: browser('203.0.113.7'),
      resHeaders,
    };
    for (let search = 0; search < capacity; search++) {
      await call(bareSearch, { q: 'stage' }, { context });
    }

    const error = await call(bareSearch, { q: 'stage' }, { context }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      status: 429,
      data: { code: 'RATE_LIMITED', retryAfter: 1 },
    });
    expect(resHeaders.get('retry-after')).toBe('1');
  });

  it('does nothing while the limits are off', async () => {
    env.RPC_RATE_LIMIT = 'off';

    await call(
      bareSearch,
      { q: 'stage' },
      { context: { headers: new Headers(), rpc: browser('203.0.113.7') } }
    );

    expect(searchKeys()).toEqual([]);
  });

  it('runs behind the public procedure chain', async () => {
    const resHeaders = new Headers();
    const context = {
      headers: new Headers({ 'cf-connecting-ip': '203.0.113.7' }),
      rpc: browser('203.0.113.7'),
      resHeaders,
    };
    const options = { context, path: ['test', 'chainSearch'] };
    for (let search = 0; search < capacity; search++) {
      expect(await call(publicSearch, { q: 'stage' }, options)).toBe('ok');
    }

    const error = await call(publicSearch, { q: 'stage' }, options).catch(
      (caught: unknown) => caught
    );

    expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
    expect(resHeaders.get('retry-after')).toBe('1');
    expect(await procedureCalls('test.chainSearch')).toEqual([
      { status: 'success', code: '200', value: capacity },
      { status: 'rate_limited', code: '429', value: 1 },
    ]);
  });
});
