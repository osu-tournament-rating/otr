import { ORPCError } from '@orpc/server';
import type {
  StandardHandleResult,
  StandardHandlerInterceptorOptions,
} from '@orpc/server/standard';
import { createLogger } from '@otr/core/logging';
import { optionalEnv } from '@otr/core/utils/env';

import { rpcRejections } from '@/lib/metrics';

import { isValidIP, resolveClientIp } from './client-ip';
import {
  CLIENT_IP_HEADER,
  INTERNAL_RPC_HEADER,
  isInternalRpcToken,
} from './internal-token';

/**
 * Who is calling `/rpc`: a page in a visitor's browser, or the site's own
 * server rendering a page for them. `clientIp` is the visitor's either way.
 */
export type RpcCaller = {
  kind: 'browser' | 'internal';
  clientIp: string | null;
};

export const SITE_ONLY_MESSAGE =
  'This endpoint serves the o!TR website only. Use the public API under /api with an API key.';

const logger = createLogger('otr-web');

const siteOnlyError = () =>
  new ORPCError('FORBIDDEN', {
    status: 403,
    message: SITE_ONLY_MESSAGE,
    data: { code: 'SITE_ONLY' },
  });

const hostOf = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * For browsers that predate Sec-Fetch-Site (Safari before 16.4): the Origin
 * must name the host the request came in on, or the site's configured URL.
 * Every call the site makes is a POST, which always carries an Origin.
 */
const originMatchesSite = (headers: Headers): boolean => {
  const origin = headers.get('origin');
  const originHost = origin && origin !== 'null' ? hostOf(origin) : null;

  if (!originHost) {
    return false;
  }

  const requestHost = (headers.get('x-forwarded-host') ?? headers.get('host'))
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();

  return [
    requestHost,
    hostOf(optionalEnv(process.env.BETTER_AUTH_URL)),
    hostOf(optionalEnv(process.env.NEXT_PUBLIC_APP_BASE_URL)),
  ].includes(originHost);
};

/**
 * Lets through the site's own calls and refuses the rest with FORBIDDEN. A
 * server-side call proves itself with the internal token. A browser call must
 * be same-origin. Anyone can forge these headers, so this only turns away
 * casual and cross-site use; the rate limits are what protect the database.
 * An API key exempts no one: key holders use /api.
 */
export async function classifyRpcCaller(headers: Headers): Promise<RpcCaller> {
  const token = headers.get(INTERNAL_RPC_HEADER);

  if (token !== null) {
    if (!(await isInternalRpcToken(token))) {
      throw siteOnlyError();
    }

    const clientIp = headers.get(CLIENT_IP_HEADER)?.trim();
    return {
      kind: 'internal',
      clientIp: clientIp && isValidIP(clientIp) ? clientIp : null,
    };
  }

  const fetchSite = headers.get('sec-fetch-site');
  const sameOrigin =
    fetchSite !== null
      ? fetchSite.trim().toLowerCase() === 'same-origin'
      : originMatchesSite(headers);

  if (!sameOrigin) {
    throw siteOnlyError();
  }

  return { kind: 'browser', clientIp: resolveClientIp(headers) };
}

type RpcRouteContext = {
  headers: Headers;
  requestUrl?: string;
  resHeaders?: Headers;
  rpc?: RpcCaller;
};

type RpcInterceptorOptions<T extends RpcRouteContext> =
  StandardHandlerInterceptorOptions<T> & {
    next(
      options?: StandardHandlerInterceptorOptions<T>
    ): Promise<StandardHandleResult>;
  };

/**
 * The `/rpc` handler's gate. It runs before the procedure is matched, inside
 * oRPC's error handling, so a refusal goes back as an ordinary RPC error the
 * site's client can read. The caller it finds goes on in `context.rpc`.
 */
export const rpcAccessInterceptor = async <T extends RpcRouteContext>(
  options: RpcInterceptorOptions<T>
): Promise<StandardHandleResult> => {
  const { context, request } = options;
  let caller: RpcCaller;

  try {
    caller = await classifyRpcCaller(context.headers);
  } catch (error) {
    const callerKind = context.headers.has(INTERNAL_RPC_HEADER)
      ? 'internal'
      : 'browser';

    rpcRejections
      .labels({
        reason: 'origin',
        bucket: 'none',
        caller: callerKind,
        enforced: 'true',
      })
      .inc();
    logger.debug('rpc call refused', {
      caller: callerKind,
      path: request.url.pathname,
    });

    throw error;
  }

  return options.next({ ...options, context: { ...context, rpc: caller } });
};
