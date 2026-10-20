import { afterAll, describe, expect, it } from 'bun:test';
import { eq, sql, TransactionRollbackError } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import { PLATFORM_STATS, PlatformStatKey } from '@otr/core/platform-stats';
import type { DatabaseClient } from '@/lib/db';

import { createTestDb, testDatabaseUrl } from '../../__tests__/test-utils';
import {
  getLazerByYear,
  getPlayersByCountry,
  getRecentlyVerified,
  getVerificationSummary,
} from '../queries';
import { runStatsPage } from '../statsPageProcedures';

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

const { Verified, Rejected, None } = VerificationStatus;

let nextOsuId = 990_200_000;
const osuId = () => nextOsuId++;

describe.skipIf(!testDatabaseUrl)('stats page statistics', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Runs `test` on empty tables inside a transaction that is rolled back, so
   * other tests' rows neither count nor change.
   */
  const onEmptyTables = async (test: (tx: Transaction) => Promise<void>) => {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`delete from ${schema.platformStats}`);
        await tx.execute(sql`delete from ${schema.tournaments}`);
        await tx.execute(sql`delete from ${schema.tournamentAudits}`);
        await tx.execute(sql`delete from ${schema.players}`);
        await test(tx);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  };

  /**
   * A tournament with no audit history, so each test writes the
   * verifications it needs.
   */
  const seedTournament = async (
    tx: Transaction,
    {
      status = Verified,
      ruleset = Ruleset.Osu,
      rankRangeLowerBound = 1,
      isLazer = false,
      start = '2026-07-01T00:00:00Z',
      end = '2026-08-01T00:00:00Z' as string | null,
    }: {
      status?: VerificationStatus;
      ruleset?: Ruleset;
      rankRangeLowerBound?: number;
      isLazer?: boolean;
      start?: string;
      end?: string | null;
    } = {}
  ) => {
    const id = osuId();
    const [tournament] = await tx
      .insert(schema.tournaments)
      .values({
        name: `Stats page ${id}`,
        abbreviation: `SP${id}`,
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${id}`,
        rankRangeLowerBound,
        ruleset,
        lobbySize: 2,
        verificationStatus: status,
        isLazer,
        startTime: start,
        endTime: end,
      })
      .returning({ id: schema.tournaments.id });
    // The insert's own audit row records the status it was created with.
    await tx
      .delete(schema.tournamentAudits)
      .where(eq(schema.tournamentAudits.referenceIdLock, tournament!.id));
    return tournament!.id;
  };

  /** An audit row that set the tournament to Verified, in one of its formats. */
  const verifiedAt = (
    tx: Transaction,
    tournamentId: number,
    created: string,
    format: 'current' | 'camel' | 'pascal' = 'current'
  ) => {
    const changes = {
      current: { verification_status: { newValue: 4, originalValue: 2 } },
      camel: { verificationStatus: { newValue: 4, originalValue: 2 } },
      pascal: { verificationStatus: { NewValue: 4, OriginalValue: 2 } },
    }[format];

    return tx.insert(schema.tournamentAudits).values({
      referenceIdLock: tournamentId,
      referenceId: tournamentId,
      actionType: 1,
      changes,
      created,
    });
  };

  /**
   * T1 to T8 below, verified on the dates the cases need. The newest first
   * verification is T1's, Aug 3, so the median's window starts May 5.
   */
  const seedVerificationHistory = async (tx: Transaction) => {
    // Ended Aug 1, verified Aug 3 (2 days), verified again Aug 20.
    const t1 = await seedTournament(tx, { end: '2026-08-01T00:00:00Z' });
    await verifiedAt(tx, t1, '2026-08-03T00:00:00Z');
    await verifiedAt(tx, t1, '2026-08-20T00:00:00Z');
    // Ended Jul 1, verified Jul 11 (10 days), in the oldest format.
    const t2 = await seedTournament(tx, { end: '2026-07-01T00:00:00Z' });
    await verifiedAt(tx, t2, '2026-07-11T00:00:00Z', 'pascal');
    // Verified Jul 5, before it ended on Jul 10: zero days.
    const t3 = await seedTournament(tx, { end: '2026-07-10T00:00:00Z' });
    await verifiedAt(tx, t3, '2026-07-05T00:00:00Z', 'camel');
    // Verified, then rejected: in neither.
    const t4 = await seedTournament(tx, { status: Rejected });
    await verifiedAt(tx, t4, '2026-08-10T00:00:00Z');
    // Verified before the audit trail began: no verification on record.
    const t5 = await seedTournament(tx);
    // First verified long before the window.
    const t6 = await seedTournament(tx, { end: '2025-01-01T00:00:00Z' });
    await verifiedAt(tx, t6, '2025-02-01T00:00:00Z');
    // No end: in the feed, not in the median.
    const t7 = await seedTournament(tx, { end: null });
    await verifiedAt(tx, t7, '2026-08-05T00:00:00Z');
    // Verified Jul 17, before it ended on Jul 20: zero days.
    const t8 = await seedTournament(tx, { end: '2026-07-20T00:00:00Z' });
    await verifiedAt(tx, t8, '2026-07-17T00:00:00Z');

    return { t1, t2, t3, t4, t5, t6, t7, t8 };
  };

  it('lists verified tournaments by their latest verification, a page at a time', async () => {
    await onEmptyTables(async (tx) => {
      const { t1, t2, t3, t6, t7, t8 } = await seedVerificationHistory(tx);

      const first = await getRecentlyVerified(tx, { limit: 2 });
      const second = await getRecentlyVerified(tx, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      const third = await getRecentlyVerified(tx, {
        limit: 2,
        cursor: second.nextCursor!,
      });

      expect(first.items.map((item) => [item.id, item.verifiedAt])).toEqual([
        [t1, '2026-08-20T00:00:00.000Z'],
        [t7, '2026-08-05T00:00:00.000Z'],
      ]);
      expect(second.items.map((item) => item.id)).toEqual([t8, t2]);
      expect(third.items.map((item) => item.id)).toEqual([t3, t6]);
      expect(third.nextCursor).toBeNull();
      expect(first.totalCount).toBe(6);
    });
  });

  it('takes the median time to verify over first verifications in the window', async () => {
    await onEmptyTables(async (tx) => {
      await seedVerificationHistory(tx);

      // T1 2 days (its first verification), T2 10, T3 and T8 zero, so
      // (0 + 2) / 2. T6 is outside the window and T7 has no end.
      expect(await getVerificationSummary(tx)).toEqual({
        windowDays: 90,
        tournaments: 4,
        medianDays: 1,
      });
    });
  });

  it('counts lazer tournaments among verified ones per year', async () => {
    await onEmptyTables(async (tx) => {
      await seedTournament(tx, { start: '2025-03-01T00:00:00Z' });
      await seedTournament(tx, {
        start: '2025-06-01T00:00:00Z',
        isLazer: true,
      });
      await seedTournament(tx, {
        start: '2025-06-01T00:00:00Z',
        isLazer: true,
        status: None,
      });
      await seedTournament(tx, {
        start: '2026-01-01T00:00:00Z',
        isLazer: true,
      });

      expect(await getLazerByYear(tx)).toEqual([
        { year: 2025, total: 2, lazer: 1 },
        { year: 2026, total: 1, lazer: 1 },
      ]);
    });
  });

  it('counts rated players per ruleset and country, and the top ranks alone', async () => {
    await onEmptyTables(async (tx) => {
      const rate = async (
        country: string,
        ruleset: Ruleset,
        globalRank: number
      ) => {
        const id = osuId();
        const [player] = await tx
          .insert(schema.players)
          .values({ osuId: id, username: `country${id}`, country })
          .returning({ id: schema.players.id });
        await tx.insert(schema.playerRatings).values({
          playerId: player!.id,
          ruleset,
          rating: 1000,
          volatility: 100,
          percentile: 50,
          globalRank,
          countryRank: 1,
        });
      };

      await rate('US', Ruleset.Osu, 100);
      await rate('US', Ruleset.Osu, 101);
      await rate('', Ruleset.Osu, 2);
      await rate('JP', Ruleset.Taiko, 1);

      expect(await getPlayersByCountry(tx)).toEqual([
        { ruleset: Ruleset.Osu, country: 'US', players: 2 },
        { ruleset: Ruleset.Osu, country: 'XX', players: 1 },
        { ruleset: Ruleset.Taiko, country: 'JP', players: 1 },
      ]);
      expect(await getPlayersByCountry(tx, { topRank: 100 })).toEqual([
        { ruleset: Ruleset.Osu, country: 'US', players: 1 },
        { ruleset: Ruleset.Osu, country: 'XX', players: 1 },
        { ruleset: Ruleset.Taiko, country: 'JP', players: 1 },
      ]);
    });
  });

  it('serves a stored statistic only in the shape this release expects', async () => {
    const version = PLATFORM_STATS.find(
      (definition) => definition.key === PlatformStatKey.HeadlineTotals
    )!.version;
    const store = (tx: Transaction, payload: unknown) =>
      tx.execute(sql`
        insert into ${schema.platformStats} (name, ruleset, payload, version, computed_at)
        values (${PlatformStatKey.HeadlineTotals}, null, ${JSON.stringify(payload)}::jsonb, ${version}, now())`);
    const totals = {
      tournaments: 3,
      matches: 20,
      games: 100,
      scores: 800,
      ratedPlayers: 40,
    };

    await onEmptyTables(async (tx) => {
      await store(tx, totals);
      const page = await runStatsPage({
        context: { db: tx as unknown as DatabaseClient },
      });
      expect(page.allRulesets.totals).toEqual(totals);
    });

    await onEmptyTables(async (tx) => {
      await store(tx, { tournaments: 3 });
      const page = await runStatsPage({
        context: { db: tx as unknown as DatabaseClient },
      });
      expect(page.allRulesets.totals).toBeNull();
    });
  });
});
