import { afterAll, beforeAll, expect } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { auth } from './auth';

const BASE_URL = 'http://localhost:3000';

/** A browser's cookies, by name. */
export type CookieJar = Map<string, string>;

/** The session `/get-session` returns. */
export type TestSession = {
  user: { id: string; osuId: number; playerId: number };
  dbPlayer: { id: number; osuId: number; username: string } | null;
};

/** Sends a request to the auth handler as a browser holding these cookies. */
export const sendAuthRequest = async (
  cookies: CookieJar,
  path: string,
  init: RequestInit = {}
) => {
  const headers = new Headers(init.headers);
  headers.set('origin', BASE_URL);
  headers.set(
    'cookie',
    [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  );

  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, { ...init, headers })
  );

  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }

  return response;
};

/** Sends a JSON POST to the auth handler. */
export const postAuthJson = (cookies: CookieJar, path: string, body: unknown) =>
  sendAuthRequest(cookies, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const getSession = async (cookies: CookieJar) => {
  const response = await sendAuthRequest(cookies, '/get-session');
  return (await response.json()) as TestSession | null;
};

/**
 * A new osu! user for the suite it is called in. While the suite runs, calls
 * to osu! are answered as this user, and afterwards the user is deleted.
 * `profile` adds fields to the user's own profile, such as its statistics,
 * or returns them for the path the profile was asked for (`/api/v2/me/mania`).
 */
export const useFakeOsuUser = (
  profile:
    | Record<string, unknown>
    | ((pathname: string) => Record<string, unknown>) = {}
) => {
  // Real osu! ids are far below this, so the user is new to the database.
  const osuId = 2_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const username = `signup-${osuId}`;
  let realFetch = globalThis.fetch;

  const fakeOsu = (request: Request) => {
    const { pathname } = new URL(request.url);

    if (pathname === '/oauth/token') {
      return Response.json({
        token_type: 'Bearer',
        access_token: 'fake-token',
        expires_in: 86400,
      });
    }

    if (pathname.startsWith('/api/v2/me')) {
      return Response.json({
        id: osuId,
        username,
        country_code: 'UA',
        playmode: 'osu',
        is_bot: false,
        avatar_url: 'https://a.ppy.sh/',
        ...(typeof profile === 'function' ? profile(pathname) : profile),
      });
    }

    if (pathname === '/api/v2/friends') {
      return Response.json([]);
    }

    return new Response('Not found', { status: 404 });
  };

  beforeAll(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        return new URL(request.url).hostname === 'osu.ppy.sh'
          ? Promise.resolve(fakeOsu(request))
          : realFetch(input, init);
      },
      realFetch
    );
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;

    const player = await db.query.players.findFirst({
      where: eq(schema.players.osuId, osuId),
    });

    if (player) {
      await db.delete(schema.users).where(eq(schema.users.playerId, player.id));
      // Cascades to the auth user, its accounts, and its sessions.
      await db.delete(schema.players).where(eq(schema.players.id, player.id));
    }
  });

  /**
   * Signs in with osu! through the OAuth callback, and returns the browser's
   * cookies and where the callback sent it.
   */
  const signIn = async () => {
    const cookies: CookieJar = new Map();

    const start = await postAuthJson(cookies, '/sign-in/social', {
      provider: 'osu',
      callbackURL: '/',
    });
    expect(start.status).toBe(200);
    const { url: authorizeUrl } = (await start.json()) as { url: string };
    const state = new URL(authorizeUrl).searchParams.get('state');

    const callback = await sendAuthRequest(
      cookies,
      `/callback/osu?code=fake-code&state=${state}`
    );
    expect(callback.status).toBe(302);

    return { cookies, location: callback.headers.get('location') ?? '' };
  };

  return { osuId, username, signIn };
};
