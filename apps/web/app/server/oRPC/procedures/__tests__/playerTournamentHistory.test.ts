import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import type {
  PlayerTournamentHistoryItem,
  PlayerTournamentListItem,
} from '@/lib/orpc/schema/tournament';

import {
  listPlayerStatsTournaments,
  listPlayerTournamentHistory,
  listPlayerTournamentsWithoutStats,
  mergePlayerTournamentHistory,
} from '../playerProcedures';

/** A tournament the player has no stats for. */
function historyRow(
  id: number,
  startTime: string | null,
  endTime: string | null
): PlayerTournamentHistoryItem {
  return {
    id,
    created: '2024-01-01 00:00:00+00',
    name: `Tournament ${id}`,
    abbreviation: `T${id}`,
    forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
    rankRangeLowerBound: 1,
    ruleset: Ruleset.Osu,
    lobbySize: 4,
    startTime,
    endTime,
    verificationStatus: VerificationStatus.Rejected,
    rejectionReason: 0,
    isLazer: false,
    submittedByUsername: null,
    verifiedByUsername: null,
    matchesWon: null,
    matchesLost: null,
  };
}

/** A tournament the player has stats for, with a record. */
function statsRow(
  id: number,
  startTime: string,
  endTime: string,
  won: number,
  lost: number
): PlayerTournamentListItem {
  return {
    ...historyRow(id, startTime, endTime),
    verificationStatus: VerificationStatus.Verified,
    matchesWon: won,
    matchesLost: lost,
  };
}

describe('mergePlayerTournamentHistory', () => {
  it('interleaves both lists newest first by end date, or start date without one', () => {
    const merged = mergePlayerTournamentHistory(
      [
        statsRow(1, '2024-05-01 00:00:00+00', '2024-05-20 00:00:00+00', 3, 1),
        statsRow(2, '2024-01-01 00:00:00+00', '2024-01-20 00:00:00+00', 0, 2),
      ],
      [
        historyRow(3, '2024-03-01 00:00:00+00', '2024-03-20 00:00:00+00'),
        historyRow(4, '2024-06-01 00:00:00+00', null),
      ]
    );

    expect(merged.map((row) => row.id)).toEqual([4, 1, 3, 2]);
  });

  it('puts undated tournaments last and breaks ties by the newest ID', () => {
    const merged = mergePlayerTournamentHistory(
      [],
      [
        historyRow(5, null, null),
        historyRow(6, '2024-01-01 00:00:00+00', '2024-02-01 00:00:00+00'),
        historyRow(7, '2023-12-01 00:00:00+00', '2024-02-01 00:00:00+00'),
        historyRow(8, null, null),
      ]
    );

    expect(merged.map((row) => row.id)).toEqual([7, 6, 8, 5]);
  });

  it('keeps the record of rows with stats and null on rows without', () => {
    const merged = mergePlayerTournamentHistory(
      [statsRow(1, '2024-05-01 00:00:00+00', '2024-05-20 00:00:00+00', 3, 1)],
      [historyRow(2, '2024-06-01 00:00:00+00', '2024-06-20 00:00:00+00')]
    );

    expect(
      merged.map((row) => [row.id, row.matchesWon, row.matchesLost])
    ).toEqual([
      [2, null, null],
      [1, 3, 1],
    ]);
  });
});

// Seeds and deletes rows; point it at a disposable database
const url = process.env.SEARCH_TEST_DATABASE_URL;

const NAME_PREFIX = 'Zz539 ';
const PLAYER_OSU_IDS = { main: 999_539_001, other: 999_539_002 } as const;
const BEATMAP_OSU_IDS = { b1: 999_539_101, b2: 999_539_102 } as const;
const MATCH_OSU_ID_BASE = 999_539_200;
const GAME_OSU_ID_BASE = 999_539_300;

type SeedPlayer = keyof typeof PLAYER_OSU_IDS;
type SeedBeatmap = keyof typeof BEATMAP_OSU_IDS;

interface TournamentSeed {
  label: string;
  status: VerificationStatus;
  ruleset?: Ruleset;
  pool: SeedBeatmap[];
  /** The month of 2024 it ran in, which sets its dates. */
  month: number;
  plays: {
    player: SeedPlayer;
    beatmap: SeedBeatmap | null;
    rawScore: number;
    scoreOverride?: number;
  }[];
  stats?: { player: SeedPlayer; won: number; lost: number }[];
}

