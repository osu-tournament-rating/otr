import { afterAll, describe, expect, it } from 'bun:test';
import { sql, TransactionRollbackError } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset, Team, VerificationStatus } from '@otr/core/osu';
import {
  type ActivePlayers,
  type FreemodMods,
  type MostPlayedArtists,
  type MostPlayedBeatmaps,
  type MostPlayedMappers,
  PLATFORM_STATS,
  PlatformStatKey,
  type PlatformStatsRuleset,
  type PoolDifficulty,
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
const BEFORE_WINDOW = '2025-07-15T12:00:00Z';

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

  describe('most played beatmaps, mappers and artists', () => {
    /**
     * Beatmaps X and Y played in three tournaments each, Y in more games,
     * and Z in two; plus games that must not count.
     */
    const seedPlays = async (tx: Transaction) => {
      const f = fixtures(tx);
      const mir = await f.player('Mir');
      const guest = await f.player('Guest');
      const x = await f.beatmap({
        set: { artist: 'Camellia', title: 'X' },
        diffName: 'Extra',
        creators: [mir],
      });
      // A guest difficulty by two mappers; a blank override falls back to the set.
      const y = await f.beatmap({
        set: { artist: 'xi', title: 'Y' },
        artistOverride: '',
        titleOverride: 'Y (Cut Ver.)',
        creators: [mir, guest],
      });
      const z = await f.beatmap({
        set: null,
        artistOverride: 'Camellia',
        titleOverride: 'Z',
        creators: [guest],
      });

      const tournaments = [
        await f.tournament(),
        await f.tournament(),
        await f.tournament(),
      ];
      for (const [index, tournamentId] of tournaments.entries()) {
        const matchId = await f.match(tournamentId);
        await f.game(matchId, { beatmapId: x.id });
        await f.game(matchId, { beatmapId: y.id });
        if (index < 2) await f.game(matchId, { beatmapId: z.id });
      }
      // Y again in the first tournament: one more game, no more tournaments.
      await f.game(await f.match(tournaments[0]!), { beatmapId: y.id });

      // None of these count: a match before the window, a rejected game, a
      // rejected match, a pre-verified tournament, and a taiko tournament.
      const z3 = await f.tournament();
      await f.game(await f.match(z3, { start: BEFORE_WINDOW }), {
        beatmapId: z.id,
      });
      await f.game(await f.match(z3), { beatmapId: z.id, status: Rejected });
      await f.game(await f.match(z3, { status: Rejected }), {
        beatmapId: z.id,
      });
      await f.game(await f.match(await f.tournament({ status: PreVerified })), {
        beatmapId: z.id,
      });
      const taiko = await f.tournament({ ruleset: Ruleset.Taiko });
      await f.game(await f.match(taiko), { beatmapId: z.id });

      return { x, y, z, mir, guest };
    };

    it('ranks beatmaps by the verified tournaments that played them lately', async () => {
      await onEmptyTables(async (tx) => {
        const { x, y } = await seedPlays(tx);

        const stats = await compute<MostPlayedBeatmaps>(
          tx,
          PlatformStatKey.MostPlayedBeatmaps
        );

        // Z, in two tournaments, is under the minimum of three but counts
        // in the total.
        expect(stats[Ruleset.Osu]).toEqual({
          total: 3,
          beatmaps: [
            {
              osuId: y.osuId,
              diffName: 'Insane',
              artist: 'xi',
              title: 'Y (Cut Ver.)',
              starRating: 6,
              tournaments: 3,
              games: 4,
            },
            {
              osuId: x.osuId,
              diffName: 'Extra',
              artist: 'Camellia',
              title: 'X',
              starRating: 6,
              tournaments: 3,
              games: 3,
            },
          ],
        });
        expect(stats[Ruleset.Taiko]).toEqual({ total: 1, beatmaps: [] });
      });
    });

    it('credits every mapper of a played beatmap, and its artist', async () => {
      await onEmptyTables(async (tx) => {
        const { mir, guest } = await seedPlays(tx);

        const mappers = await compute<MostPlayedMappers>(
          tx,
          PlatformStatKey.MostPlayedMappers
        );
        const artists = await compute<MostPlayedArtists>(
          tx,
          PlatformStatKey.MostPlayedArtists
        );

        // Mir mapped X and Y; Guest mapped Y and Z. Both reach the same
        // three tournaments.
        expect(mappers[Ruleset.Osu]).toEqual({
          total: 2,
          mappers: [
            {
              playerId: mir,
              osuId: expect.any(Number),
              username: 'Mir',
              tournaments: 3,
              beatmaps: 2,
            },
            {
              playerId: guest,
              osuId: expect.any(Number),
              username: 'Guest',
              tournaments: 3,
              beatmaps: 2,
            },
          ].sort((first, second) => first.playerId - second.playerId),
        });
        // Camellia is X's set artist and Z's override; xi is Y's set artist
        // behind a blank override.
        expect(artists[Ruleset.Osu]).toEqual({
          total: 2,
          artists: [
            { artist: 'Camellia', tournaments: 3, beatmaps: 2 },
            { artist: 'xi', tournaments: 3, beatmaps: 1 },
          ],
        });
        // The taiko tournament's one beatmap is under the minimum.
        expect(artists[Ruleset.Taiko]).toEqual({ total: 1, artists: [] });
      });
    });

    it('ranks each ruleset on its own', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        // Eleven osu! beatmaps, each with its own mapper and artist, in the
        // same three tournaments: more than any list keeps.
        const osuMaps = [];
        for (let index = 0; index < 11; index++) {
          osuMaps.push(
            await f.beatmap({
              set: { artist: `Artist ${index}`, title: `Map ${index}` },
              creators: [await f.player()],
            })
          );
        }
        for (let index = 0; index < 3; index++) {
          const matchId = await f.match(await f.tournament());
          for (const map of osuMaps)
            await f.game(matchId, { beatmapId: map.id });
        }
        // One taiko beatmap, seeded last, in three taiko tournaments.
        const taikoMap = await f.beatmap({
          ruleset: Ruleset.Taiko,
          set: { artist: 'Taiko artist', title: 'Taiko map' },
          creators: [await f.player('Taiko mapper')],
        });
        for (let index = 0; index < 3; index++) {
          const taiko = await f.tournament({ ruleset: Ruleset.Taiko });
          await f.game(await f.match(taiko), { beatmapId: taikoMap.id });
        }

        const beatmaps = await compute<MostPlayedBeatmaps>(
          tx,
          PlatformStatKey.MostPlayedBeatmaps
        );
        const mappers = await compute<MostPlayedMappers>(
          tx,
          PlatformStatKey.MostPlayedMappers
        );
        const artists = await compute<MostPlayedArtists>(
          tx,
          PlatformStatKey.MostPlayedArtists
        );

        expect(beatmaps[Ruleset.Osu].beatmaps).toHaveLength(10);
        expect(
          beatmaps[Ruleset.Taiko].beatmaps.map((map) => map.osuId)
        ).toEqual([taikoMap.osuId]);
        expect(mappers[Ruleset.Osu].mappers).toHaveLength(5);
        expect(
          mappers[Ruleset.Taiko].mappers.map((item) => item.username)
        ).toEqual(['Taiko mapper']);
        expect(artists[Ruleset.Osu].artists).toHaveLength(5);
        expect(
          artists[Ruleset.Taiko].artists.map((item) => item.artist)
        ).toEqual(['Taiko artist']);
      });
    });
  });

  describe('pool difficulty', () => {
    it('takes nomod star ratings per year, open rank and rank-restricted apart', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const open = await f.tournament({ start: '2025-03-01T00:00:00Z' });
        const openMatch = await f.match(open);
        for (const sr of [4, 5, 6, 7, 8]) {
          const map = await f.beatmap({ sr });
          // With No Fail, as most lobbies force it.
          await f.game(openMatch, {
            beatmapId: map.id,
            mods: Mods.NoFail,
            scores: [{ mods: Mods.NoFail }],
          });
          // Played twice in one tournament, the map counts once.
          if (sr === 8) await f.game(openMatch, { beatmapId: map.id });
        }
        const restricted = await f.tournament({
          start: '2025-04-01T00:00:00Z',
          rankRangeLowerBound: 1000,
        });
        const restrictedMatch = await f.match(restricted);
        for (const sr of [3, 5]) {
          await f.game(restrictedMatch, {
            beatmapId: (await f.beatmap({ sr })).id,
          });
        }
        // A 2024 tournament with no nomod game.
        await f.tournament({ start: '2024-06-01T00:00:00Z' });

        const stats = await compute<PoolDifficulty>(
          tx,
          PlatformStatKey.PoolDifficulty
        );

        expect(stats[Ruleset.Osu].years).toEqual([
          { year: 2024, tournaments: 1, open: null, restricted: null },
          {
            year: 2025,
            tournaments: 2,
            // 4, 5, 6, 7, 8: the 90th percentile is 7 + 0.6 × (8 − 7).
            open: { maps: 5, tournaments: 1, median: 6, p90: 7.6 },
            // 3 and 5: the median is 4, the 90th percentile 3 + 0.9 × 2.
            restricted: { maps: 2, tournaments: 1, median: 4, p90: 4.8 },
          },
        ]);
      });
    });

    it('counts a game as nomod only when it and its verified scores have no mod', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament({ start: '2025-03-01T00:00:00Z' });
        const matchId = await f.match(osu);
        const map = async (sr: number) => (await f.beatmap({ sr })).id;

        // Counts: a rejected score's Hidden does not make it a mod game.
        await f.game(matchId, {
          beatmapId: await map(5),
          scores: [{}, { mods: Mods.Hidden, status: Rejected }],
        });
        // None of these count: a Hidden lobby, a score with Hard Rock (a
        // freemod pick), a rejected game, a map osu! gives no star rating,
        // and a taiko map converted from osu! in an osu! tournament.
        await f.game(matchId, { beatmapId: await map(7), mods: Mods.Hidden });
        await f.game(matchId, {
          beatmapId: await map(7),
          scores: [{}, { mods: Mods.HardRock }],
        });
        await f.game(matchId, { beatmapId: await map(7), status: Rejected });
        await f.game(matchId, { beatmapId: await map(0) });
        await f.game(matchId, {
          beatmapId: (await f.beatmap({ sr: 7, ruleset: Ruleset.Taiko })).id,
        });
        // A mania 4K tournament plays mania beatmaps, stored as mania (other).
        const mania = await f.tournament({
          ruleset: Ruleset.Mania4k,
          start: '2025-03-01T00:00:00Z',
        });
        await f.game(await f.match(mania), {
          beatmapId: (await f.beatmap({ sr: 4, ruleset: Ruleset.ManiaOther }))
            .id,
        });

        const stats = await compute<PoolDifficulty>(
          tx,
          PlatformStatKey.PoolDifficulty
        );

        expect(stats[Ruleset.Osu].years).toEqual([
          {
            year: 2025,
            tournaments: 1,
            open: { maps: 1, tournaments: 1, median: 5, p90: 5 },
            restricted: null,
          },
        ]);
        expect(stats[Ruleset.Mania4k].years[0]?.open).toEqual({
          maps: 1,
          tournaments: 1,
          median: 4,
          p90: 4,
        });
      });
    });
  });

  describe('mods on freemod maps', () => {
    it('counts the verified scores of games the site reads as freemod, per year', async () => {
      await onEmptyTables(async (tx) => {
        const f = fixtures(tx);
        const osu = await f.tournament({ start: '2025-03-01T00:00:00Z' });
        const matchId = await f.match(osu);
        const map = (await f.beatmap()).id;

        // Freemod: no lobby mods and a pick besides No Fail. The rejected
        // score is not counted.
        await f.game(matchId, {
          beatmapId: map,
          scores: [
            { mods: Mods.Hidden },
            { mods: Mods.NoFail },
            { mods: Mods.HardRock, status: Rejected },
          ],
        });
        // Freemod: the lobby carries every freemod flag.
        await f.game(matchId, {
          beatmapId: map,
          mods: Mods.FreeModAllowed,
          scores: [{ mods: Mods.Hidden }],
        });
        // Not freemod: only No Fail picked, lobby mods, a rejected game, and
        // a pick that only a rejected score made.
        await f.game(matchId, {
          beatmapId: map,
          scores: [{ mods: Mods.NoFail }, { mods: Mods.NoFail }],
        });
        await f.game(matchId, {
          beatmapId: map,
          mods: Mods.NoFail,
          scores: [{ mods: Mods.NoFail | Mods.Hidden }],
        });
        await f.game(matchId, {
          beatmapId: map,
          status: Rejected,
          scores: [{ mods: Mods.Hidden }],
        });
        await f.game(matchId, {
          beatmapId: map,
          scores: [{}, { mods: Mods.Hidden, status: Rejected }],
        });
        // A 2024 tournament without freemod games.
        await f.tournament({ start: '2024-06-01T00:00:00Z' });

        const stats = await compute<FreemodMods>(
          tx,
          PlatformStatKey.FreemodMods
        );

        expect(stats[Ruleset.Osu].years).toEqual([
          { year: 2024, tournaments: 1, games: 0, scores: 0, mods: [] },
          {
            year: 2025,
            tournaments: 1,
            games: 2,
            scores: 3,
            mods: [
              { mods: Mods.Hidden, scores: 2 },
              { mods: Mods.NoFail, scores: 1 },
            ],
          },
        ]);
      });
    });
  });
});
