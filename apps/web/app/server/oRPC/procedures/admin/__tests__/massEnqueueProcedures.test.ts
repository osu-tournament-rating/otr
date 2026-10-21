import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { asc, inArray, like } from 'drizzle-orm';

import { massEnqueueHandler } from '../massEnqueueProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { MessagePriority } from '@otr/core';
import { Ruleset } from '@otr/core/osu';
import { createPlaceholderBeatmap } from '../../tournaments/beatmapPlaceholders';

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

const NAME_PREFIX = 'mass-enqueue-jobs-';
const USER_OSU_ID = 991_201_800;
const FETCHED_BEATMAP_ID = 991_201_801;
const NOT_FOUND_BEATMAP_ID = 991_201_802;
const UNKNOWN_BEATMAP_ID = 991_201_803;
const MATCH_ID = 991_201_811;
const NEVER_FETCHED_PLAYER_ID = 991_201_821;
const NOT_FOUND_PLAYER_ID = 991_201_822;
const UNKNOWN_PLAYER_ID = 991_201_823;
const BEATMAP_IDS = [FETCHED_BEATMAP_ID, NOT_FOUND_BEATMAP_ID];
const PLAYER_IDS = [NEVER_FETCHED_PLAYER_ID, NOT_FOUND_PLAYER_ID];

describe.skipIf(!testDatabaseUrl)('massEnqueueHandler', () => {
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
    await removePlayers(db, PLAYER_IDS);
  };

  beforeEach(async () => {
    await removeSeed();
    userId ||= await seedAdminUser(db, USER_OSU_ID);

    await db.insert(schema.beatmaps).values([
      {
        ...createPlaceholderBeatmap(FETCHED_BEATMAP_ID, Ruleset.Osu),
        dataFetchStatus: DataFetchStatus.Fetched,
      },
      {
        ...createPlaceholderBeatmap(NOT_FOUND_BEATMAP_ID, Ruleset.Osu),
        dataFetchStatus: DataFetchStatus.NotFound,
      },
    ]);

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}matches`,
        abbreviation: 'MEJ',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;
    await db.insert(schema.matches).values({
      osuId: MATCH_ID,
      tournamentId,
      isLazer: true,
      dataFetchStatus: DataFetchStatus.Fetched,
    });

    // A beatmap creator saved but never fetched, and a restricted player.
    await db.insert(schema.players).values([
      { osuId: NEVER_FETCHED_PLAYER_ID },
      {
        osuId: NOT_FOUND_PLAYER_ID,
        dataFetchStatus: DataFetchStatus.NotFound,
      },
    ]);
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  const run = async (
    client: DatabaseClient = db,
    ids: { beatmapIds: number[]; matchIds: number[]; playerIds?: number[] } = {
      beatmapIds: [...BEATMAP_IDS, UNKNOWN_BEATMAP_ID],
      matchIds: [MATCH_ID],
    }
  ) => {
    const events = [];
    for await (const event of massEnqueueHandler({
      input: { playerIds: [], ...ids, priority: 'Low' },
      context: { db: client, session: adminSession(userId) },
    })) {
      events.push(event);
    }
    return events;
  };

  const statuses = async () => ({
    beatmaps: (
      await db
        .select({ dataFetchStatus: schema.beatmaps.dataFetchStatus })
        .from(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, BEATMAP_IDS))
        .orderBy(asc(schema.beatmaps.osuId))
    ).map((row) => row.dataFetchStatus),
    matches: (
      await db
        .select({ dataFetchStatus: schema.matches.dataFetchStatus })
        .from(schema.matches)
        .where(inArray(schema.matches.osuId, [MATCH_ID]))
    ).map((row) => row.dataFetchStatus),
  });

  it('resets and queues every beatmap and match osu! still serves', async () => {
    const events = await run();

    expect(events.at(-1)).toEqual({
      type: 'complete',
      beatmapsUpdated: 1,
      beatmapsSkipped: 2,
      matchesUpdated: 1,
      matchesSkipped: 0,
      playersUpdated: 0,
      playersSkipped: 0,
    });
    expect(await statuses()).toEqual({
      beatmaps: [DataFetchStatus.NotFetched, DataFetchStatus.NotFound],
      matches: [DataFetchStatus.NotFetched],
    });
    expect(await queuedFetches(db, userId)).toEqual([
      expect.objectContaining({
        payload: {
          type: 'beatmap',
          beatmapId: FETCHED_BEATMAP_ID,
          skipAutomationChecks: false,
        },
        priority: MessagePriority.Low,
        tournamentId: null,
      }),
      expect.objectContaining({
        payload: { type: 'match', osuMatchId: MATCH_ID, isLazer: true },
        priority: MessagePriority.Low,
        tournamentId,
      }),
    ]);
  });

  it('queues a fetch for every player in the database osu! still serves', async () => {
    const events = await run(db, {
      beatmapIds: [],
      matchIds: [],
      playerIds: [...PLAYER_IDS, UNKNOWN_PLAYER_ID],
    });

    expect(events.at(-1)).toEqual({
      type: 'complete',
      beatmapsUpdated: 0,
      beatmapsSkipped: 0,
      matchesUpdated: 0,
      matchesSkipped: 0,
      playersUpdated: 1,
      playersSkipped: 2,
    });
    expect(await queuedFetches(db, userId)).toEqual([
      expect.objectContaining({
        payload: { type: 'player', osuPlayerId: NEVER_FETCHED_PLAYER_ID },
        priority: MessagePriority.Low,
      }),
    ]);
  });

  // A failed beatmap batch stops the run before any match batch, so each
  // phase's transactions get a run of their own.
  const phaseFaults = transactionFaults.flatMap(([label, fault, message]) => [
    [
      'beatmap',
      label,
      { beatmapIds: [FETCHED_BEATMAP_ID], matchIds: [] },
      fault,
      message,
    ] as const,
    [
      'match',
      label,
      { beatmapIds: [], matchIds: [MATCH_ID] },
      fault,
      message,
    ] as const,
  ]);

  it.each(phaseFaults)(
    'resets no %s when %s',
    async (_phase, _label, ids, fault, message) => {
      await expect(
        run(fault(db), {
          beatmapIds: [...ids.beatmapIds],
          matchIds: [...ids.matchIds],
        })
      ).rejects.toThrow(message);

      expect(await statuses()).toEqual({
        beatmaps: [DataFetchStatus.Fetched, DataFetchStatus.NotFound],
        matches: [DataFetchStatus.Fetched],
      });
      expect(await queuedFetches(db, userId)).toEqual([]);
    }
  );
});
