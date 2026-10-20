import { afterAll, describe, expect, it } from 'bun:test';
import { sql, TransactionRollbackError } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { JobQueue } from '@otr/core/jobs';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import {
  findDuePlatformStats,
  PlatformStatKey,
  readPlatformStats,
  refreshPlatformStats,
} from '@otr/core/platform-stats';

import type { DatabaseClient } from '../../db';
import { createJobsTestDb, silentLogger } from '../../jobs/__tests__/test-db';
import { PlatformStatsScheduler } from '../platform-stats-scheduler';

// CI's checks job sets this to its migrated test database.
const url = process.env.SEARCH_TEST_DATABASE_URL;

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

const { Verified, PreVerified, PreRejected, None } = VerificationStatus;

// A Wednesday, outside the maintenance window.
const NOW = new Date('2026-10-14T15:00:00Z');
const hoursBefore = (date: Date, hours: number) =>
  new Date(date.getTime() - hours * 3_600_000);

let nextOsuId = 990_100_000;
const osuId = () => nextOsuId++;

describe.skipIf(!url)('platform stats', () => {
  const { pool, db } = createJobsTestDb(url!);

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Runs `test` on an empty copy of the tables the statistics read, inside a
   * transaction that is rolled back, so other tests' rows neither count nor
   * change.
   */
  const onEmptyTables = async (test: (tx: Transaction) => Promise<void>) => {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`delete from ${schema.platformStats}`);
        await tx.execute(sql`delete from ${schema.tournaments}`);
        await tx.execute(sql`delete from ${schema.players}`);
        await tx.execute(sql`delete from jobs`);
        await test(tx);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  };

  const seedPlayer = async (tx: Transaction) => {
    const id = osuId();
    const [player] = await tx
      .insert(schema.players)
      .values({ osuId: id, username: `stats${id}` })
      .returning({ id: schema.players.id });
    return player!.id;
  };

  const seedRating = (
    tx: Transaction,
    playerId: number,
    ruleset: Ruleset,
    created?: Date
  ) =>
    tx.insert(schema.playerRatings).values({
      playerId,
      ruleset,
      rating: 1000,
      volatility: 100,
      percentile: 50,
      globalRank: 1,
      countryRank: 1,
      ...(created ? { created: created.toISOString() } : {}),
    });

  const seedTournament = async (
    tx: Transaction,
    verificationStatus: VerificationStatus
  ) => {
    const id = osuId();
    const [tournament] = await tx
      .insert(schema.tournaments)
      .values({
        name: `Platform stats ${id}`,
        abbreviation: `PS${id}`,
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${id}`,
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
        verificationStatus,
      })
      .returning({ id: schema.tournaments.id });
    return tournament!.id;
  };

  const seedMatch = async (
    tx: Transaction,
    tournamentId: number,
    verificationStatus: VerificationStatus
  ) => {
    const [match] = await tx
      .insert(schema.matches)
      .values({ osuId: osuId(), tournamentId, verificationStatus })
      .returning({ id: schema.matches.id });
    return match!.id;
  };

  /** A game with one score per status in `scores`. */
  const seedGame = async (
    tx: Transaction,
    matchId: number,
    verificationStatus: VerificationStatus,
    scores: VerificationStatus[]
  ) => {
    const [game] = await tx
      .insert(schema.games)
      .values({
        osuId: osuId(),
        ruleset: Ruleset.Osu,
        scoringType: 3,
        teamType: 2,
        mods: 0,
        matchId,
        verificationStatus,
      })
      .returning({ id: schema.games.id });

    for (const [index, status] of scores.entries()) {
      await tx.insert(schema.gameScores).values({
        rawScore: 500_000,
        legacyTotalScore: 500_000,
        placement: index + 1,
        accuracy: 0.95,
        maxCombo: 100,
        pass: true,
        isPerfectCombo: false,
        legacyPerfect: false,
        grade: 2,
        mods: 0,
        team: 1,
        ruleset: Ruleset.Osu,
        verificationStatus: status,
        rejectionReason: 0,
        gameId: game!.id,
        playerId: await seedPlayer(tx),
      });
    }
  };

  const storedRows = async (tx: Transaction) => {
    const { rows } = await tx.execute<{
      name: string;
      ruleset: number | null;
      version: number;
      computed_at: string;
    }>(
      sql`select name, ruleset, version, computed_at from ${schema.platformStats} order by name`
    );
    return rows.map((row) => ({
      ...row,
      computed_at: new Date(row.computed_at).toISOString(),
    }));
  };

  it('counts verified data only under verified parents in the headline totals', async () => {
    await onEmptyTables(async (tx) => {
      const verified = await seedTournament(tx, Verified);
      const verifiedMatch = await seedMatch(tx, verified, Verified);
      // Two verified scores count; the pre-rejected one does not.
      await seedGame(tx, verifiedMatch, Verified, [
        Verified,
        Verified,
        PreRejected,
      ]);
      // A verified score in a game that is not verified does not count.
      await seedGame(tx, verifiedMatch, PreVerified, [Verified]);
      // Nor does anything in a match that is not verified.
      const pendingMatch = await seedMatch(tx, verified, None);
      await seedGame(tx, pendingMatch, Verified, [Verified]);
      // Nor in a tournament that is not verified.
      const preVerified = await seedTournament(tx, PreVerified);
      const matchOfPreVerified = await seedMatch(tx, preVerified, Verified);
      await seedGame(tx, matchOfPreVerified, Verified, [Verified]);

      // One player rated in two rulesets is one rated player.
      const twoRulesets = await seedPlayer(tx);
      await seedRating(tx, twoRulesets, Ruleset.Osu);
      await seedRating(tx, twoRulesets, Ruleset.Taiko);
      await seedRating(tx, await seedPlayer(tx), Ruleset.Osu);

      await refreshPlatformStats(tx, { now: NOW, all: true });
      const stored = await readPlatformStats(tx);

      expect(
        stored.find((stat) => stat.key === PlatformStatKey.HeadlineTotals)
          ?.payload
      ).toEqual({
        tournaments: 1,
        matches: 1,
        games: 1,
        scores: 2,
        ratedPlayers: 2,
      });
    });
  });

  it.each([
    ['has no row', 48, null, true],
    ['was computed after the day and the rating run began', 2, 1, false],
    ['was computed before the UTC day began', 48, 16, true],
    ['was computed before the latest rating run began', 2, 3, true],
  ] as const)(
    'finds a statistic due when it %s',
    async (_, ratingRunHoursAgo, computedHoursAgo, expectedDue) => {
      await onEmptyTables(async (tx) => {
        await seedRating(
          tx,
          await seedPlayer(tx),
          Ruleset.Osu,
          hoursBefore(NOW, ratingRunHoursAgo)
        );
        if (computedHoursAgo !== null) {
          await refreshPlatformStats(tx, {
            now: hoursBefore(NOW, computedHoursAgo),
            all: true,
          });
        }

        const due = (await findDuePlatformStats(tx, NOW)).map(
          (definition) => definition.key
        );
        expect(due.includes(PlatformStatKey.HeadlineTotals)).toBe(expectedDue);
      });
    }
  );

  it('neither serves nor keeps a row of another version', async () => {
    await onEmptyTables(async (tx) => {
      await refreshPlatformStats(tx, { now: NOW, all: true });
      await tx.execute(
        sql`update ${schema.platformStats} set version = version + 1`
      );

      expect(
        (await readPlatformStats(tx)).map((stat) => stat.key)
      ).not.toContain(PlatformStatKey.HeadlineTotals);
      expect(
        (await findDuePlatformStats(tx, NOW)).map(
          (definition) => definition.key
        )
      ).toContain(PlatformStatKey.HeadlineTotals);
    });
  });

  it('replaces due rows and deletes rows of keys no definition uses', async () => {
    await onEmptyTables(async (tx) => {
      await refreshPlatformStats(tx, { now: hoursBefore(NOW, 30), all: true });
      await tx.execute(sql`
        insert into ${schema.platformStats} (name, ruleset, payload, version, computed_at)
        values ('retired-stat', null, '{}'::jsonb, 1, now())`);

      const { refreshed } = await refreshPlatformStats(tx, { now: NOW });

      expect(refreshed).toContain(PlatformStatKey.HeadlineTotals);
      expect(await storedRows(tx)).toEqual([
        {
          name: PlatformStatKey.HeadlineTotals,
          ruleset: null,
          version: 1,
          computed_at: NOW.toISOString(),
        },
      ]);
    });
  });

  describe('scheduler', () => {
    const queuedRefreshes = async (tx: Transaction) => {
      const { rows } = await tx.execute<{ count: string }>(
        sql`select count(*) from jobs where queue = ${JobQueue.PlatformStats}`
      );
      return Number(rows[0]!.count);
    };

    const scheduler = (tx: Transaction, now: Date) =>
      new PlatformStatsScheduler({
        db: tx as unknown as DatabaseClient,
        logger: silentLogger,
        maintenanceWindowEnabled: true,
        now: () => now,
      });

    it('queues one refresh while a statistic is due', async () => {
      await onEmptyTables(async (tx) => {
        expect(await scheduler(tx, NOW).check()).toBe('queued');
        expect(await scheduler(tx, NOW).check()).toBe('queued');
        expect(await queuedRefreshes(tx)).toBe(1);
      });
    });

    it('queues nothing when every statistic is fresh', async () => {
      await onEmptyTables(async (tx) => {
        await refreshPlatformStats(tx, { now: NOW, all: true });

        expect(await scheduler(tx, NOW).check()).toBe('fresh');
        expect(await queuedRefreshes(tx)).toBe(0);
      });
    });

    it('checks nothing inside the maintenance window', async () => {
      await onEmptyTables(async (tx) => {
        // Tuesday 12:00 UTC.
        const inWindow = new Date('2026-10-13T12:00:00Z');

        expect(await scheduler(tx, inWindow).check()).toBe('maintenance');
        expect(await queuedRefreshes(tx)).toBe(0);
      });
    });
  });
});
