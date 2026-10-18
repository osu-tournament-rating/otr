import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  updateBeatmapAdminHandler,
  type UpdateBeatmapAdminArgs,
} from '../adminProcedures';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Ruleset } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';
import type { BeatmapAdminUpdateInput } from '@/lib/orpc/schema/beatmap';
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

interface PlayerRow {
  id: number;
  osuId: number;
}

interface TestDbOptions {
  players?: PlayerRow[];
  /** Rows a concurrent transaction commits between our select and our insert. */
  raced?: number[];
  unresolvable?: number[];
  creators?: number[];
}

class UpdateBeatmapTestDb {
  public readonly players: PlayerRow[];
  public creatorPlayerIds: number[];
  public readonly beatmapUpdates: Array<Record<string, unknown>> = [];
  public readonly audits: string[] = [];
  private readonly raced: Set<number>;
  private readonly unresolvable: Set<number>;
  private nextPlayerId = 900;

  constructor(options: TestDbOptions = {}) {
    this.players = [...(options.players ?? [])];
    this.raced = new Set(options.raced ?? []);
    this.unresolvable = new Set(options.unresolvable ?? []);
    this.creatorPlayerIds = [...(options.creators ?? [])];
  }

  query = {
    beatmaps: {
      findFirst: async () => ({
        id: 1,
        dataFetchStatus: DataFetchStatus.NotFound,
      }),
    },
  } as const;

  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(this.createTransaction());
  }

  private visiblePlayers() {
    return this.players.filter((row) => !this.raced.has(row.osuId));
  }

  private insertPlayers(values: Array<{ osuId: number }>) {
    const inserted: PlayerRow[] = [];

    for (const { osuId } of values) {
      if (this.raced.has(osuId)) {
        this.raced.delete(osuId);
        continue;
      }

      if (this.unresolvable.has(osuId)) {
        continue;
      }

      const row = { id: this.nextPlayerId++, osuId };
      this.players.push(row);
      inserted.push(row);
    }

    return inserted;
  }

  private createTransaction() {
    return {
      execute: async (query: unknown) => {
        const text = JSON.stringify(query);

        if (text.includes('beatmap_audits')) {
          this.audits.push(text);
        }
      },
      select: () => ({
        from: (table: unknown) => ({
          where: async () =>
            table === schema.players ? this.visiblePlayers() : [],
          innerJoin: () => ({
            where: async () =>
              this.creatorPlayerIds.map((id) => ({
                osuId: this.players.find((row) => row.id === id)?.osuId ?? 0,
              })),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Array<Record<string, number>>) => {
          if (table === schema.players) {
            const inserted = this.insertPlayers(
              values as Array<{ osuId: number }>
            );

            return {
              onConflictDoNothing: () => ({ returning: () => inserted }),
            };
          }

          if (table === schema.joinBeatmapCreators) {
            this.creatorPlayerIds = values.map((value) => value.creatorsId);
            return { onConflictDoNothing: () => undefined };
          }

          throw new Error('Unsupported insert target');
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            this.beatmapUpdates.push(values);
          },
        }),
      }),
      delete: () => ({
        where: async () => {
          this.creatorPlayerIds = [];
        },
      }),
    };
  }
}

const createInput = (
  overrides: Partial<BeatmapAdminUpdateInput> = {}
): BeatmapAdminUpdateInput => ({
  id: 1,
  diffName: 'Insane',
  ruleset: Ruleset.Osu,
  rankedStatus: 1,
  totalLength: 180,
  drainLength: 170,
  bpm: 180,
  countCircle: 100,
  countSlider: 50,
  countSpinner: 1,
  cs: 4,
  hp: 6,
  od: 8,
  ar: 9,
  sr: 5.5,
  maxCombo: 800,
  titleOverride: 'Title',
  artistOverride: 'Artist',
  setOwnerOsuIdOverride: null,
  creatorOsuIds: [],
  ...overrides,
});

const createContext = (
  db: UpdateBeatmapTestDb
): UpdateBeatmapAdminArgs['context'] => ({
  db: db as unknown as DatabaseClient,
  session: { dbUser: { id: 1, scopes: ['admin'] } },
});

