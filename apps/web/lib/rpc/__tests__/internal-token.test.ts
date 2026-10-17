import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  constantTimeEqual,
  deriveInternalRpcToken,
  getInternalRpcToken,
  isInternalRpcToken,
  resolveInternalRpcSecret,
} from '../internal-token';

const SECRET_KEYS = [
  'BETTER_AUTH_SECRETS',
  'BETTER_AUTH_SECRET',
  'AUTH_SECRET',
] as const;

// Widened view: the app's env typings declare BETTER_AUTH_SECRET as required,
// but these tests must be able to unset it. `bun test` loads the root `.env`.
const env = process.env as Record<string, string | undefined>;
const originalEnv = Object.fromEntries(
  SECRET_KEYS.map((key) => [key, env[key]])
);

beforeEach(() => {
  for (const key of SECRET_KEYS) {
    delete env[key];
  }
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

describe('resolveInternalRpcSecret', () => {
  it('uses the current entry of BETTER_AUTH_SECRETS first', () => {
    expect(
      resolveInternalRpcSecret({
        BETTER_AUTH_SECRETS: '2:new:secret, 1:old-secret',
        BETTER_AUTH_SECRET: 'legacy',
      })
    ).toBe('new:secret');
  });

  it('falls back to BETTER_AUTH_SECRET, then AUTH_SECRET', () => {
    expect(
      resolveInternalRpcSecret({
        BETTER_AUTH_SECRETS: ' ',
        BETTER_AUTH_SECRET: 'legacy',
        AUTH_SECRET: 'auth',
      })
    ).toBe('legacy');
    expect(resolveInternalRpcSecret({ AUTH_SECRET: 'auth' })).toBe('auth');
  });

  it('throws in production without a secret', () => {
    expect(() =>
      resolveInternalRpcSecret({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: '',
      })
    ).toThrow('BETTER_AUTH_SECRET is not set');
  });

  it("falls back to better-auth's default secret outside production", () => {
    expect(resolveInternalRpcSecret({ NODE_ENV: 'development' })).toBe(
      'better-auth-secret-12345678901234567890'
    );
  });
});

describe('the internal token', () => {
  it('is the same for the same secret and differs for another', async () => {
    const token = await deriveInternalRpcToken('secret-a');

    expect(await deriveInternalRpcToken('secret-a')).toBe(token);
    expect(await deriveInternalRpcToken('secret-b')).not.toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('follows the configured secret', async () => {
    env.BETTER_AUTH_SECRET = 'secret-a';
    const first = await getInternalRpcToken();
    env.BETTER_AUTH_SECRETS = '1:secret-b';
    const second = await getInternalRpcToken();

    expect(first).toBe(await deriveInternalRpcToken('secret-a'));
    expect(second).toBe(await deriveInternalRpcToken('secret-b'));
  });

  it('accepts only the expected token', async () => {
    env.BETTER_AUTH_SECRET = 'secret-a';
    const token = await getInternalRpcToken();

    expect(await isInternalRpcToken(token)).toBe(true);
    expect(
      await isInternalRpcToken(await deriveInternalRpcToken('other'))
    ).toBe(false);
    expect(await isInternalRpcToken(token.slice(1))).toBe(false);
    expect(await isInternalRpcToken('')).toBe(false);
    expect(await isInternalRpcToken(null)).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('compares contents and length', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
