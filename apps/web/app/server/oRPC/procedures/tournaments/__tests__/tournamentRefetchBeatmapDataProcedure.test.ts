import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { asc, inArray, like } from 'drizzle-orm';

import { refetchTournamentBeatmapsHandler } from '../adminProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { MessagePriority } from '@otr/core';
import { Ruleset } from '@otr/core/osu';
import { createPlaceholderBeatmap } from '../beatmapPlaceholders';

import {
  adminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
  transactionFaults,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'tournament-refetch-beatmap-jobs-';
const USER_OSU_ID = 991_201_300;
const FETCHED_BEATMAP_ID = 991_201_301;
const NOT_FOUND_BEATMAP_ID = 991_201_302;
const UNPOOLED_BEATMAP_ID = 991_201_303;
const BEATMAP_IDS = [
  FETCHED_BEATMAP_ID,
  NOT_FOUND_BEATMAP_ID,
  UNPOOLED_BEATMAP_ID,
];

describe.skipIf(!testDatabaseUrl)('refetchTournamentBeatmapsHandler', () => {
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
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, BEATMAP_IDS));
  };

  beforeEach(async () => {
    await removeSeed();
    userId ||= await seedAdminUser(db, USER_OSU_ID);

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}pool`,
        abbreviation: 'TRB',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;

    const beatmap = (osuId: number, dataFetchStatus: DataFetchStatus) => ({
      ...createPlaceholderBeatmap(osuId, Ruleset.Osu),
      dataFetchStatus,
    });
    const [fetched, notFound] = await db
      .insert(schema.beatmaps)
      .values([
        beatmap(FETCHED_BEATMAP_ID, DataFetchStatus.Fetched),
        beatmap(NOT_FOUND_BEATMAP_ID, DataFetchStatus.NotFound),
        beatmap(UNPOOLED_BEATMAP_ID, DataFetchStatus.Fetched),
      ])
      .returning({ id: schema.beatmaps.id });

    await db.insert(schema.joinPooledBeatmaps).values([
      { pooledBeatmapsId: fetched!.id, tournamentsPooledInId: tournamentId },
      { pooledBeatmapsId: notFound!.id, tournamentsPooledInId: tournamentId },
    ]);
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  const refetch = (client: DatabaseClient = db) =>
    refetchTournamentBeatmapsHandler({
      input: { id: tournamentId },
      context: { db: client, session: adminSession(userId) },
    });

  const statuses = async () =>
    (
      await db
        .select({ dataFetchStatus: schema.beatmaps.dataFetchStatus })
        .from(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, BEATMAP_IDS))
        .orderBy(asc(schema.beatmaps.osuId))
    ).map((row) => row.dataFetchStatus);

  it('resets and queues every pooled beatmap osu! still serves', async () => {
    const result = await refetch();

    expect(result).toEqual({
      success: true,
      beatmapsUpdated: 1,
      beatmapsSkipped: 1,
    });
    expect(await statuses()).toEqual([
      DataFetchStatus.NotFetched,
      DataFetchStatus.NotFound,
      DataFetchStatus.Fetched,
    ]);
    expect(await queuedFetches(db, userId)).toEqual([
      expect.objectContaining({
        payload: {
          type: 'beatmap',
          beatmapId: FETCHED_BEATMAP_ID,
          skipAutomationChecks: true,
        },
        priority: MessagePriority.High,
        tournamentId,
      }),
    ]);
  });

  it.each(transactionFaults)(
    'leaves beatmap statuses alone when %s',
    async (_label, fault, message) => {
      await expect(refetch(fault(db))).rejects.toThrow(message);

      expect(await statuses()).toEqual([
        DataFetchStatus.Fetched,
        DataFetchStatus.NotFound,
        DataFetchStatus.Fetched,
      ]);
      expect(await queuedFetches(db, userId)).toEqual([]);
    }
  );
});
