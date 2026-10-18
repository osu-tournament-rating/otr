/** The e2e web server sends osu! OAuth and API calls here (`E2E_OSU_URL`). */
export const FAKE_OSU_PORT = 3002;
export const FAKE_OSU_URL = `http://localhost:${FAKE_OSU_PORT}`;

/** The fake authorize page approves as the osu! user id in this cookie. */
export const FAKE_OSU_USER_COOKIE = 'fake_osu_user_id';

/** Cookie values that make the fake osu! fail the way the real one can. */
export const FAKE_OSU_FAILURE = {
  /** The player presses Cancel on the authorize page. */
  cancel: 'cancel',
  /** The osu! API answers 503 for the player's profile. */
  apiDown: 'api-down',
} as const;

export const fakeOsuUsername = (osuId: number) => `e2e-${osuId}`;
