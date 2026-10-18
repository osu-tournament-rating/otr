import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { asc, inArray, like } from 'drizzle-orm';

import { refetchTournamentMatchDataHandler } from '../adminProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import { Ruleset } from '@otr/core/osu';

import {
  adminSession,
  backOffJobs,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
  transactionFaults,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'tournament-refetch-match-jobs-';
const USER_OSU_ID = 991_201_200;
const STABLE_MATCH_ID = 991_201_201;
const LAZER_MATCH_ID = 991_201_202;
const OTHER_MATCH_ID = 991_201_203;

describe.skipIf(!testDatabaseUrl)('refetchTournamentMatchDataHandler', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let userId = 0;
  let tournamentId = 0;

  const removeSeed = async () => {
    if (userId) {
      await deleteJobs(db, userId);
    }
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
  };

  beforeEach(async () => {
    await removeSeed();
    userId ||= await seedAdminUser(db, USER_OSU_ID);

    const tournament = (suffix: string) => ({
      name: `${NAME_PREFIX}${suffix}`,
      abbreviation: 'TRM',
      forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
      rankRangeLowerBound: 1,
      ruleset: Ruleset.Osu,
      lobbySize: 1,
    });
    const [target, other] = await db
      .insert(schema.tournaments)
      .values([tournament('target'), tournament('other')])
      .returning({ id: schema.tournaments.id });
    tournamentId = target!.id;

    const fetched = { dataFetchStatus: DataFetchStatus.Fetched };
    await db.insert(schema.matches).values([
      { ...fetched, osuId: STABLE_MATCH_ID, tournamentId, isLazer: false },
      { ...fetched, osuId: LAZER_MATCH_ID, tournamentId, isLazer: true },
      { ...fetched, osuId: OTHER_MATCH_ID, tournamentId: other!.id },
    ]);
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  const refetch = (client: DatabaseClient = db) =>
    refetchTournamentMatchDataHandler({
      input: { id: tournamentId },
      context: { db: client, session: adminSession(userId) },
    });

  const matchStatuses = () =>
    db
      .select({
        osuId: schema.matches.osuId,
        dataFetchStatus: schema.matches.dataFetchStatus,
      })
      .from(schema.matches)
      .where(
        inArray(schema.matches.osuId, [
          STABLE_MATCH_ID,
          LAZER_MATCH_ID,
          OTHER_MATCH_ID,
        ])
      )
      .orderBy(asc(schema.matches.osuId));

  it('resets and queues a fetch for every match in the tournament', async () => {
    const result = await refetch();

    expect(result).toEqual({ success: true, matchesUpdated: 2 });
    expect(await matchStatuses()).toEqual([
      { osuId: STABLE_MATCH_ID, dataFetchStatus: DataFetchStatus.NotFetched },
      { osuId: LAZER_MATCH_ID, dataFetchStatus: DataFetchStatus.NotFetched },
      { osuId: OTHER_MATCH_ID, dataFetchStatus: DataFetchStatus.Fetched },
    ]);
    expect(await queuedFetches(db, userId)).toEqual([
      expect.objectContaining({
        payload: { type: 'match', osuMatchId: STABLE_MATCH_ID, isLazer: false },
        tournamentId,
      }),
      expect.objectContaining({
        payload: { type: 'match', osuMatchId: LAZER_MATCH_ID, isLazer: true },
        tournamentId,
      }),
    ]);
  });

  it('runs a fetch waiting out a retry now', async () => {
    await enqueueJobs(db, JobQueue.OsuFetch, [
      {
        payload: { type: 'match', osuMatchId: STABLE_MATCH_ID, isLazer: false },
        requestedByUserId: userId,
      },
    ]);
    await backOffJobs(db, userId);

    await refetch();

    const [job] = await queuedFetches(db, userId);
    expect(job!.payload.osuMatchId).toBe(STABLE_MATCH_ID);
    expect(job!.attempts).toBe(0);
    // The backoff put it an hour out.
    expect(job!.runAfter.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it.each(transactionFaults)(
    'leaves match statuses alone when %s',
    async (_label, fault, message) => {
      await expect(refetch(fault(db))).rejects.toThrow(message);

      expect(
        (await matchStatuses()).map((match) => match.dataFetchStatus)
      ).toEqual([
        DataFetchStatus.Fetched,
        DataFetchStatus.Fetched,
        DataFetchStatus.Fetched,
      ]);
      expect(await queuedFetches(db, userId)).toEqual([]);
    }
  );
});
