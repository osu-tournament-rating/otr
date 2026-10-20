import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { RatingAdjustmentType, Ruleset } from '@otr/core/osu';
import { getTierBounds } from '@/lib/utils/tierProgress';

import { runLeaderboard } from '../leaderboardProcedures';

// Seeds and deletes rows; point it at a disposable database
const url = process.env.SEARCH_TEST_DATABASE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Gives each player's osu! rating a Match adjustment `ago` milliseconds ago,
 * as the processor records the end of a verified match.
 */
const seedMatchAdjustments = async (
  db: ReturnType<typeof drizzle<typeof dbSchema>>,
  playerIds: number[],
  ago: number
) => {
  const ratings = await db
    .select({
      id: schema.playerRatings.id,
      playerId: schema.playerRatings.playerId,
    })
    .from(schema.playerRatings)
    .where(inArray(schema.playerRatings.playerId, playerIds));

  await db.insert(schema.ratingAdjustments).values(
    ratings.map((rating) => ({
      adjustmentType: RatingAdjustmentType.Match,
      ruleset: Ruleset.Osu,
      timestamp: new Date(Date.now() - ago).toISOString(),
      ratingBefore: 1000,
      ratingAfter: 1010,
      volatilityBefore: 100,
      volatilityAfter: 99,
      playerRatingId: rating.id,
      playerId: rating.playerId,
    }))
  );
};

const COUNTRY = 'XQ';
const OTHER_COUNTRY = 'XZ';

const players = [
  { osuId: 999_400_001, country: COUNTRY, tier: 'bronze' },
  { osuId: 999_400_002, country: COUNTRY, tier: 'silver' },
  { osuId: 999_400_003, country: COUNTRY, tier: 'gold' },
  { osuId: 999_400_004, country: OTHER_COUNTRY, tier: 'bronze' },
  { osuId: 999_400_005, country: OTHER_COUNTRY, tier: 'gold' },
] as const;
const osuIds = players.map((player) => player.osuId);

describe.skipIf(!url)('leaderboard filters', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema });

  beforeAll(async () => {
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, osuIds));

    const inserted = await db
      .insert(schema.players)
      .values(
        players.map((player) => ({
          osuId: player.osuId,
          username: `leaderboard${player.osuId}`,
          country: player.country,
        }))
      )
      .returning({ id: schema.players.id, osuId: schema.players.osuId });

    await db.insert(schema.playerRatings).values(
      players.map((player, index) => ({
        playerId: inserted.find((row) => row.osuId === player.osuId)!.id,
        ruleset: Ruleset.Osu,
        rating: getTierBounds(player.tier).min + 1,
        volatility: 100,
        percentile: 0.5,
        globalRank: index + 1,
        countryRank: index + 1,
      }))
    );

    // A match yesterday keeps each player active, so the default view
    // lists them.
    await seedMatchAdjustments(
      db,
      inserted.map((row) => row.id),
      DAY_MS
    );
  });

  afterAll(async () => {
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, osuIds));
    await pool.end();
  });

  it('applies a country filter to every chosen tier', async () => {
    const result = await runLeaderboard({
      input: { country: COUNTRY, tiers: ['bronze', 'gold'] },
      context: { db },
    });

    expect(
      result.leaderboard.map(({ player }) => ({
        osuId: player.osuId,
        country: player.country,
      }))
    ).toEqual([
      { osuId: 999_400_001, country: COUNTRY },
      { osuId: 999_400_003, country: COUNTRY },
    ]);
    expect(result.total).toBe(2);
  });
});

const ACTIVITY_COUNTRY = 'XR';

// Global ranks as the processor gave them: hiding a player leaves a gap. A
// player is inactive a year (365 days) after their last verified match, so
// the first two sit an hour either side of that.
const activityPlayers = {
  inactive: {
    osuId: 999_400_101,
    globalRank: 1,
    lastMatchAgo: 365 * DAY_MS + HOUR_MS,
  },
  active: {
    osuId: 999_400_102,
    globalRank: 2,
    lastMatchAgo: 365 * DAY_MS - HOUR_MS,
  },
  restricted: { osuId: 999_400_103, globalRank: 3, lastMatchAgo: DAY_MS },
} as const;
type ActivityPlayer = keyof typeof activityPlayers;
const activityOsuIds = Object.values(activityPlayers).map(
  (player) => player.osuId
);

describe.skipIf(!url)('leaderboard activity and restrictions', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema });
  const playerIds = {} as Record<ActivityPlayer, number>;

  beforeAll(async () => {
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, activityOsuIds));

    for (const [key, player] of Object.entries(activityPlayers)) {
      const [inserted] = await db
        .insert(schema.players)
        .values({
          osuId: player.osuId,
          username: `activity${player.osuId}`,
          country: ACTIVITY_COUNTRY,
          restricted: key === 'restricted',
        })
        .returning({ id: schema.players.id });
      playerIds[key as ActivityPlayer] = inserted!.id;

      await db.insert(schema.playerRatings).values({
        playerId: inserted!.id,
        ruleset: Ruleset.Osu,
        rating: 1500,
        volatility: 100,
        percentile: 0.5,
        globalRank: player.globalRank,
        countryRank: player.globalRank,
      });
      await seedMatchAdjustments(db, [inserted!.id], player.lastMatchAgo);
    }

    // The active player's friends are the other two.
    await db.insert(schema.playerFriends).values([
      { playerId: playerIds.active, friendId: playerIds.inactive },
      { playerId: playerIds.active, friendId: playerIds.restricted },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, activityOsuIds));
    await pool.end();
  });

  const listed = (result: Awaited<ReturnType<typeof runLeaderboard>>) =>
    result.leaderboard.map((entry) => ({
      osuId: entry.player.osuId,
      globalRank: entry.globalRank,
      inactive: entry.inactive,
    }));

  it('lists only active, unrestricted players by default', async () => {
    const result = await runLeaderboard({
      input: { country: ACTIVITY_COUNTRY },
      context: { db },
    });

    expect(listed(result)).toEqual([
      { osuId: activityPlayers.active.osuId, globalRank: 2, inactive: false },
    ]);
    expect(result.total).toBe(1);
    // The time of the player's last Match adjustment, to the minute.
    const lastMatchAgo =
      Date.now() - Date.parse(result.leaderboard[0]!.lastMatchTime!);
    expect(
      Math.abs(lastMatchAgo - activityPlayers.active.lastMatchAgo)
    ).toBeLessThan(60_000);
  });

  it('adds inactive players, marked inactive, when asked', async () => {
    const result = await runLeaderboard({
      input: { country: ACTIVITY_COUNTRY, includeInactive: true },
      context: { db },
    });

    expect(listed(result)).toEqual([
      { osuId: activityPlayers.inactive.osuId, globalRank: 1, inactive: true },
      { osuId: activityPlayers.active.osuId, globalRank: 2, inactive: false },
    ]);
  });

  it('lists inactive friends whatever the option says, never restricted ones', async () => {
    const friendsOf = async (includeInactive: boolean) =>
      listed(
        await runLeaderboard({
          input: { includeInactive },
          context: { db },
          friendUserId: playerIds.active,
        })
      );
    const friends = [
      { osuId: activityPlayers.inactive.osuId, globalRank: 1, inactive: true },
      { osuId: activityPlayers.active.osuId, globalRank: 2, inactive: false },
    ];

    expect(await friendsOf(false)).toEqual(friends);
    expect(await friendsOf(true)).toEqual(friends);
  });
});
