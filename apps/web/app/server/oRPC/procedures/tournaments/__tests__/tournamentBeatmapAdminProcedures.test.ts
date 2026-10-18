import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';

import { manageTournamentBeatmapsAdminHandler } from '../beatmapAdminProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
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

const NAME_PREFIX = 'tournament-beatmap-admin-jobs-';
const USER_OSU_ID = 991_201_400;
const NEW_BEATMAP_ID = 991_201_401;
const PENDING_BEATMAP_ID = 991_201_402;
const FETCHED_BEATMAP_ID = 991_201_403;
const BEATMAP_IDS = [NEW_BEATMAP_ID, PENDING_BEATMAP_ID, FETCHED_BEATMAP_ID];

describe.skipIf(!testDatabaseUrl)(
  'manageTournamentBeatmapsAdminHandler',
  () => {
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
          abbreviation: 'TBA',
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 1,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;

      await db.insert(schema.beatmaps).values([
        {
          ...createPlaceholderBeatmap(PENDING_BEATMAP_ID, Ruleset.Osu),
          dataFetchStatus: DataFetchStatus.NotFetched,
        },
        {
          ...createPlaceholderBeatmap(FETCHED_BEATMAP_ID, Ruleset.Osu),
          dataFetchStatus: DataFetchStatus.Fetched,
        },
      ]);
    });

    afterAll(async () => {
      await removeSeed();
      await removePlayers(db, [USER_OSU_ID]);
      await pool.end();
    });

    const addBeatmaps = (client: DatabaseClient = db) =>
      manageTournamentBeatmapsAdminHandler({
        input: {
          tournamentId,
          addBeatmapOsuIds: BEATMAP_IDS,
          removeBeatmapIds: [],
        },
        context: { db: client, session: adminSession(userId) },
      });

    const pooledOsuIds = async () =>
      (
        await db
          .select({ osuId: schema.beatmaps.osuId })
          .from(schema.joinPooledBeatmaps)
          .innerJoin(
            schema.beatmaps,
            eq(schema.beatmaps.id, schema.joinPooledBeatmaps.pooledBeatmapsId)
          )
          .where(
            eq(schema.joinPooledBeatmaps.tournamentsPooledInId, tournamentId)
          )
      )
        .map((row) => row.osuId)
        .sort();

    it('queues fetches for new placeholders and pooled beatmaps still pending data', async () => {
      const result = await addBeatmaps();

      expect(result).toEqual({ success: true, addedCount: 3, skippedCount: 0 });
      expect(await pooledOsuIds()).toEqual(BEATMAP_IDS);
      expect(await queuedFetches(db, userId)).toEqual([
        expect.objectContaining({
          payload: { type: 'beatmap', beatmapId: NEW_BEATMAP_ID },
          tournamentId,
        }),
        expect.objectContaining({
          payload: { type: 'beatmap', beatmapId: PENDING_BEATMAP_ID },
          tournamentId,
        }),
      ]);
    });

    it.each(transactionFaults)(
      'adds no placeholder or pool entry when %s',
      async (_label, fault, message) => {
        await expect(addBeatmaps(fault(db))).rejects.toThrow(message);

        expect(await pooledOsuIds()).toEqual([]);
        expect(
          await db
            .select({ id: schema.beatmaps.id })
            .from(schema.beatmaps)
            .where(eq(schema.beatmaps.osuId, NEW_BEATMAP_ID))
        ).toEqual([]);
        expect(await queuedFetches(db, userId)).toEqual([]);
      }
    );
  }
);
