import { afterAll, describe, expect, it } from 'bun:test';
import { sql, TransactionRollbackError } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  RatingAdjustmentType,
  Ruleset,
  Team,
  VerificationStatus,
} from '@otr/core/osu';
import {
  type BiggestUpsets,
  type ClosestGames,
  type HigherRatedWins,
  PLATFORM_STATS,
  PlatformStatKey,
  type PlatformStatsRuleset,
} from '@otr/core/platform-stats';

import type { DatabaseClient } from '../../db';
import { createJobsTestDb } from '../../jobs/__tests__/test-db';

// CI's checks job sets this to its migrated test database.
const url = process.env.SEARCH_TEST_DATABASE_URL;

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

const { Verified, PreVerified, Rejected } = VerificationStatus;

/**
 * The newest verified tournament ends here in every test, so the last 12
 * months start on Aug 1, 2025.
 */
const NEWEST_END = '2026-08-01T00:00:00Z';
const IN_WINDOW = '2026-03-01T12:00:00Z';
const BEFORE_WINDOW = '2025-07-15T12:00:00Z';

/** A minute after `IN_WINDOW`, for games played in order. */
const minute = (n: number) =>
  new Date(Date.parse(IN_WINDOW) + n * 60_000).toISOString();

let nextOsuId = 990_300_000;
const osuId = () => nextOsuId++;

interface SidePlayer {
  id: number;
  /** The rating going into the match; null for a player without one. */
  rating: number | null;
}

interface Side {
  score: number;
  players: SidePlayer[];
}

