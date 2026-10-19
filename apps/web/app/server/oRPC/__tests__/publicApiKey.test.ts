import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { call, isProcedure, ORPCError, type AnyProcedure } from '@orpc/server';

import { auth } from '@/lib/auth/auth';
import {
  anonymousSources,
  apiKeyRejections,
  orpcProcedureCalls,
} from '@/lib/metrics';
import { sourceId } from '@/lib/rpc/source-id';

import { publicProcedure, withOptionalApiKey } from '../procedures/base';
import { router } from '../router';

const collectProcedures = (
  node: unknown,
  path: string[] = []
): Array<{ path: string; procedure: AnyProcedure }> => {
  if (isProcedure(node)) {
    return [{ path: path.join('.'), procedure: node }];
  }

  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, child]) => collectProcedures(child, [...path, key])
  );
};

// The same rule openAPIHandler uses to serve a procedure on the REST API
const publicApiProcedures = collectProcedures(router).filter(({ procedure }) =>
  procedure['~orpc'].route.tags?.some((tag) => tag.toLowerCase() === 'public')
);

const probe = publicProcedure.handler(({ context }) => ({
  apiKey: context.apiKey?.id ?? null,
}));

describe('public API procedures and the API key', () => {
  it('finds the public API procedures in the router', () => {
    const paths = publicApiProcedures.map(({ path }) => path);

    expect(paths).toContain('stats.platform');
    expect(paths).toContain('players.get');
  });

  it('checks the API key in every public API procedure', () => {
    const unchecked = publicApiProcedures
      .filter(
        ({ procedure }) =>
          !procedure['~orpc'].middlewares.includes(withOptionalApiKey)
      )
      .map(({ path }) => path);

    expect(unchecked).toEqual([]);
  });
});

describe('withOptionalApiKey', () => {
  let verifyApiKey: ReturnType<typeof spyOn<typeof auth.api, 'verifyApiKey'>>;

  beforeEach(() => {
    verifyApiKey = spyOn(auth.api, 'verifyApiKey').mockResolvedValue({
      valid: false,
      key: null,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key.' },
    } as never);
  });

  afterEach(() => {
    verifyApiKey.mockRestore();
  });

  it('refuses a REST request that reaches it without a key', async () => {
    const error = await call(probe, undefined, {
      context: { headers: new Headers(), apiKeyRequired: true },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      message: 'An API key is required to access this endpoint.',
    });
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  // Server renders forward the visitor's headers to /rpc
  it('runs an /rpc call without a key when the authorization is not a Bearer key', async () => {
    for (const authorization of ['Basic dXNlcjpwYXNz', 'Bearer']) {
      const result = await call(probe, undefined, {
        context: { headers: new Headers({ authorization }) },
      });

      expect(result).toEqual({ apiKey: null });
    }

    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it('checks a key sent with a lowercase scheme', async () => {
    const error = await call(probe, undefined, {
      context: { headers: new Headers({ authorization: 'bearer k' }) },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(verifyApiKey).toHaveBeenCalledTimes(1);
    expect(verifyApiKey.mock.calls[0]![0]!.body.key).toBe('k');
  });
});

describe('API key and caller metrics', () => {
  const counterValue = async (
    counter: {
      get(): Promise<{ values: Array<{ labels: object; value: number }> }>;
    },
    labels: Record<string, string>
  ) =>
    (await counter.get()).values
      .filter(({ labels: actual }) =>
        Object.entries(labels).every(
          ([name, value]) => (actual as Record<string, unknown>)[name] === value
        )
      )
      .reduce((sum, { value }) => sum + value, 0);

  it('counts a key refused for its rate limit, which never reaches the call counter', async () => {
    const verifyApiKey = spyOn(auth.api, 'verifyApiKey').mockResolvedValue({
      valid: false,
      key: null,
      error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded.' },
    } as never);
    const before = await counterValue(apiKeyRejections, {
      reason: 'rate_limited',
    });
    const callsBefore = await counterValue(orpcProcedureCalls, {});

    try {
      const error = await call(probe, undefined, {
        context: { headers: new Headers({ authorization: 'Bearer k' }) },
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ status: 429 });
      expect(
        await counterValue(apiKeyRejections, { reason: 'rate_limited' })
      ).toBe(before + 1);
      expect(await counterValue(orpcProcedureCalls, {})).toBe(callsBefore);
    } finally {
      verifyApiKey.mockRestore();
    }
  });

  it('labels an /rpc call with its caller and counts an anonymous source', async () => {
    const record = spyOn(anonymousSources, 'record');
    const labels = {
      procedure: 'probe',
      accessMethod: 'anonymous',
      caller: 'internal',
    };
    const before = await counterValue(orpcProcedureCalls, labels);

    try {
      await call(probe, undefined, {
        path: ['probe'],
        context: {
          headers: new Headers(),
          rpc: { kind: 'internal', clientIp: '203.0.113.7' },
        },
      });

      expect(await counterValue(orpcProcedureCalls, labels)).toBe(before + 1);
      expect(record).toHaveBeenCalledWith(sourceId('203.0.113.7'));
    } finally {
      record.mockRestore();
    }
  });
});
