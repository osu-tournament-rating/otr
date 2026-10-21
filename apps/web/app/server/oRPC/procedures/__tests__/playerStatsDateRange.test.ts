import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  RatingAdjustmentType,
  Ruleset,
  VerificationStatus,
} from '@otr/core/osu';

import { getPlayerStats } from '../playerProcedures';
import { createTestDb, testDatabaseUrl } from './test-utils';

const NAME_PREFIX = 'player-stats-range-';
const PLAYER_OSU_ID = 999_161_001;
const MATCH_OSU_ID_BASE = 999_161_100;

interface AdjustmentSeed {
  month: number;
  type: RatingAdjustmentType;
  before: number;
  after: number;
}

// Ten osu! rating changes, so the player is established. Each Match change
// gets a match the player has stats for in the same month.
const OSU_ADJUSTMENTS: AdjustmentSeed[] = [
  { month: 1, type: RatingAdjustmentType.Initial, before: 0, after: 1000 },
  { month: 2, type: RatingAdjustmentType.Match, before: 1000, after: 1020 },
  { month: 3, type: RatingAdjustmentType.Match, before: 1020, after: 1040 },
  { month: 4, type: RatingAdjustmentType.Match, before: 1040, after: 1060 },
  { month: 5, type: RatingAdjustmentType.Match, before: 1060, after: 1080 },
  { month: 6, type: RatingAdjustmentType.Decay, before: 1080, after: 1075 },
  { month: 7, type: RatingAdjustmentType.Match, before: 1075, after: 1100 },
  { month: 8, type: RatingAdjustmentType.Match, before: 1100, after: 1090 },
  { month: 9, type: RatingAdjustmentType.Match, before: 1090, after: 1110 },
  { month: 10, type: RatingAdjustmentType.Match, before: 1110, after: 1050 },
];

// Nine taiko rating changes, one short of established.
const TAIKO_ADJUSTMENTS: AdjustmentSeed[] = [
  { month: 1, type: RatingAdjustmentType.Initial, before: 0, after: 900 },
  ...[2, 3, 4, 5, 6, 7, 8, 9].map((month) => ({
    month,
    type: RatingAdjustmentType.Decay,
    before: 900 - (month - 2) * 5,
    after: 900 - (month - 1) * 5,
  })),
];

/** From the start of August, which leaves out seven osu! changes. */
const RANGE = { dateMin: '2024-08-01', dateMax: '2024-12-31' } as const;

const midMonth = (month: number) =>
  `2024-${String(month).padStart(2, '0')}-15T12:00:00Z`;

describe.skipIf(!testDatabaseUrl)('getPlayerStats with a date range', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let playerId = 0;

  const remove = async () => {
    // Cascades to matches and their stats
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    // Cascades to ratings and their adjustments
    await db
      .delete(schema.players)
      .where(eq(schema.players.osuId, PLAYER_OSU_ID));
  };

  const seedRating = async (
    ruleset: Ruleset,
    adjustments: AdjustmentSeed[],
    matchIdsByMonth: Map<number, number>
  ) => {
    const [rating] = await db
      .insert(schema.playerRatings)
      .values({
        playerId,
        ruleset,
        rating: adjustments.at(-1)!.after,
        volatility: 200,
        percentile: 0.5,
        globalRank: 1,
        countryRank: 1,
      })
      .returning({ id: schema.playerRatings.id });

    await db.insert(schema.ratingAdjustments).values(
      adjustments.map((adjustment) => ({
        adjustmentType: adjustment.type,
        ruleset,
        timestamp: midMonth(adjustment.month),
        ratingBefore: adjustment.before,
        ratingAfter: adjustment.after,
        volatilityBefore: 200,
        volatilityAfter: 200,
        playerRatingId: rating!.id,
        playerId,
        matchId:
          adjustment.type === RatingAdjustmentType.Match
            ? matchIdsByMonth.get(adjustment.month)!
            : null,
      }))
    );
  };

  beforeAll(async () => {
    await remove();

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: PLAYER_OSU_ID, username: 'stats-range' })
      .returning({ id: schema.players.id });
    playerId = player!.id;

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}osu`,
        abbreviation: 'PSR',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999161',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 4,
        verificationStatus: VerificationStatus.Verified,
      })
      .returning({ id: schema.tournaments.id });

    const matchIdsByMonth = new Map<number, number>();
    for (const adjustment of OSU_ADJUSTMENTS) {
      if (adjustment.type !== RatingAdjustmentType.Match) continue;

      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: MATCH_OSU_ID_BASE + adjustment.month,
          name: `${NAME_PREFIX}match-${adjustment.month}`,
          tournamentId: tournament!.id,
          startTime: midMonth(adjustment.month),
          verificationStatus: VerificationStatus.Verified,
        })
        .returning({ id: schema.matches.id });
      matchIdsByMonth.set(adjustment.month, match!.id);

      await db.insert(schema.playerMatchStats).values({
        matchCost: 1,
        averageScore: 500_000,
        averagePlacement: 1,
        averageMisses: 0,
        averageAccuracy: 0.98,
        gamesPlayed: 3,
        gamesWon: 2,
        gamesLost: 1,
        won: adjustment.after > adjustment.before,
        teammateIds: [],
        opponentIds: [],
        playerId,
        matchId: match!.id,
      });
    }

    await seedRating(Ruleset.Osu, OSU_ADJUSTMENTS, matchIdsByMonth);
    await seedRating(Ruleset.Taiko, TAIKO_ADJUSTMENTS, matchIdsByMonth);
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  const stats = (input: {
    ruleset: Ruleset;
    dateMin?: string;
    dateMax?: string;
  }) =>
    call(
      getPlayerStats,
      { id: playerId, keyType: 'otr', ...input },
      { context: { db, headers: new Headers() } }
    );

  it('counts the first rating change in the range toward the rating gained', async () => {
    const ranged = await stats({ ruleset: Ruleset.Osu, ...RANGE });
    // August's change starts from 1100 and October's ends on 1050
    expect(ranged.matchStats?.ratingGained).toBe(1050 - 1100);

    const allTime = await stats({ ruleset: Ruleset.Osu });
    // From the initial rating of 1000, which has no rating before it
    expect(allTime.matchStats?.ratingGained).toBe(1050 - 1000);
  });

  it('calls a player provisional by all their rating changes, not those in the range', async () => {
    const osu = await stats({ ruleset: Ruleset.Osu, ...RANGE });
    expect(osu.rating?.adjustments).toHaveLength(3);
    expect(osu.rating?.isProvisional).toBe(false);

    const taiko = await stats({ ruleset: Ruleset.Taiko, ...RANGE });
    expect(taiko.rating?.adjustments).toHaveLength(2);
    expect(taiko.rating?.isProvisional).toBe(true);
  });
});
