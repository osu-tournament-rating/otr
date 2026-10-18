import { NextResponse } from 'next/server';

import { BUILD_ID, BUILD_ID_HEADER } from '@/lib/build-id';

// Open pages also ask here which build the site runs, so they can offer a
// reload after a release even when they make no /rpc calls.
const answer = () =>
  new NextResponse('OK', {
    status: 200,
    headers: { [BUILD_ID_HEADER]: BUILD_ID, 'cache-control': 'no-store' },
  });

export const GET = answer;
export const HEAD = answer;
