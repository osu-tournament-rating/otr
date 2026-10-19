import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { db } from '@/lib/db';

import { useFakeOsuUser } from '../osu-sign-in.test-utils';

// Signing in writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

const playerByOsuId = async (osuId: number) => {
  const player = await db.query.players.findFirst({
    where: eq(schema.players.osuId, osuId),
  });
  return player!;
};

describe.skipIf(!enabled)('osu! sign-up', () => {
  const osuUser = useFakeOsuUser();

  test("leaves a new player's osu! data for the data worker to fetch", async () => {
    const signUpStartedMs = Date.now();
    await osuUser.signIn();

    const player = await playerByOsuId(osuUser.osuId);
    expect(player.dataFetchStatus).toBe(DataFetchStatus.NotFetched);
    // Older than the sign-up, so the refetch scheduler finds the player due.
    expect(new Date(player.osuLastFetch).getTime()).toBeLessThan(
      signUpStartedMs
    );
  });
});

describe.skipIf(!enabled)('osu! sign-in', () => {
  const osuUser = useFakeOsuUser();

  test('refreshes the name and country without moving a pending osu! fetch', async () => {
    await osuUser.signIn();
    const { id } = await playerByOsuId(osuUser.osuId);
    // A fetch whose job was queued three days ago and has not run yet.
    const leaseStart = '2026-10-16T12:00:00.000Z';
    await db
      .update(schema.players)
      .set({
        username: 'old-name',
        country: 'XX',
        dataFetchStatus: DataFetchStatus.Fetching,
        osuLastFetch: leaseStart,
      })
      .where(eq(schema.players.id, id));

    await osuUser.signIn();

    const player = await playerByOsuId(osuUser.osuId);
    expect(player.username).toBe(osuUser.username);
    expect(player.country).toBe('UA');
    expect(player.dataFetchStatus).toBe(DataFetchStatus.Fetching);
    expect(new Date(player.osuLastFetch).toISOString()).toBe(leaseStart);
  });
});