const seeds: TournamentSeed[] = [
  {
    label: 'rejected',
    status: VerificationStatus.Rejected,
    pool: ['b1'],
    month: 1,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 2_500 }],
  },
  {
    label: 'boundary',
    status: VerificationStatus.PreVerified,
    pool: ['b1'],
    month: 2,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 2_000 }],
  },
  {
    label: 'override',
    status: VerificationStatus.PreRejected,
    pool: ['b1'],
    month: 3,
    plays: [
      { player: 'main', beatmap: 'b1', rawScore: 1_500, scoreOverride: 2_500 },
    ],
  },
  {
    label: 'below on the pool',
    status: VerificationStatus.Rejected,
    pool: ['b1'],
    month: 4,
    plays: [
      { player: 'main', beatmap: 'b1', rawScore: 1_500 },
      { player: 'main', beatmap: 'b2', rawScore: 900_000 },
    ],
  },
  {
    label: 'beatmap pooled elsewhere',
    status: VerificationStatus.PreVerified,
    pool: ['b2'],
    month: 5,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 5_000 }],
  },
  {
    label: 'no beatmap',
    status: VerificationStatus.PreVerified,
    pool: ['b1'],
    month: 6,
    plays: [{ player: 'main', beatmap: null, rawScore: 5_000 }],
  },
  {
    label: 'awaiting stats',
    status: VerificationStatus.Verified,
    pool: ['b1'],
    month: 7,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 3_000 }],
  },
  {
    label: 'stats for others',
    status: VerificationStatus.Verified,
    pool: ['b1'],
    month: 8,
    plays: [
      { player: 'main', beatmap: 'b1', rawScore: 3_000 },
      { player: 'other', beatmap: 'b1', rawScore: 3_000 },
    ],
    stats: [{ player: 'other', won: 1, lost: 0 }],
  },
  {
    label: 'stale stats',
    status: VerificationStatus.Rejected,
    pool: ['b1'],
    month: 9,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 3_000 }],
    stats: [{ player: 'main', won: 2, lost: 2 }],
  },
  {
    label: 'with stats',
    status: VerificationStatus.Verified,
    pool: ['b1'],
    month: 10,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 3_000 }],
    stats: [{ player: 'main', won: 3, lost: 1 }],
  },
  {
    label: 'taiko',
    status: VerificationStatus.Rejected,
    ruleset: Ruleset.Taiko,
    pool: ['b1'],
    month: 11,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 2_500 }],
  },
  {
    label: 'no pool',
    status: VerificationStatus.PreVerified,
    pool: [],
    month: 12,
    plays: [{ player: 'main', beatmap: 'b1', rawScore: 900_000 }],
  },
];

const monthDate = (month: number, day: number) =>
  `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`;

