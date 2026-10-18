import { describe, expect, it, mock } from 'bun:test';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu/enums';
import type { Mod, Multiplayer } from 'osu-api-v2-js';

mock.module('../../client', () => ({
  APIError: class APIError extends Error {},
}));

const { RoomFetchService } = await import('../room-fetch-service');

const createService = (existingScore?: {
  id: number;
  verificationStatus: number;
}) => {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const tx = {
    query: {
      players: { findFirst: async () => ({ id: 7 }) },
      gameScores: { findFirst: async () => existingScore },
    },
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        inserted.push(values);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updated.push(values);
        },
      }),
    }),
  };

  const service = new RoomFetchService({
    db: {} as never,
    api: {} as never,
    rateLimiter: {} as never,
    logger: { warn: () => {}, error: () => {}, info: () => {} } as never,
    publishBeatmapFetches: async () => {},
    dataCompletion: {} as never,
  });

  const processRoomScores = (score: ReturnType<typeof createScore>) =>
    (
      service as unknown as {
        processRoomScores: (...args: unknown[]) => Promise<void>;
      }
    ).processRoomScores(
      tx,
      [score],
      { details: { teams: {} } },
      1,
      Ruleset.Osu,
      new Map([[100, {}]]),
      VerificationStatus.None,
      VerificationStatus.None
    );

  return { inserted, updated, processRoomScores };
};

type ModInput = string | Mod;

const toApiMods = (mods: ModInput[]): Mod[] =>
  mods.map((mod) => (typeof mod === 'string' ? { acronym: mod } : mod));

/**
 * The score fields the room fetch reads. `satisfies` checks their names and
 * types against the osu! API client, so a renamed field fails to compile.
 */
const createScore = (mods: ModInput[]) =>
  ({
    user_id: 100,
    total_score: 100_001,
    legacy_total_score: 40_000,
    mods: toApiMods(mods),
    statistics: {},
    accuracy: 0.98,
    pp: null,
    max_combo: 500,
    passed: true,
    rank: 'S',
  }) satisfies Partial<Multiplayer.Room.PlaylistItem.Score>;

describe('processRoomScores', () => {
  it('stores easy scores with the multiplier', async () => {
    const { inserted, processRoomScores } = createService();

    await processRoomScores(createScore(['EZ', 'HD']));

    expect(inserted[0]?.rawScore).toBe(100_001);
    expect(inserted[0]?.adjustedScore).toBe(175_002);
    expect(inserted[0]?.mods).toBe((Mods.Easy | Mods.Hidden) as Mods);
    expect(inserted[0]?.legacyTotalScore).toBe(40_000);
  });

  it('stores non-easy scores unchanged', async () => {
    const { inserted, processRoomScores } = createService();

    await processRoomScores(createScore(['HD']));

    expect(inserted[0]?.rawScore).toBe(100_001);
    expect(inserted[0]?.adjustedScore).toBeNull();
    expect(inserted[0]?.legacyTotalScore).toBe(40_000);
  });

  it('stores every lazer mod with its settings', async () => {
    const { inserted, processRoomScores } = createService();

    await processRoomScores(
      createScore([
        { acronym: 'DT', settings: { speed_change: 1.2 } },
        'DA',
        'BR',
      ])
    );

    expect(inserted[0]?.mods).toBe(Mods.DoubleTime);
    expect(inserted[0]?.lazerMods).toEqual([
      { acronym: 'DT', settings: { speed_change: 1.2 } },
      { acronym: 'DA' },
      { acronym: 'BR' },
    ]);
  });

  it('applies the multiplier when updating an existing score', async () => {
    const { updated, processRoomScores } = createService({
      id: 55,
      verificationStatus: VerificationStatus.None,
    });

    await processRoomScores(createScore(['EZ']));

    expect(updated[0]?.rawScore).toBe(100_001);
    expect(updated[0]?.adjustedScore).toBe(175_002);
    expect(updated[0]?.legacyTotalScore).toBe(40_000);
  });

  it('replaces the lazer mods when updating an existing score', async () => {
    const { updated, processRoomScores } = createService({
      id: 55,
      verificationStatus: VerificationStatus.None,
    });

    await processRoomScores(createScore(['HD', 'BR']));

    expect(updated[0]?.lazerMods).toEqual([
      { acronym: 'HD' },
      { acronym: 'BR' },
    ]);
  });
});

