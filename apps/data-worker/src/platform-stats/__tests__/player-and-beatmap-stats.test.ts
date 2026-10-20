import { afterAll, describe, expect, it } from 'bun:test';
import { sql, TransactionRollbackError } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset, Team, VerificationStatus } from '@otr/core/osu';
import {
  type ActivePlayers,
  PLATFORM_STATS,
  PlatformStatKey,
  type PlatformStatsRuleset,
} from '@otr/core/platform-stats';

import type { DatabaseClient } from '../../db';
import { createJobsTestDb } from '../../jobs/__tests__/test-db';

// CI's checks job sets this to its migrated test database.
const url = process.env.SEARCH_TEST_DATABASE_URL;

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

const { Verified, PreVerified, Rejected } = VerificationStatus;

/**
 * The newest verified tournament ends here in the tests of the last 12
 * months, so those months start on Aug 1, 2025.
 */
const NEWEST_END = '2026-08-01T00:00:00Z';
const IN_WINDOW = '2026-03-01T12:00:00Z';

let nextOsuId = 990_400_000;
const osuId = () => nextOsuId++;

describe.skipIf(!url)('player and beatmap platform stats', () => {
  const { pool, db } = createJobsTestDb(url!);

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Runs `test` with no tournaments, players or beatmaps but its own, inside
   * a transaction that is rolled back.
   */
  const onEmptyTables = async (test: (tx: Transaction) => Promise<void>) => {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`delete from ${schema.platformStats}`);
        await tx.execute(sql`delete from ${schema.tournaments}`);
        await tx.execute(sql`delete from ${schema.players}`);
        await tx.execute(sql`delete from ${schema.beatmaps}`);
        await tx.execute(sql`delete from ${schema.beatmapsets}`);
        await test(tx);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  };

  /** One stored statistic's payload for every rated ruleset. */
  const compute = async <T>(
    tx: Transaction,
    key: PlatformStatKey
  ): Promise<Record<PlatformStatsRuleset, T>> => {
    const definition = PLATFORM_STATS.find((item) => item.key === key);
    if (definition?.scope !== 'ruleset') {
      throw new Error(`${key} is not a per-ruleset statistic`);
    }
    return (await definition.compute(tx)) as Record<PlatformStatsRuleset, T>;
  };

  const fixtures = (tx: Transaction) => {
    const player = async (username?: string) => {
      const id = osuId();
      const [row] = await tx
        .insert(schema.players)
        .values({ osuId: id, username: username ?? `scene-${id}` })
        .returning({ id: schema.players.id });
      return row!.id;
    };

    const tournament = async ({
      status = Verified,
      ruleset = Ruleset.Osu,
      start = '2025-01-01T00:00:00Z',
      end = NEWEST_END,
      rankRangeLowerBound = 1,
    }: {
      status?: VerificationStatus;
      ruleset?: Ruleset;
      start?: string;
      end?: string;
      rankRangeLowerBound?: number;
    } = {}) => {
      const id = osuId();
      const [row] = await tx
        .insert(schema.tournaments)
        .values({
          name: `Scene ${id}`,
          abbreviation: `SC${id}`,
          forumUrl: `https://osu.ppy.sh/community/forums/topics/${id}`,
          rankRangeLowerBound,
          ruleset,
          lobbySize: 1,
          verificationStatus: status,
          startTime: start,
          endTime: end,
        })
        .returning({ id: schema.tournaments.id });
      return row!.id;
    };

    /** A match red won 1–0, with each side's players on its roster. */
    const match = async (
      tournamentId: number,
      {
        status = Verified,
        start = IN_WINDOW as string | null,
        red = [] as number[],
        blue = [] as number[],
      } = {}
    ) => {
      const [row] = await tx
        .insert(schema.matches)
        .values({
          osuId: osuId(),
          name: 'SC: (red) vs (blue)',
          tournamentId,
          verificationStatus: status,
          startTime: start,
        })
        .returning({ id: schema.matches.id });

      for (const [team, roster, score] of [
        [Team.Red, red, 1],
        [Team.Blue, blue, 0],
      ] as const) {
        if (roster.length === 0) continue;
        await tx.insert(schema.matchRosters).values({
          matchId: row!.id,
          team,
          score,
          roster: [...roster],
        });
      }
      return row!.id;
    };

    const beatmap = async ({
      ruleset = Ruleset.Osu,
      sr = 6,
      set = { artist: 'Artist', title: 'Title' } as {
        artist: string;
        title: string;
      } | null,
      artistOverride = null as string | null,
      titleOverride = null as string | null,
      diffName = 'Insane',
      creators = [] as number[],
    } = {}) => {
      let beatmapsetId: number | null = null;
      if (set) {
        const [row] = await tx
          .insert(schema.beatmapsets)
          .values({ osuId: osuId(), rankedStatus: 1, ...set })
          .returning({ id: schema.beatmapsets.id });
        beatmapsetId = row!.id;
      }

      const beatmapOsuId = osuId();
      const [row] = await tx
        .insert(schema.beatmaps)
        .values({
          osuId: beatmapOsuId,
          ruleset,
          rankedStatus: 1,
          diffName,
          totalLength: 120,
          drainLength: 110,
          bpm: 180,
          countCircle: 100,
          countSlider: 100,
          countSpinner: 1,
          cs: 4,
          hp: 5,
          od: 8,
          ar: 9,
          sr,
          beatmapsetId,
          artistOverride,
          titleOverride,
        })
        .returning({ id: schema.beatmaps.id });

      for (const creatorsId of creators) {
        await tx.insert(schema.joinBeatmapCreators).values({
          createdBeatmapsId: row!.id,
          creatorsId,
        });
      }
      return { id: row!.id, osuId: beatmapOsuId };
    };

    /**
     * A game of `matchId` on `beatmapId`, with one score per entry of
     * `scores`, each by a new player.
     */
    const game = async (
      matchId: number,
      {
        beatmapId,
        mods = Mods.None as number,
        status = Verified,
        scores = [] as { mods?: number; status?: VerificationStatus }[],
      }: {
        beatmapId: number | null;
        mods?: number;
        status?: VerificationStatus;
        scores?: { mods?: number; status?: VerificationStatus }[];
      }
    ) => {
      const [row] = await tx
        .insert(schema.games)
        .values({
          osuId: osuId(),
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 2,
          mods,
          matchId,
          verificationStatus: status,
          startTime: IN_WINDOW,
          endTime: IN_WINDOW,
          beatmapId,
        })
        .returning({ id: schema.games.id });

      for (const [index, score] of scores.entries()) {
        await tx.insert(schema.gameScores).values({
          rawScore: 500_000,
          placement: index + 1,
          accuracy: 0.95,
          maxCombo: 100,
          pass: true,
          isPerfectCombo: false,
          legacyPerfect: false,
          grade: 2,
          mods: score.mods ?? Mods.None,
          team: Team.Red,
          ruleset: Ruleset.Osu,
          verificationStatus: score.status ?? Verified,
          rejectionReason: 0,
          legacyTotalScore: 500_000,
          gameId: row!.id,
          playerId: await player(),
        });
      }
      return row!.id;
    };

    return { player, tournament, match, beatmap, game };
  };

  describe('active players', () => {
    it('counts each year’s players, the new ones, and the new ones who came back', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const [a, b, c, d] = [
          await f.player(),
          await f.player(),
          await f.player(),
          await f.player(),
        ];
        const osu = await f.tournament();
        const other = await f.tournament();
        // 2023: a twice and b, all new; a comes back in 2024.
        await f.match(osu, {
          start: '2023-05-01T12:00:00Z',
          red: [a],
          blue: [b],
        });
        await f.match(other, { start: '2023-06-01T12:00:00Z', red: [a] });
        // 2024: a back, c new and back in 2025. On a clock five hours
        // behind UTC, this match starts on Dec 31, 2023.
        await f.match(osu, {
          start: '2024-01-01T02:00:00Z',
          red: [a],
          blue: [c],
        });
        // 2025: c back, d new.
        await f.match(osu, { start: '2025-03-01T12:00:00Z', red: [c, d] });

        await tx.execute(sql`set local time zone 'America/Lima'`);
        const stats = await compute<ActivePlayers>(
          tx,
          PlatformStatKey.ActivePlayers
        );

        expect(stats[Ruleset.Osu].years).toEqual([
          {
            year: 2023,
            tournaments: 2,
            players: 2,
            newPlayers: 2,
            newPlayersReturned: 1,
          },
          {
            year: 2024,
            tournaments: 1,
            players: 2,
            newPlayers: 1,
            newPlayersReturned: 1,
          },
          {
            year: 2025,
            tournaments: 1,
            players: 2,
            newPlayers: 1,
            newPlayersReturned: 0,
          },
        ]);
      });
    });

    it('counts only verified matches of verified tournaments, in their own ruleset', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const [a, b, c] = [
          await f.player(),
          await f.player(),
          await f.player(),
        ];
        const osu = await f.tournament();
        // a's 2023 match was rejected, so a is new in 2024.
        await f.match(osu, {
          status: Rejected,
          start: '2023-05-01T12:00:00Z',
          red: [a],
        });
        await f.match(osu, { start: '2024-05-01T12:00:00Z', red: [a] });
        // A verified match of a pre-verified tournament, and one with no start.
        await f.match(await f.tournament({ status: PreVerified }), {
          start: '2024-05-01T12:00:00Z',
          red: [b],
        });
        await f.match(osu, { start: null, red: [b] });
        // c plays taiko only.
        const taiko = await f.tournament({ ruleset: Ruleset.Taiko });
        await f.match(taiko, { start: '2024-05-01T12:00:00Z', red: [c] });

        const stats = await compute<ActivePlayers>(
          tx,
          PlatformStatKey.ActivePlayers
        );

        expect(stats[Ruleset.Osu].years).toEqual([
          {
            year: 2024,
            tournaments: 1,
            players: 1,
            newPlayers: 1,
            newPlayersReturned: 0,
          },
        ]);
        expect(stats[Ruleset.Taiko].years).toEqual([
          {
            year: 2024,
            tournaments: 1,
            players: 1,
            newPlayers: 1,
            newPlayersReturned: 0,
          },
        ]);
        expect(stats[Ruleset.Catch].years).toEqual([]);
      });
    });
  });
});
