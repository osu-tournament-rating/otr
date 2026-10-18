import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { asc, inArray, like } from 'drizzle-orm';

import { manageTournamentMatchesAdmin } from '../matchAdminProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

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

const NAME_PREFIX = 'tournament-match-admin-jobs-';
const USER_OSU_ID = 991_201_500;
const NEW_MATCH_ID = 991_201_501;
const NEW_LAZER_MATCH_ID = 991_201_502;
const KNOWN_MATCH_ID = 991_201_503;
const MATCH_IDS = [NEW_MATCH_ID, NEW_LAZER_MATCH_ID, KNOWN_MATCH_ID];

describe.skipIf(!testDatabaseUrl)('manageTournamentMatchesAdmin', () => {
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

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}matches`,
        abbreviation: 'TMA',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;

    await db
      .insert(schema.matches)
      .values({ osuId: KNOWN_MATCH_ID, tournamentId });
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  // The handler alone; middleware has its own tests.
  const addMatches = (client: DatabaseClient = db) =>
    manageTournamentMatchesAdmin['~orpc'].handler({
      context: { db: client, session: adminSession(userId) },
      input: {
        tournamentId,
        addMatchOsuIds: [
          { osuId: NEW_MATCH_ID, isLazer: false },
          { osuId: NEW_LAZER_MATCH_ID, isLazer: true },
          { osuId: KNOWN_MATCH_ID, isLazer: false },
        ],
        removeMatchIds: [],
      },
    } as never);

  const savedMatchIds = async () =>
    (
      await db
        .select({ osuId: schema.matches.osuId })
        .from(schema.matches)
        .where(inArray(schema.matches.osuId, MATCH_IDS))
        .orderBy(asc(schema.matches.osuId))
    ).map((row) => row.osuId);

  it('queues a fetch for each match it adds', async () => {
    const result = await addMatches();

    expect(result).toEqual(
      expect.objectContaining({ addedCount: 2, skippedCount: 1 })
    );
    expect(await savedMatchIds()).toEqual(MATCH_IDS);
    expect(await queuedFetches(db, userId)).toEqual([
      expect.objectContaining({
        payload: { type: 'match', osuMatchId: NEW_MATCH_ID, isLazer: false },
        tournamentId,
      }),
      expect.objectContaining({
        payload: {
          type: 'match',
          osuMatchId: NEW_LAZER_MATCH_ID,
          isLazer: true,
        },
        tournamentId,
      }),
    ]);
  });

  it.each(transactionFaults)(
    'adds no match when %s',
    async (_label, fault, message) => {
      await expect(addMatches(fault(db))).rejects.toThrow(message);

      expect(await savedMatchIds()).toEqual([KNOWN_MATCH_ID]);
      expect(await queuedFetches(db, userId)).toEqual([]);
    }
  );
});
