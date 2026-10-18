import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';
import { inArray, like } from 'drizzle-orm';

import {
  submitTournamentHandler,
  type SubmitTournamentHandlerArgs,
} from '../tournamentSubmissionProcedure';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Ruleset } from '@otr/core/osu';

import {
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
  tournamentIdByName,
  transactionFaults,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'tournament-submission-jobs-';
const USER_OSU_ID = 991_201_100;
const MATCH_IDS = [991_201_101, 991_201_102];
const NEW_BEATMAP_ID = 991_201_151;
const KNOWN_BEATMAP_ID = 991_201_152;
const TOPIC_ID = 991_201;

const createErrors = () => ({
  ACCOUNT_RESOLUTION_FAILED: () =>
    new ORPCError('FORBIDDEN', { message: 'no session' }),
  NAME_ABBREVIATION_CONFLICT: ({ message }: { message?: string } = {}) =>
    new ORPCError('CONFLICT', { message: message ?? 'conflict' }),
  MATCH_ASSIGNMENT_CONFLICT: ({ message }: { message?: string } = {}) =>
    new ORPCError('CONFLICT', { message: message ?? 'match conflict' }),
  TOURNAMENT_CREATION_FAILED: () =>
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'create failed' }),
  DUPLICATE_TOURNAMENT_DETAILS: () =>
    new ORPCError('CONFLICT', { message: 'duplicate' }),
  SUBMISSION_FAILED: () =>
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'submission failed' }),
});

describe.skipIf(!testDatabaseUrl)('submitTournamentHandler', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let userId = 0;

  const removeSeed = async () => {
    if (userId) {
      await deleteJobs(db, userId);
    }
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.beatmaps)
      .where(
        inArray(schema.beatmaps.osuId, [NEW_BEATMAP_ID, KNOWN_BEATMAP_ID])
      );
  };

  const submit = (
    name: string,
    overrides: Partial<SubmitTournamentHandlerArgs['input']> = {},
    client: DatabaseClient = db
  ) =>
    submitTournamentHandler({
      input: {
        name,
        abbreviation: 'TSJ',
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${TOPIC_ID}`,
        ruleset: Ruleset.Osu,
        rankRangeLowerBound: 1,
        lobbySize: 4,
        rejectionReason: 0,
        isLazer: false,
        ids: MATCH_IDS,
        beatmapIds: [NEW_BEATMAP_ID, KNOWN_BEATMAP_ID],
        ...overrides,
      },
      context: {
        db: client,
        session: { dbUser: { id: userId } },
        logging: { correlationId: 'submission-test' },
      } as SubmitTournamentHandlerArgs['context'],
      errors: createErrors(),
    });

  beforeAll(async () => {
    userId = await seedAdminUser(db, USER_OSU_ID);
  });

  afterEach(removeSeed);

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  it('queues new matches, placeholder beatmaps and the forum topic with the tournament', async () => {
    await db.insert(schema.beatmaps).values({
      osuId: KNOWN_BEATMAP_ID,
      ruleset: Ruleset.Osu,
      rankedStatus: 1,
      diffName: 'known',
      totalLength: 1,
      drainLength: 1,
      bpm: 1,
      countCircle: 1,
      countSlider: 1,
      countSpinner: 1,
      cs: 1,
      hp: 1,
      od: 1,
      ar: 1,
      sr: 1,
      dataFetchStatus: DataFetchStatus.Fetched,
    });

    const result = await submit(`${NAME_PREFIX}queues`);

    expect(result).toEqual({
      id: (await tournamentIdByName(db, `${NAME_PREFIX}queues`))!,
    });

    const shared = {
      correlationId: 'submission-test',
      tournamentId: result.id,
    };
    expect(await queuedFetches(db, userId)).toEqual([
      expect.objectContaining({
        ...shared,
        payload: { type: 'beatmap', beatmapId: NEW_BEATMAP_ID },
      }),
      expect.objectContaining({
        ...shared,
        payload: { type: 'forumTopic', topicId: TOPIC_ID },
      }),
      expect.objectContaining({
        ...shared,
        payload: { type: 'match', osuMatchId: MATCH_IDS[0], isLazer: false },
      }),
      expect.objectContaining({
        ...shared,
        payload: { type: 'match', osuMatchId: MATCH_IDS[1], isLazer: false },
      }),
    ]);
  });

  it.each([
    [
      'a topic',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC_ID}?n=1`,
      [TOPIC_ID],
    ],
    ['a wiki page', 'https://osu.ppy.sh/wiki/en/Tournaments/TSJ/2026', []],
  ])(
    'queues the forum topic fetch for %s',
    async (_label, forumUrl, expected) => {
      await submit(`${NAME_PREFIX}forum`, {
        forumUrl,
        ids: [MATCH_IDS[0]!],
        beatmapIds: [],
      });

      const topics = (await queuedFetches(db, userId))
        .map((job) => job.payload)
        .filter((payload) => payload.type === 'forumTopic')
        .map((payload) => payload.topicId);
      expect(topics).toEqual(expected);
    }
  );

  it.each(transactionFaults)(
    'keeps neither the tournament nor its fetches when %s',
    async (_label, fault) => {
      const name = `${NAME_PREFIX}rollback`;

      await expect(submit(name, {}, fault(db))).rejects.toThrow(
        'submission failed'
      );

      expect(await tournamentIdByName(db, name)).toBeNull();
      expect(
        await db
          .select({ id: schema.matches.id })
          .from(schema.matches)
          .where(inArray(schema.matches.osuId, MATCH_IDS))
      ).toEqual([]);
      expect(
        await db
          .select({ id: schema.beatmaps.id })
          .from(schema.beatmaps)
          .where(inArray(schema.beatmaps.osuId, [NEW_BEATMAP_ID]))
      ).toEqual([]);
      expect(await queuedFetches(db, userId)).toEqual([]);
    }
  );
});
