import { BUILD_ID_HEADER } from '@/lib/build-id';

/** Dispatched on `window` when an /rpc call is answered by another build. */
export const SITE_UPDATED_EVENT = 'otr:site-updated';

type Fetch = (request: Request, init?: RequestInit) => Promise<Response>;

/**
 * The fetch behind the browser's oRPC link. It calls `onOtherBuild` when a
 * response names a build other than `buildId`.
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
    const response = await fetch(request, init);

    const servedBy = response.headers.get(BUILD_ID_HEADER);
    if (servedBy !== null && servedBy !== buildId) {
      onOtherBuild();
    }
    return response;
  };
}
