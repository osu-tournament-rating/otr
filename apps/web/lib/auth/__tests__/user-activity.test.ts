import {
  afterAll,
  afterEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';
import { asc, eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { getSession, useFakeOsuUser } from '../osu-sign-in.test-utils';

// Signing in writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe.skipIf(!enabled)('daily user activity', () => {
  const osuUser = useFakeOsuUser();
  let playerId: number | undefined;

  const activeDays = async () => {
    const rows = await db
      .select({ day: schema.userActivityDaily.day })
      .from(schema.userActivityDaily)
      .where(eq(schema.userActivityDaily.playerId, playerId!))
      .orderBy(asc(schema.userActivityDaily.day));
    return rows.map((row) => row.day);
  };

  afterEach(() => {
    setSystemTime();
  });

  // The rows outlive the player on purpose, so the suite removes them itself.
  afterAll(async () => {
    if (playerId !== undefined) {
      await db
        .delete(schema.userActivityDaily)
        .where(eq(schema.userActivityDaily.playerId, playerId));
    }
  });

  test('looking up a session marks the player active on each UTC day they return', async () => {
    const { cookies } = await osuUser.signIn();
    const session = await getSession(cookies);
    playerId = session!.dbPlayer!.id;

    const today = new Date().toISOString().slice(0, 10);
    expect(await activeDays()).toEqual([today]);

    const nextMidnight = Math.ceil(Date.now() / DAY_MS) * DAY_MS;
    setSystemTime(new Date(nextMidnight - MINUTE_MS));
    expect(await getSession(cookies)).not.toBeNull();
    setSystemTime(new Date(nextMidnight + MINUTE_MS));
    expect(await getSession(cookies)).not.toBeNull();

    const tomorrow = new Date(nextMidnight).toISOString().slice(0, 10);
    expect(await activeDays()).toEqual([today, tomorrow]);
  });
});
