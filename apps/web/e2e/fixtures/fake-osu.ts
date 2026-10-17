/** The e2e web server sends osu! OAuth and API calls here (`E2E_OSU_URL`). */
export const FAKE_OSU_PORT = 3002;
export const FAKE_OSU_URL = `http://localhost:${FAKE_OSU_PORT}`;

/** The fake authorize page approves as the osu! user id in this cookie. */
export const FAKE_OSU_USER_COOKIE = 'fake_osu_user_id';

export const fakeOsuUsername = (osuId: number) => `e2e-${osuId}`;