/** A finished head-to-head room with one playlist item and no scores. */
const createRoomEvents = (requiredMods: ModInput[]) => ({
  room: {
    name: 'TT: (Red) vs (Blue)',
    type: 'head_to_head',
    starts_at: '2025-10-04T12:00:00Z',
    ends_at: '2025-10-04T13:00:00Z',
  },
  users: [],
  events: [
    {
      event_type: 'game_started',
      playlist_item_id: 3,
      created_at: '2025-10-04T12:05:00Z',
    },
    {
      event_type: 'game_completed',
      playlist_item_id: 3,
      created_at: '2025-10-04T12:09:00Z',
    },
    {
      event_type: 'room_disbanded',
      playlist_item_id: null,
      created_at: '2025-10-04T13:00:00Z',
    },
  ],
  playlist_items: [
    {
      id: 3,
      beatmap_id: 1234,
      ruleset_id: 0,
      required_mods: toApiMods(requiredMods),
      details: { room_type: 'head_to_head', teams: null },
      scores: [],
    } satisfies Partial<Multiplayer.Room.PlaylistItem.WithDetailsScores>,
  ],
});

const fetchRoom = async (
  requiredMods: ModInput[],
  beatmapStatus: DataFetchStatus = DataFetchStatus.Fetched
) => {
  const insertedGames: Record<string, unknown>[] = [];
  const queued: Array<{ executor: unknown; osuBeatmapId: number }> = [];

  const tx = {
    query: {
      // Already fetched by default, so the room fetch queues no beatmap job.
      beatmaps: {
        findFirst: async () => ({
          id: 9,
          dataFetchStatus: beatmapStatus,
        }),
      },
      games: { findFirst: async () => undefined },
    },
    // No other match holds the room's games.
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: () => ({ orderBy: () => ({ limit: async () => [] }) }),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedGames.push(values);
        return {
          returning: async () => [
            { id: 77, verificationStatus: VerificationStatus.None },
          ],
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () =>
          Object.assign(Promise.resolve(), {
            returning: async () => [{ id: 9 }],
          }),
      }),
    }),
  };

  const service = new RoomFetchService({
    db: {
      update: () => ({ set: () => ({ where: async () => {} }) }),
      transaction: async (run: (client: typeof tx) => Promise<void>) => run(tx),
    } as never,
    api: { getRoomEvents: async () => createRoomEvents(requiredMods) } as never,
    rateLimiter: { schedule: (task: () => unknown) => task() } as never,
    logger: { warn: () => {}, error: () => {}, info: () => {} } as never,
    publishBeatmapFetches: async (executor, osuBeatmapIds) => {
      for (const osuBeatmapId of osuBeatmapIds) {
        queued.push({ executor, osuBeatmapId });
      }
    },
    dataCompletion: { updateMatchFetchStatus: async () => {} } as never,
  });

  const fetched = await service.fetchAndPersistRoom(42, {
    id: 1,
    tournamentId: 2,
    dataFetchStatus: DataFetchStatus.NotFetched,
    verificationStatus: VerificationStatus.None,
    isLazer: true,
    tournament: { id: 2, ruleset: Ruleset.Osu },
  });

  return { fetched, insertedGames, queued, tx };
};

describe('fetchAndPersistRoom', () => {
  it("stores the game's required lazer mods with their settings", async () => {
    const { fetched, insertedGames } = await fetchRoom([
      { acronym: 'DT', settings: { speed_change: 1.2 } },
      'BR',
    ]);

    expect(fetched).toBe(true);
    expect(insertedGames[0]?.mods).toBe(Mods.DoubleTime);
    expect(insertedGames[0]?.lazerMods).toEqual([
      { acronym: 'DT', settings: { speed_change: 1.2 } },
      { acronym: 'BR' },
    ]);
  });

  it("queues the fetch of a game's unfetched beatmap in the transaction that stores the game", async () => {
    const { fetched, queued, tx } = await fetchRoom(
      ['BR'],
      DataFetchStatus.NotFetched
    );

    expect(fetched).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.osuBeatmapId).toBe(1234);
    expect(queued[0]!.executor).toBe(tx);
  });
});