describe.skipIf(!url)('match and tournament platform stats', () => {
  const { pool, db } = createJobsTestDb(url!);

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Runs `test` with no tournaments or players but its own, inside a
   * transaction that is rolled back.
   */
  const onEmptyTables = async (test: (tx: Transaction) => Promise<void>) => {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`delete from ${schema.platformStats}`);
        await tx.execute(sql`delete from ${schema.tournaments}`);
        await tx.execute(sql`delete from ${schema.players}`);
        await test(tx);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  };

  /** One stored statistic's payload for every rated ruleset. */
  const compute = async <T>(
    tx: Transaction,
    key: PlatformStatKey
  ): Promise<Record<PlatformStatsRuleset, T>> => {
    const definition = PLATFORM_STATS.find((item) => item.key === key);
    if (definition?.scope !== 'ruleset') {
      throw new Error(`${key} is not a per-ruleset statistic`);
    }
    return (await definition.compute(tx)) as Record<PlatformStatsRuleset, T>;
  };

  const fixtures = (tx: Transaction) => {
    const ratingIds = new Map<string, number>();

    const player = async () => {
      const id = osuId();
      const [row] = await tx
        .insert(schema.players)
        .values({ osuId: id, username: `match-stats-${id}` })
        .returning({ id: schema.players.id });
      return row!.id;
    };

    const ratingId = async (playerId: number, ruleset: Ruleset) => {
      const cacheKey = `${playerId}:${ruleset}`;
      const cached = ratingIds.get(cacheKey);
      if (cached !== undefined) return cached;

      const [row] = await tx
        .insert(schema.playerRatings)
        .values({
          playerId,
          ruleset,
          rating: 1000,
          volatility: 200,
          percentile: 50,
          globalRank: 1,
          countryRank: 1,
        })
        .returning({ id: schema.playerRatings.id });
      ratingIds.set(cacheKey, row!.id);
      return row!.id;
    };

    const adjustment = async (
      playerId: number,
      {
        ruleset,
        matchId,
        ratingBefore,
        timestamp,
      }: {
        ruleset: Ruleset;
        matchId: number | null;
        ratingBefore: number;
        timestamp: string;
      }
    ) =>
      tx.insert(schema.ratingAdjustments).values({
        adjustmentType: RatingAdjustmentType.Match,
        ruleset,
        timestamp,
        ratingBefore,
        ratingAfter: ratingBefore,
        volatilityBefore: 200,
        volatilityAfter: 200,
        playerRatingId: await ratingId(playerId, ruleset),
        playerId,
        matchId,
      });

    /**
     * Rated matches a player played in 2020, before every match a test
     * seeds. Only their count matters, so they belong to no match row.
     */
    const earlierMatches = async (
      playerId: number,
      count: number,
      ruleset: Ruleset = Ruleset.Osu
    ) => {
      for (let index = 0; index < count; index++) {
        await adjustment(playerId, {
          ruleset,
          matchId: null,
          ratingBefore: 1000,
          timestamp: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
        });
      }
    };

    /** New players going into a match rated `ratings` (null: unrated). */
    const side = async (
      score: number,
      ...ratings: (number | null)[]
    ): Promise<Side> => {
      const players: SidePlayer[] = [];
      for (const rating of ratings) {
        players.push({ id: await player(), rating });
      }
      return { score, players };
    };

    /** Like `side`, with players who each had 10 earlier rated matches. */
    const veterans = async (score: number, ...ratings: number[]) => {
      const seeded = await side(score, ...ratings);
      for (const { id } of seeded.players) await earlierMatches(id, 10);
      return seeded;
    };

    const tournament = async ({
      status = Verified,
      ruleset = Ruleset.Osu,
      end = NEWEST_END,
    }: {
      status?: VerificationStatus;
      ruleset?: Ruleset;
      end?: string;
    } = {}) => {
      const id = osuId();
      const [row] = await tx
        .insert(schema.tournaments)
        .values({
          name: `Match stats ${id}`,
          abbreviation: `MS${id}`,
          forumUrl: `https://osu.ppy.sh/community/forums/topics/${id}`,
          rankRangeLowerBound: 1,
          ruleset,
          lobbySize: 1,
          verificationStatus: status,
          startTime: '2025-01-01T00:00:00Z',
          endTime: end,
        })
        .returning({ id: schema.tournaments.id });
      return row!.id;
    };

    /**
     * A match between `red` and `blue`, named `MS: (red) vs (blue)`. Each
     * rated player goes into it with their rating.
     */
    const match = async (
      tournamentId: number,
      {
        status = Verified,
        ruleset = Ruleset.Osu,
        start = IN_WINDOW,
        red,
        blue,
      }: {
        status?: VerificationStatus;
        ruleset?: Ruleset;
        start?: string;
        red: Side;
        blue: Side;
      }
    ) => {
      const [row] = await tx
        .insert(schema.matches)
        .values({
          osuId: osuId(),
          name: 'MS: (red) vs (blue)',
          tournamentId,
          verificationStatus: status,
          startTime: start,
        })
        .returning({ id: schema.matches.id });
      const matchId = row!.id;

      for (const [team, roster] of [
        [Team.Red, red],
        [Team.Blue, blue],
      ] as const) {
        await tx.insert(schema.matchRosters).values({
          matchId,
          team,
          score: roster.score,
          roster: roster.players.map((item) => item.id),
        });
        for (const item of roster.players) {
          if (item.rating === null) continue;
          await adjustment(item.id, {
            ruleset,
            matchId,
            ratingBefore: item.rating,
            timestamp: start,
          });
        }
      }

      return matchId;
    };

    /** A game of `matchId`; the side with more points wins it. */
    const game = async (
      matchId: number,
      {
        red,
        blue,
        start,
        status = Verified,
        beatmapId = null,
      }: {
        red: number;
        blue: number;
        start: string;
        status?: VerificationStatus;
        beatmapId?: number | null;
      }
    ) => {
      const [row] = await tx
        .insert(schema.games)
        .values({
          osuId: osuId(),
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 2,
          mods: 0,
          matchId,
          verificationStatus: status,
          startTime: start,
          endTime: start,
          beatmapId,
        })
        .returning({ id: schema.games.id });

      await tx.insert(schema.gameRosters).values([
        { gameId: row!.id, team: Team.Red, score: red, roster: [1] },
        { gameId: row!.id, team: Team.Blue, score: blue, roster: [2] },
      ]);
    };

    /** Games won in order, `R` by red and `B` by blue, one minute apart. */
    const games = async (
      matchId: number,
      results: string,
      { reverse = false }: { reverse?: boolean } = {}
    ) => {
      const played = [...results].map((result, index) => ({
        red: result === 'R' ? 600_000 : result === '=' ? 500_000 : 400_000,
        blue: result === 'B' ? 600_000 : result === '=' ? 500_000 : 400_000,
        start: minute(index),
      }));
      for (const item of reverse ? played.reverse() : played) {
        await game(matchId, item);
      }
    };

    const beatmap = async ({
      set,
      diffName,
      titleOverride = null,
      artistOverride = null,
    }: {
      set: { artist: string; title: string } | null;
      diffName: string;
      titleOverride?: string | null;
      artistOverride?: string | null;
    }) => {
      let beatmapsetId: number | null = null;
      if (set) {
        const [row] = await tx
          .insert(schema.beatmapsets)
          .values({ osuId: osuId(), rankedStatus: 1, ...set })
          .returning({ id: schema.beatmapsets.id });
        beatmapsetId = row!.id;
      }

      const beatmapOsuId = osuId();
      const [row] = await tx
        .insert(schema.beatmaps)
        .values({
          osuId: beatmapOsuId,
          ruleset: Ruleset.Osu,
          rankedStatus: 1,
          diffName,
          totalLength: 120,
          drainLength: 110,
          bpm: 180,
          countCircle: 100,
          countSlider: 100,
          countSpinner: 1,
          cs: 4,
          hp: 5,
          od: 8,
          ar: 9,
          sr: 6,
          beatmapsetId,
          titleOverride,
          artistOverride,
        })
        .returning({ id: schema.beatmaps.id });
      return { id: row!.id, osuId: beatmapOsuId };
    };

    return {
      player,
      earlierMatches,
      side,
      veterans,
      tournament,
      match,
      game,
      games,
      beatmap,
    };
  };

  describe('higher-rated wins', () => {
    const totalMatches = (stats: HigherRatedWins) =>
      stats.buckets.reduce((sum, bucket) => sum + bucket.matches, 0);

    it('counts the higher-rated side’s wins by the gap between side averages', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament();
        // Gap 50: the higher-rated side wins.
        await f.match(osu, {
          red: await f.side(3, 1500),
          blue: await f.side(1, 1450),
        });
        // Gap 100, the second bucket's first: red's average is
        // (1000 + 2000) / 2 = 1500, and the lower-rated blue side wins.
        await f.match(osu, {
          red: await f.side(1, 1000, 2000),
          blue: await f.side(3, 1400, 1400),
        });
        // Gap 650, in the last bucket, which has no top.
        await f.match(osu, {
          red: await f.side(2, 900),
          blue: await f.side(3, 1550),
        });
        // A taiko match counts for taiko only.
        const taiko = await f.tournament({ ruleset: Ruleset.Taiko });
        await f.match(taiko, {
          ruleset: Ruleset.Taiko,
          red: await f.side(3, 1250),
          blue: await f.side(0, 1000),
        });

        const stats = await compute<HigherRatedWins>(
          tx,
          PlatformStatKey.HigherRatedWins
        );

        expect(stats[Ruleset.Osu]).toEqual({
          buckets: [
            { minGap: 0, matches: 1, higherRatedWins: 1 },
            { minGap: 100, matches: 1, higherRatedWins: 0 },
            { minGap: 200, matches: 0, higherRatedWins: 0 },
            { minGap: 300, matches: 0, higherRatedWins: 0 },
            { minGap: 400, matches: 0, higherRatedWins: 0 },
            { minGap: 500, matches: 1, higherRatedWins: 1 },
          ],
          // The middle of 50, 100 and 650.
          medianGap: 100,
        });
        expect(stats[Ruleset.Taiko].buckets[2]).toEqual({
          minGap: 200,
          matches: 1,
          higherRatedWins: 1,
        });
        expect(totalMatches(stats[Ruleset.Taiko])).toBe(1);
        expect(stats[Ruleset.Catch]).toEqual({
          buckets: expect.any(Array),
          medianGap: null,
        });
        expect(totalMatches(stats[Ruleset.Catch])).toBe(0);
      });
    });

    it('leaves out level, partly unrated and unverified matches', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament();
        // The one match that counts.
        await f.match(osu, {
          red: await f.side(3, 1300),
          blue: await f.side(1, 1000),
        });
        // Level on maps.
        await f.match(osu, {
          red: await f.side(2, 1300),
          blue: await f.side(2, 1000),
        });
        // Level on rating.
        await f.match(osu, {
          red: await f.side(3, 1200),
          blue: await f.side(1, 1200),
        });
        // A player without a rating for the match.
        await f.match(osu, {
          red: await f.side(3, 1300, null),
          blue: await f.side(1, 1000, 1000),
        });
        // A rejected match, and a verified match of a pre-verified
        // tournament.
        await f.match(osu, {
          status: Rejected,
          red: await f.side(3, 1300),
          blue: await f.side(1, 1000),
        });
        await f.match(await f.tournament({ status: PreVerified }), {
          red: await f.side(3, 1300),
          blue: await f.side(1, 1000),
        });

        const stats = await compute<HigherRatedWins>(
          tx,
          PlatformStatKey.HigherRatedWins
        );

        expect(totalMatches(stats[Ruleset.Osu])).toBe(1);
        expect(stats[Ruleset.Osu].buckets[3]).toEqual({
          minGap: 300,
          matches: 1,
          higherRatedWins: 1,
        });
      });
    });
  });

  describe('biggest upsets', () => {
    it('lists the widest upsets of the last 12 months first', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament();
        // Six upsets, gaps 100 to 600; the list keeps five.
        for (const gap of [300, 100, 600, 200, 500, 400]) {
          await f.match(osu, {
            red: await f.veterans(3, 1000),
            blue: await f.veterans(2, 1000 + gap),
          });
        }
        // A win by the higher-rated side is no upset.
        await f.match(osu, {
          red: await f.veterans(3, 2000),
          blue: await f.veterans(0, 1000),
        });
        // The widest upset of all was played before the last 12 months.
        await f.match(osu, {
          start: BEFORE_WINDOW,
          red: await f.veterans(3, 500),
          blue: await f.veterans(0, 2500),
        });

        const upsets = (
          await compute<BiggestUpsets>(tx, PlatformStatKey.BiggestUpsets)
        )[Ruleset.Osu];

        expect(upsets.total).toBe(6);
        expect(
          upsets.matches.map((item) => item.loserRating - item.winnerRating)
        ).toEqual([600, 500, 400, 300, 200]);
        expect(upsets.matches[0]).toMatchObject({
          matchName: 'MS: (red) vs (blue)',
          tournamentId: osu,
          winnerTeam: Team.Red,
          winnerScore: 3,
          loserScore: 2,
          winnerRating: 1000,
          loserRating: 1600,
        });
      });
    });

    it('counts an upset only when every player had 10 earlier rated matches in the ruleset', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament();

        // A winner with nine earlier osu! matches and one in taiko.
        const rookie = await f.player();
        await f.earlierMatches(rookie, 9);
        await f.earlierMatches(rookie, 1, Ruleset.Taiko);
        await f.match(osu, {
          red: { score: 3, players: [{ id: rookie, rating: 1000 }] },
          blue: await f.veterans(2, 1500),
        });

        // A loser with nine, beside a teammate with plenty.
        const rookieTeammate = await f.player();
        await f.earlierMatches(rookieTeammate, 9);
        const losers = await f.veterans(2, 1600);
        losers.players.push({ id: rookieTeammate, rating: 1600 });
        await f.match(osu, { red: await f.veterans(3, 1000), blue: losers });

        // Ten is enough.
        await f.match(osu, {
          red: await f.veterans(3, 1000),
          blue: await f.veterans(2, 1200),
        });

        const upsets = (
          await compute<BiggestUpsets>(tx, PlatformStatKey.BiggestUpsets)
        )[Ruleset.Osu];

        expect(upsets.total).toBe(1);
        expect(upsets.matches.map((item) => item.loserRating)).toEqual([1200]);
      });
    });
  });

  describe('closest games', () => {
    it('lists tiebreakers by the points the winners won the last verified game by', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament();
        const map = await f.beatmap({
          set: { artist: 'Camellia', title: 'Exit This Earth' },
          diffName: 'Extra',
        });
        const deletedMap = await f.beatmap({
          set: null,
          diffName: 'Insane',
          titleOverride: 'Lost Song',
          artistOverride: 'Gone Artist',
        });

        // Won 3–2 by 50 points on the last game, after a lopsided one.
        // The last game is inserted first: games go by start time.
        const byFifty = await f.match(osu, {
          red: await f.side(3, null),
          blue: await f.side(2, null),
        });
        await f.game(byFifty, {
          start: minute(10),
          red: 500_050,
          blue: 500_000,
          beatmapId: map.id,
        });
        await f.game(byFifty, { start: minute(5), red: 900_000, blue: 1_000 });

        // Won 4–3 by 10 points; a rejected game after it doesn't count.
        const byTen = await f.match(osu, {
          red: await f.side(3, null),
          blue: await f.side(4, null),
        });
        await f.game(byTen, {
          start: minute(10),
          red: 600_000,
          blue: 600_010,
          beatmapId: deletedMap.id,
        });
        await f.game(byTen, {
          start: minute(15),
          red: 900_000,
          blue: 100,
          status: Rejected,
        });

        // Won 3–1: no tiebreaker, however close the last game.
        const notTied = await f.match(osu, {
          red: await f.side(3, null),
          blue: await f.side(1, null),
        });
        await f.game(notTied, {
          start: minute(10),
          red: 500_001,
          blue: 500_000,
        });

        // Won 3–2, but the losers won the last game: the games and the
        // score disagree.
        const disagrees = await f.match(osu, {
          red: await f.side(3, null),
          blue: await f.side(2, null),
        });
        await f.game(disagrees, {
          start: minute(10),
          red: 500_000,
          blue: 500_002,
        });

        // Won 3–2 with a level last game.
        const level = await f.match(osu, {
          red: await f.side(3, null),
          blue: await f.side(2, null),
        });
        await f.game(level, { start: minute(10), red: 500_000, blue: 500_000 });

        const closest = (
          await compute<ClosestGames>(tx, PlatformStatKey.ClosestGames)
        )[Ruleset.Osu];

        expect(closest.total).toBe(2);
        expect(
          closest.games.map((item) => [item.matchId, item.margin])
        ).toEqual([
          [byTen, 10],
          [byFifty, 50],
        ]);
        expect(closest.games[0]).toMatchObject({
          winnerTeam: Team.Blue,
          winnerScore: 4,
          loserScore: 3,
          beatmap: {
            osuId: deletedMap.osuId,
            diffName: 'Insane',
            artist: 'Gone Artist',
            title: 'Lost Song',
          },
        });
        expect(closest.games[1]!.beatmap).toEqual({
          osuId: map.osuId,
          diffName: 'Extra',
          artist: 'Camellia',
          title: 'Exit This Earth',
        });
      });
    });
  });
});