describe.skipIf(!url)('player tournament history', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema });
  const labels = new Map<number, string>();
  const playerIds = {} as Record<SeedPlayer, number>;

  const label = (rows: { id: number }[]) =>
    rows.map((row) => labels.get(row.id));

  const remove = async () => {
    // Cascades to matches, games, scores, stats and pools
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, Object.values(PLAYER_OSU_IDS)));
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, Object.values(BEATMAP_OSU_IDS)));
  };

  beforeAll(async () => {
    await remove();

    const players = await db
      .insert(schema.players)
      .values(
        Object.values(PLAYER_OSU_IDS).map((osuId) => ({
          osuId,
          username: `history${osuId}`,
        }))
      )
      .returning({ id: schema.players.id, osuId: schema.players.osuId });

    for (const [key, osuId] of Object.entries(PLAYER_OSU_IDS)) {
      playerIds[key as SeedPlayer] = players.find(
        (row) => row.osuId === osuId
      )!.id;
    }

    const beatmaps = await db
      .insert(schema.beatmaps)
      .values(
        Object.values(BEATMAP_OSU_IDS).map((osuId) => ({
          osuId,
          ruleset: Ruleset.Osu,
          rankedStatus: 1,
          diffName: `history${osuId}`,
          totalLength: 120,
          drainLength: 120,
          bpm: 180,
          countCircle: 100,
          countSlider: 100,
          countSpinner: 0,
          cs: 4,
          hp: 5,
          od: 8,
          ar: 9,
          sr: 5,
        }))
      )
      .returning({ id: schema.beatmaps.id, osuId: schema.beatmaps.osuId });

    const beatmapIds = {} as Record<SeedBeatmap, number>;
    for (const [key, osuId] of Object.entries(BEATMAP_OSU_IDS)) {
      beatmapIds[key as SeedBeatmap] = beatmaps.find(
        (row) => row.osuId === osuId
      )!.id;
    }

    for (const [index, seed] of seeds.entries()) {
      // Children share the tournament's status, as a rejection's cascade
      // leaves them, so the inheritance triggers accept every row.
      const status = seed.status;

      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: `${NAME_PREFIX}${seed.label}`,
          abbreviation: 'Z539',
          forumUrl: `https://osu.ppy.sh/community/forums/topics/539${index}`,
          rankRangeLowerBound: 1,
          ruleset: seed.ruleset ?? Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: status,
          startTime: monthDate(seed.month, 1),
          endTime: monthDate(seed.month, 20),
        })
        .returning({ id: schema.tournaments.id });
      labels.set(tournament!.id, seed.label);

      if (seed.pool.length > 0) {
        await db.insert(schema.joinPooledBeatmaps).values(
          seed.pool.map((beatmap) => ({
            pooledBeatmapsId: beatmapIds[beatmap],
            tournamentsPooledInId: tournament!.id,
          }))
        );
      }

      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: MATCH_OSU_ID_BASE + index,
          tournamentId: tournament!.id,
          // The date filters read when the player played, within the
          // tournament's dates.
          startTime: monthDate(seed.month, 10),
          verificationStatus: status,
        })
        .returning({ id: schema.matches.id });

      for (const [playIndex, play] of seed.plays.entries()) {
        const [game] = await db
          .insert(schema.games)
          .values({
            osuId: GAME_OSU_ID_BASE + index * 10 + playIndex,
            ruleset: seed.ruleset ?? Ruleset.Osu,
            scoringType: 3,
            teamType: 0,
            mods: 0,
            matchId: match!.id,
            beatmapId: play.beatmap ? beatmapIds[play.beatmap] : null,
            verificationStatus: status,
          })
          .returning({ id: schema.games.id });

        // score_override goes in the INSERT: an UPDATE without an audit
        // user reverts it.
        await db.insert(schema.gameScores).values({
          rawScore: play.rawScore,
          scoreOverride: play.scoreOverride,
          placement: 1,
          accuracy: 0.95,
          maxCombo: 100,
          pass: true,
          isPerfectCombo: false,
          legacyPerfect: false,
          grade: 1,
          mods: 0,
          legacyTotalScore: 0,
          team: 0,
          ruleset: seed.ruleset ?? Ruleset.Osu,
          verificationStatus: status,
          rejectionReason: 0,
          gameId: game!.id,
          playerId: playerIds[play.player],
        });
      }

      for (const stats of seed.stats ?? []) {
        await db.insert(schema.playerTournamentStats).values({
          averageRatingDelta: 0,
          averageMatchCost: 1,
          averageScore: 3_000,
          averagePlacement: 1,
          averageAccuracy: 0.95,
          matchesPlayed: stats.won + stats.lost,
          matchesWon: stats.won,
          matchesLost: stats.lost,
          gamesPlayed: 1,
          gamesWon: 1,
          gamesLost: 0,
          teammateIds: [],
          playerId: playerIds[stats.player],
          tournamentId: tournament!.id,
        });
      }
    }
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  it('lists the tournaments the player scored at least 2,000 in on a pooled beatmap', async () => {
    const rows = await listPlayerTournamentsWithoutStats(
      db,
      playerIds.main,
      {}
    );

    expect(label(rows).sort()).toEqual(
      ['awaiting stats', 'boundary', 'override', 'rejected', 'taiko'].sort()
    );
    expect(
      rows.every((row) => row.matchesWon === null && row.matchesLost === null)
    ).toBe(true);
  });

  it('applies the ruleset and date filters', async () => {
    const osu = await listPlayerTournamentsWithoutStats(db, playerIds.main, {
      ruleset: Ruleset.Osu,
    });
    expect(label(osu)).not.toContain('taiko');
    expect(osu).toHaveLength(4);

    const dated = await listPlayerTournamentsWithoutStats(db, playerIds.main, {
      ruleset: Ruleset.Osu,
      dateMin: '2024-02-01T00:00:00.000Z',
      dateMax: '2024-07-31T00:00:00.000Z',
    });
    expect(label(dated).sort()).toEqual(
      ['awaiting stats', 'boundary', 'override'].sort()
    );
  });

  it('leaves the stats list as it was', async () => {
    const rows = await listPlayerStatsTournaments(db, playerIds.main, {});

    expect(
      rows.map((row) => [labels.get(row.id), row.matchesWon, row.matchesLost])
    ).toEqual([
      ['with stats', 3, 1],
      ['stale stats', 2, 2],
    ]);
  });

  it('merges both into one history, newest first', async () => {
    const rows = await listPlayerTournamentHistory(db, playerIds.main, {});

    expect(
      rows.map((row) => [labels.get(row.id), row.matchesWon, row.matchesLost])
    ).toEqual([
      ['taiko', null, null],
      ['with stats', 3, 1],
      ['stale stats', 2, 2],
      ['awaiting stats', null, null],
      ['override', null, null],
      ['boundary', null, null],
      ['rejected', null, null],
    ]);
  });
});
