import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';

import {
  classifyRpcCaller,
  type RpcCaller,
  SITE_ONLY_MESSAGE,
} from '../access';
import {
  CLIENT_IP_HEADER,
  getInternalRpcToken,
  INTERNAL_RPC_HEADER,
} from '../internal-token';

const classify = (headers: HeadersInit) =>
  classifyRpcCaller(new Headers(headers));

const expectRefused = async (headers: HeadersInit) => {
  const error = await classify(headers).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ORPCError);
  expect(error).toMatchObject({
    code: 'FORBIDDEN',
    status: 403,
    message: SITE_ONLY_MESSAGE,
    data: { code: 'SITE_ONLY' },
  });
};

// `bun test` loads the root `.env`, whose site URLs would match localhost.
const env = process.env as Record<string, string | undefined>;
const originalEnv = {
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
  NEXT_PUBLIC_APP_BASE_URL: env.NEXT_PUBLIC_APP_BASE_URL,
};

beforeEach(() => {
  env.BETTER_AUTH_URL = 'https://otr.example.test';
  delete env.NEXT_PUBLIC_APP_BASE_URL;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
});

const BROWSER: RpcCaller = { kind: 'browser', clientIp: null };

describe('classifyRpcCaller with Sec-Fetch-Site', () => {
  it('lets a same-origin browser call through with its IP', async () => {
    expect(
      await classify({
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': '203.0.113.7',
      })
    ).toEqual({ kind: 'browser', clientIp: '203.0.113.7' });
  });

  it.each(['same-site', 'cross-site', 'none'])('refuses %s', async (site) => {
    await expectRefused({
      'sec-fetch-site': site,
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    });
  });
});

describe('classifyRpcCaller without Sec-Fetch-Site', () => {
  it('lets through an Origin that matches the host', async () => {
    expect(
      await classify({
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      })
    ).toEqual(BROWSER);
  });

  it('matches the forwarded host over the host', async () => {
    expect(
      await classify({
        origin: 'https://otr.stagec.net',
        host: 'localhost:3000',
        'x-forwarded-host': 'otr.stagec.net',
      })
    ).toEqual(BROWSER);
    await expectRefused({
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'x-forwarded-host': 'otr.stagec.net',
    });
  });

  it("lets through an Origin that matches the site's URL", async () => {
    expect(
      await classify({
        origin: 'https://otr.example.test',
        host: 'localhost:3000',
      })
    ).toEqual(BROWSER);
  });

  it('refuses a mismatched, missing or opaque Origin', async () => {
    await expectRefused({
      origin: 'https://evil.test',
      host: 'localhost:3000',
    });
    await expectRefused({ host: 'localhost:3000' });
    await expectRefused({ origin: 'null', host: 'localhost:3000' });
  });

  it('refuses a Referer without an Origin', async () => {
    await expectRefused({
      referer: 'http://localhost:3000/',
      host: 'localhost:3000',
    });
  });
});

describe('classifyRpcCaller with the internal token', () => {
  it("marks a server-side call internal with the visitor's IP", async () => {
    expect(
      await classify({
        [INTERNAL_RPC_HEADER]: await getInternalRpcToken(),
        [CLIENT_IP_HEADER]: '203.0.113.7',
        'cf-connecting-ip': '198.51.100.4',
      })
    ).toEqual({ kind: 'internal', clientIp: '203.0.113.7' });
  });

  it('drops an invalid client IP', async () => {
    expect(
      await classify({
        [INTERNAL_RPC_HEADER]: await getInternalRpcToken(),
        [CLIENT_IP_HEADER]: 'not-an-ip',
      })
    ).toEqual({ kind: 'internal', clientIp: null });
  });

  it('refuses a wrong token, even from the same origin', async () => {
    await expectRefused({
      [INTERNAL_RPC_HEADER]: 'forged',
      'sec-fetch-site': 'same-origin',
    });
  });

  it('ignores the client IP header without a token', async () => {
    expect(
      await classify({
        'sec-fetch-site': 'same-origin',
        [CLIENT_IP_HEADER]: '192.0.2.99',
        'x-forwarded-for': '198.51.100.4',
      })
    ).toEqual({ kind: 'browser', clientIp: '198.51.100.4' });
  });

  it('gives an API key no way past the gate', async () => {
    await expectRefused({ authorization: 'Bearer key-123' });
  });
});
