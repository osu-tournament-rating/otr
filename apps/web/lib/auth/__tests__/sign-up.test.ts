import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { auth } from '../auth';

// Signing up writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

const BASE_URL = 'http://localhost:3000';
// Real osu! ids are far below this, so the user is new to the database.
const OSU_ID = 2_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const USERNAME = `signup-${OSU_ID}`;

// Answers Better Auth's and osu-api-v2-js's calls to osu! as the new user.
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
      id: OSU_ID,
      username: USERNAME,
      country_code: 'UA',
      playmode: 'osu',
      is_bot: false,
      avatar_url: 'https://a.ppy.sh/',
    });
  }

  if (pathname === '/api/v2/friends') {
    return Response.json([]);
  }

  return new Response('Not found', { status: 404 });
};

/** Sends a request to the auth handler as a browser holding these cookies. */
const send = async (
  cookies: Map<string, string>,
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

/** Signs in with osu! through the OAuth callback and returns the session. */
const signInWithOsu = async () => {
  const cookies = new Map<string, string>();

  const start = await send(cookies, '/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'osu', callbackURL: '/' }),
  });
  expect(start.status).toBe(200);
  const { url: authorizeUrl } = (await start.json()) as { url: string };
  const state = new URL(authorizeUrl).searchParams.get('state');

  const callback = await send(
    cookies,
    `/callback/osu?code=fake-code&state=${state}`
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).not.toContain('error=');

  const session = await send(cookies, '/get-session');
  return (await session.json()) as {
    user: { id: string; osuId: number; playerId: number };
    dbPlayer: { id: number; osuId: number; username: string } | null;
  };
};

describe.skipIf(!enabled)('osu! sign-up', () => {
  const realFetch = globalThis.fetch;

  const removeUser = async () => {
    const player = await db.query.players.findFirst({
      where: eq(schema.players.osuId, OSU_ID),
    });

    if (player) {
      await db.delete(schema.users).where(eq(schema.users.playerId, player.id));
      // Cascades to the auth user, its accounts, and its sessions.
      await db.delete(schema.players).where(eq(schema.players.id, player.id));
    }
  };

  beforeAll(() => {
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
    await removeUser();
  });

  test('a new osu! user signs up, then signs back in to the same account', async () => {
    const signUp = await signInWithOsu();
    expect(signUp.user.osuId).toBe(OSU_ID);
    expect(signUp.dbPlayer?.username).toBe(USERNAME);
    expect(signUp.user.playerId).toBe(signUp.dbPlayer!.id);

    const signIn = await signInWithOsu();
    expect(signIn.user.id).toBe(signUp.user.id);
  });
});
