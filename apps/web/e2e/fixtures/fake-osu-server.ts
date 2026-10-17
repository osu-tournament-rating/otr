/**
 * Stands in for osu! during e2e runs, so a spec can sign in through the real
 * OAuth callback as any osu! user, including one the database has never seen.
 * The code and tokens it issues carry the osu! user id, so it keeps no state.
 */
import {
  FAKE_OSU_FAILURE,
  FAKE_OSU_PORT,
  FAKE_OSU_USER_COOKIE,
  fakeOsuUsername,
} from './fake-osu';

const TOKEN_PREFIX = 'fake-token-';

const cookieValue = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];

const codeFromToken = (request: Request) => {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  return token?.startsWith(TOKEN_PREFIX)
    ? token.slice(TOKEN_PREFIX.length)
    : null;
};

const authorize = (request: Request, url: URL) => {
  const osuId = cookieValue(request, FAKE_OSU_USER_COOKIE);
  const redirectUri = url.searchParams.get('redirect_uri');

  if (!osuId || !redirectUri) {
    return new Response(
      `Set the ${FAKE_OSU_USER_COOKIE} cookie and a redirect_uri`,
      { status: 400 }
    );
  }

  const callback = new URL(redirectUri);
  callback.searchParams.set('state', url.searchParams.get('state') ?? '');

  if (osuId === FAKE_OSU_FAILURE.cancel) {
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set(
      'error_description',
      'The resource owner or authorization server denied the request.'
    );
  } else {
    callback.searchParams.set('code', osuId);
  }

  return Response.redirect(callback.toString(), 302);
};

const token = async (request: Request) => {
  const body = new URLSearchParams(await request.text());
  const code = body.get('code');

  if (!code) {
    return Response.json({ error: 'invalid_grant' }, { status: 400 });
  }

  return Response.json({
    token_type: 'Bearer',
    access_token: `${TOKEN_PREFIX}${code}`,
    refresh_token: `fake-refresh-${code}`,
    expires_in: 86400,
  });
};

const me = (request: Request) => {
  const code = codeFromToken(request);

  if (!code) {
    return Response.json({ authentication: 'basic' }, { status: 401 });
  }

  if (code === FAKE_OSU_FAILURE.apiDown) {
    return new Response('Service Unavailable', { status: 503 });
  }

  const osuId = Number(code);

  return Response.json({
    id: osuId,
    username: fakeOsuUsername(osuId),
    country_code: 'UA',
    playmode: 'osu',
    is_bot: false,
    avatar_url: 'https://a.ppy.sh/',
  });
};

Bun.serve({
  port: FAKE_OSU_PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/oauth/authorize') {
      return authorize(request, url);
    }

    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      return token(request);
    }

    if (url.pathname.startsWith('/api/v2/me')) {
      return me(request);
    }

    if (url.pathname === '/api/v2/friends') {
      return Response.json([]);
    }

    if (url.pathname === '/') {
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  },
});
