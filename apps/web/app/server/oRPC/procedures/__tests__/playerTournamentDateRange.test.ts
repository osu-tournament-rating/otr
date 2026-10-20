import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  listPlayerStatsTournaments,
  listPlayerTournamentsWithoutStats,
} from '../playerProcedures';
import { createTestDb, testDatabaseUrl } from './test-utils';

const NAME_PREFIX = 'Zz1160 ';
const PLAYER_OSU_ID = 999_160_001;
const BEATMAP_OSU_ID = 999_160_101;
const MATCH_OSU_ID_BASE = 999_160_200;
const GAME_OSU_ID_BASE = 999_160_300;

/** The range a profile's time filter sends, June through August 2024. */
const RANGE = { dateMin: '2024-06-01', dateMax: '2024-08-31' } as const;

interface TournamentSeed {
  label: string;
  /** Verified tournaments get stats; the rest are listed from a score. */
  status: VerificationStatus;
  startTime: string;
  endTime: string | null;
  /** When the player's one match in it started. */
  playedAt: string;
}

const seeds: TournamentSeed[] = [
  {
    label: 'inside',
    status: VerificationStatus.Verified,
    startTime: '2024-06-10T00:00:00Z',
    endTime: '2024-06-30T00:00:00Z',
    playedAt: '2024-06-15T12:00:00Z',
  },
  {
    label: 'began before',
    status: VerificationStatus.Verified,
    startTime: '2024-05-01T00:00:00Z',
    endTime: '2024-07-01T00:00:00Z',
    playedAt: '2024-06-15T12:00:00Z',
  },
  {
    label: 'still running',
    status: VerificationStatus.Verified,
    startTime: '2024-07-01T00:00:00Z',
    endTime: null,
    playedAt: '2024-07-15T12:00:00Z',
  },
  {
    label: 'ends on the last day',
    status: VerificationStatus.Verified,
    startTime: '2024-08-01T00:00:00Z',
    endTime: '2024-08-31T18:00:00Z',
    playedAt: '2024-08-31T15:00:00Z',
  },
  {
    label: 'played before',
    status: VerificationStatus.Verified,
    startTime: '2024-05-01T00:00:00Z',
    endTime: '2024-07-01T00:00:00Z',
    playedAt: '2024-05-10T12:00:00Z',
  },
  {
    label: 'unverified began before',
    status: VerificationStatus.PreVerified,
    startTime: '2024-05-01T00:00:00Z',
    endTime: '2024-07-01T00:00:00Z',
    playedAt: '2024-06-15T12:00:00Z',
  },
  {
    label: 'unverified played before',
    status: VerificationStatus.PreVerified,
    startTime: '2024-05-01T00:00:00Z',
    endTime: '2024-07-01T00:00:00Z',
    playedAt: '2024-05-10T12:00:00Z',
  },
];

describe.skipIf(!testDatabaseUrl)('player tournaments in a date range', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const labels = new Map<number, string>();
  let playerId = 0;

  const label = (rows: { id: number }[]) =>
    rows.map((row) => labels.get(row.id)).sort();

  const remove = async () => {
    // Cascades to matches, games, scores, stats and pools
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.players)
      .where(eq(schema.players.osuId, PLAYER_OSU_ID));
    await db
      .delete(schema.beatmaps)
      .where(eq(schema.beatmaps.osuId, BEATMAP_OSU_ID));
  };

  beforeAll(async () => {
    await remove();

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: PLAYER_OSU_ID, username: 'range1160' })
      .returning({ id: schema.players.id });
    playerId = player!.id;

    const [beatmap] = await db
      .insert(schema.beatmaps)
      .values({
        osuId: BEATMAP_OSU_ID,
        ruleset: Ruleset.Osu,
        rankedStatus: 1,
        diffName: 'range1160',
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
      })
      .returning({ id: schema.beatmaps.id });

    for (const [index, seed] of seeds.entries()) {
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: `${NAME_PREFIX}${seed.label}`,
          abbreviation: 'Z1160',
          forumUrl: `https://osu.ppy.sh/community/forums/topics/1160${index}`,
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: seed.status,
          startTime: seed.startTime,
          endTime: seed.endTime,
        })
        .returning({ id: schema.tournaments.id });
      labels.set(tournament!.id, seed.label);

      await db.insert(schema.joinPooledBeatmaps).values({
        pooledBeatmapsId: beatmap!.id,
        tournamentsPooledInId: tournament!.id,
      });

      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: MATCH_OSU_ID_BASE + index,
          tournamentId: tournament!.id,
          startTime: seed.playedAt,
          verificationStatus: seed.status,
        })
        .returning({ id: schema.matches.id });

      const [game] = await db
        .insert(schema.games)
        .values({
          osuId: GAME_OSU_ID_BASE + index,
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 0,
          mods: 0,
          matchId: match!.id,
          beatmapId: beatmap!.id,
          startTime: seed.playedAt,
          verificationStatus: seed.status,
        })
        .returning({ id: schema.games.id });

      await db.insert(schema.gameScores).values({
        rawScore: 500_000,
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
        ruleset: Ruleset.Osu,
        verificationStatus: seed.status,
        rejectionReason: 0,
        gameId: game!.id,
        playerId,
      });

      if (seed.status !== VerificationStatus.Verified) continue;

      await db.insert(schema.playerMatchStats).values({
        matchCost: 1,
        averageScore: 500_000,
        averagePlacement: 1,
        averageMisses: 0,
        averageAccuracy: 0.95,
        gamesPlayed: 1,
        gamesWon: 1,
        gamesLost: 0,
        won: true,
        teammateIds: [],
        opponentIds: [],
        playerId,
        matchId: match!.id,
      });

      await db.insert(schema.playerTournamentStats).values({
        averageRatingDelta: 0,
        averageMatchCost: 1,
        averageScore: 500_000,
        averagePlacement: 1,
        averageAccuracy: 0.95,
        matchesPlayed: 1,
        matchesWon: 1,
        matchesLost: 0,
        gamesPlayed: 1,
        gamesWon: 1,
        gamesLost: 0,
        teammateIds: [],
        playerId,
        tournamentId: tournament!.id,
      });
    }
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  // Player stats count a tournament for the range when the player has a
  // match in it that started within the range, whatever the tournament's dates.
  it('lists the tournaments with stats that the player played a match in during the range', async () => {
    const rows = await listPlayerStatsTournaments(db, playerId, RANGE);

    expect(label(rows)).toEqual(
      ['began before', 'ends on the last day', 'inside', 'still running'].sort()
    );
  });

  it('lists the tournaments without stats that the player scored in during the range', async () => {
    const rows = await listPlayerTournamentsWithoutStats(db, playerId, RANGE);

    expect(label(rows)).toEqual(['unverified began before']);
  });
});
