import { NextResponse } from 'next/server';

import { BUILD_ID, BUILD_ID_HEADER } from '@/lib/build-id';
import { isDraining, READINESS_HEADER } from '@/lib/shutdown';

// Open pages also ask here which build the site runs, so they can offer a
// reload after a release even when they make no /rpc calls. The reverse proxy
// asks here with READINESS_HEADER, and stops sending requests to a server that
// answers it with 503 because it is shutting down.
const answer = (request?: Request) => {
  const leaving = isDraining() && request?.headers.has(READINESS_HEADER);
  return new NextResponse(leaving ? 'Shutting down' : 'OK', {
    status: leaving ? 503 : 200,
    headers: { [BUILD_ID_HEADER]: BUILD_ID, 'cache-control': 'no-store' },
  });
};

export const GET = answer;
export const HEAD = answer;
