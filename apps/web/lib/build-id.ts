/**
 * The commit this build of the site came from, set by the image build. Builds
 * made anywhere else share one placeholder, so they never see each other as
 * a different release.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_OTR_BUILD_ID || 'development';

/** The response header that names the build which answered an /rpc call. */
export const BUILD_ID_HEADER = 'x-otr-build';
