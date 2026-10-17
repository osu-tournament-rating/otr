/**
 * Names the web code this build of the site came from, set by the image
 * build. Builds made anywhere else share one placeholder, so they never see
 * each other as a different release.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_OTR_BUILD_ID || 'development';

/** Names the build on both sides of an /rpc call, request and response. */
export const BUILD_ID_HEADER = 'x-otr-build';
