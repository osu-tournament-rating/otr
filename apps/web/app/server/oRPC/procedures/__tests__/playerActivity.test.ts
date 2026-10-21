import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import * as schema from '@otr/core/db/schema';
import { RatingAdjustmentType, Ruleset } from '@otr/core/osu';

import { getPlayer, getPlayerStats } from '../playerProcedures';
import { createTestDb, removePlayers, testDatabaseUrl } from './test-utils';

const OSU_ID = 999_400_201;
const DAY_MS = 24 * 60 * 60 * 1000;

// The player's last match in each rated ruleset, as the processor dates it:
// over a year ago in osu!, so inactive there, and under a year ago in taiko,
// though long enough that their taiko rating decays.
const LAST_MATCH_AGO = {
  [Ruleset.Osu]: 400 * DAY_MS,
  [Ruleset.Taiko]: 200 * DAY_MS,
} as const;

describe.skipIf(!testDatabaseUrl)('player activity and restriction', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let playerId: number;

  beforeAll(async () => {
    await removePlayers(db, [OSU_ID]);

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: OSU_ID, username: 'restricted', restricted: true })
      .returning({ id: schema.players.id });
    playerId = player!.id;

    for (const [ruleset, ago] of Object.entries(LAST_MATCH_AGO)) {
      const [rating] = await db
        .insert(schema.playerRatings)
        .values({
          playerId,
          ruleset: Number(ruleset),
          rating: 1500,
          volatility: 100,
          percentile: 0.5,
          globalRank: 10,
          countryRank: 1,
        })
        .returning({ id: schema.playerRatings.id });

      await db.insert(schema.ratingAdjustments).values({
        adjustmentType: RatingAdjustmentType.Match,
        ruleset: Number(ruleset),
        timestamp: new Date(Date.now() - ago).toISOString(),
        ratingBefore: 1490,
        ratingAfter: 1500,
        volatilityBefore: 101,
        volatilityAfter: 100,
        playerRatingId: rating!.id,
        playerId,
      });
    }
  });

  afterAll(async () => {
    await removePlayers(db, [OSU_ID]);
    await pool.end();
  });

  // The handlers alone; middleware has its own tests.
  const stats = (ruleset: Ruleset) =>
    getPlayerStats['~orpc'].handler({
      context: { db },
      input: { id: playerId, keyType: 'otr', ruleset },
    } as never) as Promise<{
      playerInfo: { restricted: boolean };
      rating: { lastMatchTime: string | null; inactive: boolean } | null;
    }>;

  it('says whether the player is inactive in the ruleset shown', async () => {
    const osu = await stats(Ruleset.Osu);
    const taiko = await stats(Ruleset.Taiko);

    expect(osu.rating?.inactive).toBe(true);
    expect(taiko.rating?.inactive).toBe(false);

    const lastMatchAgo = Date.now() - Date.parse(osu.rating!.lastMatchTime!);
    expect(Math.abs(lastMatchAgo - LAST_MATCH_AGO[Ruleset.Osu])).toBeLessThan(
      60_000
    );
  });

  it('says the player is restricted, on the profile and the player', async () => {
    expect((await stats(Ruleset.Osu)).playerInfo.restricted).toBe(true);

    const player = (await getPlayer['~orpc'].handler({
      context: { db },
      input: { id: playerId, keyType: 'otr' },
    } as never)) as { restricted: boolean };
    expect(player.restricted).toBe(true);
  });
});
