import { optionalEnv } from '@otr/core/utils/env';

/** Carries the token that marks a call from the site's own server. */
export const INTERNAL_RPC_HEADER = 'x-otr-internal-rpc';

/** The visitor's IP on a server-side call, trusted only with a valid token. */
export const CLIENT_IP_HEADER = 'x-otr-client-ip';

const TOKEN_LABEL = 'otr-internal-rpc:v1';

/** better-auth's own secret outside production (`DEFAULT_SECRET`). */
const BETTER_AUTH_DEFAULT_SECRET = 'better-auth-secret-12345678901234567890';

type SecretEnv = {
  BETTER_AUTH_SECRETS?: string;
  BETTER_AUTH_SECRET?: string;
  AUTH_SECRET?: string;
  NODE_ENV?: string;
};

/**
 * The secret better-auth signs sessions with, resolved the way better-auth
 * resolves it: the current `<version>:<secret>` entry of BETTER_AUTH_SECRETS,
 * then BETTER_AUTH_SECRET, then AUTH_SECRET, then better-auth's default
 * outside production. Every web process already shares it, so the token
 * needs no configuration of its own.
 */
export function resolveInternalRpcSecret(env: SecretEnv = process.env): string {
  const current = optionalEnv(env.BETTER_AUTH_SECRETS)?.split(',')[0];
  const separator = current?.indexOf(':') ?? -1;
  const rotated =
    current && separator !== -1
      ? optionalEnv(current.slice(separator + 1))
      : undefined;

  const secret =
    rotated ??
    optionalEnv(env.BETTER_AUTH_SECRET) ??
    optionalEnv(env.AUTH_SECRET);

  if (secret) {
    return secret;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'BETTER_AUTH_SECRET is not set, so server-side /rpc calls cannot be signed'
    );
  }

  return BETTER_AUTH_DEFAULT_SECRET;
}

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** HMAC-SHA256 of a fixed label: the same on every process with the secret. */
export async function deriveInternalRpcToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(TOKEN_LABEL)
  );

  return toBase64Url(new Uint8Array(signature));
}

let cached: { secret: string; token: Promise<string> } | null = null;

/**
 * The token the server-side oRPC link sends in INTERNAL_RPC_HEADER. Never log
 * it or put it on a span. Web Crypto only, with no `server-only` import, since
 * the link's module is in the browser bundle too.
 */
export function getInternalRpcToken(): Promise<string> {
  const secret = resolveInternalRpcSecret();

  if (cached?.secret !== secret) {
    cached = { secret, token: deriveInternalRpcToken(secret) };
  }

  return cached.token;
}

/** Compares in time that depends only on the length, not the contents. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

export async function isInternalRpcToken(
  value: string | null | undefined
): Promise<boolean> {
  if (!value) {
    return false;
  }

  return constantTimeEqual(value, await getInternalRpcToken());
}
