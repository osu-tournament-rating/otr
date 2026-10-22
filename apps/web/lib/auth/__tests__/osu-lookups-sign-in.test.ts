import { describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { enqueueJob, JobQueue } from '@otr/core/jobs';
import { db } from '@/lib/db';

import { getSession, useFakeOsuUser } from '../osu-sign-in.test-utils';

// Signing in writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI's checks job points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

// Far above real osu! ids.
const LOOKED_UP_OSU_ID = 2_999_000_001;

describe.skipIf(!enabled)('osu! sign-in and waiting lookups', () => {
  const osuUser = useFakeOsuUser();

  test('signing in with osu! again clears the note and wakes the lookups that waited for it', async () => {
    const { cookies } = await osuUser.signIn();
    const session = await getSession(cookies);
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.playerId, session!.user.playerId));
    const userId = user!.id;

    // As the data worker leaves them when osu! refuses the user's token
    await db
      .update(schema.users)
      .set({ osuSignInNeededAt: sql`now()` })
      .where(eq(schema.users.id, userId));
    await enqueueJob(db, JobQueue.OsuLookup, {
      payload: { osuPlayerId: LOOKED_UP_OSU_ID },
      requestedByUserId: userId,
      runAfter: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    try {
      await osuUser.signIn();

      const [after] = await db
        .select({ note: schema.users.osuSignInNeededAt })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      expect(after!.note).toBeNull();

      const { rows } = await db.execute<{ due: boolean }>(sql`
        SELECT run_after <= now() AS due FROM jobs
        WHERE queue = ${JobQueue.OsuLookup} AND requested_by_user_id = ${userId}`);
      expect(rows).toEqual([{ due: true }]);
    } finally {
      await db.execute(
        sql`DELETE FROM jobs WHERE requested_by_user_id = ${userId}`
      );
    }
  });
});
