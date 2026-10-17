import type { ClientRetryPluginContext } from '@orpc/client/plugins';

import { BUILD_ID_HEADER } from '@/lib/build-id';

/** Dispatched on `window` when an /rpc call is answered by another build. */
export const SITE_UPDATED_EVENT = 'otr:site-updated';

/**
 * The site did not answer: the request failed before a response came back, or
 * the server error came from something in front of the site, as when a
 * release restarts it.
 */
export class SiteUnreachableError extends Error {
  constructor() {
    super('Something went wrong on our side. Try again in a moment.');
    this.name = 'SiteUnreachableError';
  }
}

type Fetch = (request: Request, init?: RequestInit) => Promise<Response>;

/**
 * The fetch behind the browser's oRPC link. It calls `onOtherBuild` when a
 * response names a build other than `buildId`, and throws SiteUnreachableError
 * when the site did not answer, so the call can be retried.
 */
export function createSiteFetch({
  fetch,
  buildId,
  onOtherBuild,
}: {
  fetch: Fetch;
  buildId: string;
  onOtherBuild: () => void;
}): Fetch {
  return async (request, init) => {
    let response: Response;
    try {
      response = await fetch(request, init);
    } catch (error) {
      if (request.signal.aborted) {
        throw error;
      }
      throw new SiteUnreachableError();
    }

    const servedBy = response.headers.get(BUILD_ID_HEADER);
    if (servedBy === null) {
      // The site stamps every response it sends, so a server error without
      // the stamp is a proxy saying the site is down.
      if (response.status >= 500) {
        throw new SiteUnreachableError();
      }
      return response;
    }

    if (servedBy !== buildId) {
      onOtherBuild();
    }
    return response;
  };
}

/**
 * Retries a call the site did not answer up to five times, 1, 2, 4, 8 and 8
 * seconds apart, to cover the site restarting for a release. Any answer from
 * the site itself, such as the maintenance window's 503, is final.
 */
export const RETRY_WHILE_UNREACHABLE: ClientRetryPluginContext = {
  retry: 5,
  retryDelay: ({ attemptIndex }) => Math.min(1000 * 2 ** attemptIndex, 8000),
  shouldRetry: ({ error }) => error instanceof SiteUnreachableError,
};