describe('updateBeatmapAdminHandler', () => {
  it('links a creator another transaction inserted first', async () => {
    const db = new UpdateBeatmapTestDb({
      players: [{ id: 42, osuId: 555 }],
      raced: [555],
    });

    const result = await updateBeatmapAdminHandler({
      input: createInput({ creatorOsuIds: [555] }),
      context: createContext(db),
    });

    expect(result).toEqual({ success: true });
    expect(db.creatorPlayerIds).toEqual([42]);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toContain('[555]');
  });

  it('rejects a set owner that cannot be resolved', async () => {
    const db = new UpdateBeatmapTestDb({ unresolvable: [777] });

    await expect(
      updateBeatmapAdminHandler({
        input: createInput({ setOwnerOsuIdOverride: 777 }),
        context: createContext(db),
      })
    ).rejects.toThrow('No player could be resolved for osu! id 777');

    expect(db.beatmapUpdates).toHaveLength(0);
  });

  it('records no creator audit when only the order differs', async () => {
    const db = new UpdateBeatmapTestDb({
      players: [
        { id: 10, osuId: 100 },
        { id: 20, osuId: 200 },
      ],
      creators: [20, 10],
    });

    await updateBeatmapAdminHandler({
      input: createInput({ creatorOsuIds: [100, 200] }),
      context: createContext(db),
    });

    expect(db.creatorPlayerIds).toEqual([10, 20]);
    expect(db.audits).toHaveLength(0);
  });
});

describe.skipIf(!testDatabaseUrl)(
  'updateBeatmapAdminHandler player fetches',
  () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    const USER_OSU_ID = 991_201_700;
    const BEATMAP_OSU_ID = 991_201_701;
    const KNOWN_CREATOR_OSU_ID = 991_201_702;
    const NEW_CREATOR_OSU_ID = 991_201_703;
    const NEW_OWNER_OSU_ID = 991_201_704;
    const SEEDED_PLAYERS = [
      KNOWN_CREATOR_OSU_ID,
      NEW_CREATOR_OSU_ID,
      NEW_OWNER_OSU_ID,
    ];
    let userId = 0;
    let beatmapId = 0;

    const removeSeed = async () => {
      if (userId) {
        await deleteJobs(db, userId);
      }
      await db
        .delete(schema.beatmaps)
        .where(eq(schema.beatmaps.osuId, BEATMAP_OSU_ID));
      await removePlayers(db, SEEDED_PLAYERS);
    };

    beforeEach(async () => {
      await removeSeed();
      userId ||= await seedAdminUser(db, USER_OSU_ID);

      const [beatmap] = await db
        .insert(schema.beatmaps)
        .values({
          ...createPlaceholderBeatmap(BEATMAP_OSU_ID, Ruleset.Osu),
          dataFetchStatus: DataFetchStatus.NotFound,
        })
        .returning({ id: schema.beatmaps.id });
      beatmapId = beatmap!.id;

      await db.insert(schema.players).values({ osuId: KNOWN_CREATOR_OSU_ID });
    });

    afterAll(async () => {
      await removeSeed();
      await removePlayers(db, [USER_OSU_ID]);
      await pool.end();
    });

    const update = (client: DatabaseClient = db) =>
      updateBeatmapAdminHandler({
        input: createInput({
          id: beatmapId,
          setOwnerOsuIdOverride: NEW_OWNER_OSU_ID,
          creatorOsuIds: [KNOWN_CREATOR_OSU_ID, NEW_CREATOR_OSU_ID],
        }),
        context: { db: client, session: adminSession(userId) },
      });

    const savedPlayerOsuIds = async () =>
      (
        await db
          .select({ osuId: schema.players.osuId })
          .from(schema.players)
          .where(inArray(schema.players.osuId, SEEDED_PLAYERS))
      )
        .map((row) => row.osuId)
        .sort();

    it('queues a fetch for each player it creates', async () => {
      await update();

      expect(await savedPlayerOsuIds()).toEqual(SEEDED_PLAYERS);
      expect(await queuedFetches(db, userId)).toEqual([
        expect.objectContaining({
          payload: { type: 'player', osuPlayerId: NEW_CREATOR_OSU_ID },
        }),
        expect.objectContaining({
          payload: { type: 'player', osuPlayerId: NEW_OWNER_OSU_ID },
        }),
      ]);
    });

    it.each(transactionFaults)(
      'creates no player and keeps the beatmap when %s',
      async (_label, fault, message) => {
        await expect(update(fault(db))).rejects.toThrow(message);

        expect(await savedPlayerOsuIds()).toEqual([KNOWN_CREATOR_OSU_ID]);
        const [beatmap] = await db
          .select({ manualOverride: schema.beatmaps.manualOverride })
          .from(schema.beatmaps)
          .where(eq(schema.beatmaps.id, beatmapId));
        expect(beatmap).toEqual({ manualOverride: false });
        expect(await queuedFetches(db, userId)).toEqual([]);
      }
    );
  }
);
