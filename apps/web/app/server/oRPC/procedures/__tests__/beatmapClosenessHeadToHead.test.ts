import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, inArray, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, Team, TeamType, VerificationStatus } from '@otr/core/osu';

import { getBeatmapStats } from '../beatmapProcedures';
import { createTestDb, testDatabaseUrl } from './test-utils';

const NAME_PREFIX = 'beatmap-closeness-h2h-';
const BEATMAP_OSU_ID = 999_068_001;
const PLAYER_OSU_IDS = [999_068_301, 999_068_302, 999_068_303];
const MATCH_OSU_ID_BASE = 999_068_100;
const GAME_OSU_ID_BASE = 999_068_200;

interface GameSeed {
  /** How many players, of PLAYER_OSU_IDS in order, scored. */
  players: number;
  /** Writes a one-player roster per player, as the stats job does. */
  rosters: boolean;
}

interface TournamentSeed {
  lobbySize: number;
  status: VerificationStatus;
  games: GameSeed[];
}

// Every game is head-to-head, so osu! gives its scores no team.
const tournamentSeeds: TournamentSeed[] = [
  // Counted in the closeness rows.
  {
    lobbySize: 1,
    status: VerificationStatus.Verified,
    games: [{ players: 2, rosters: true }],
  },
  // A head-to-head game an admin verified in a 2v2: it has no sides.
  {
    lobbySize: 2,
    status: VerificationStatus.Verified,
    games: [{ players: 2, rosters: true }],
  },
  // Not yet verified: the two-player game counts as excluded, and the
  // three-player one has three sides.
  {
    lobbySize: 1,
    status: VerificationStatus.PreVerified,
    games: [
      { players: 2, rosters: false },
      { players: 3, rosters: false },
    ],
  },
  {
    lobbySize: 2,
    status: VerificationStatus.PreVerified,
    games: [{ players: 2, rosters: false }],
  },
];

describe.skipIf(!testDatabaseUrl)(
  'getBeatmapStats closeness of head-to-head games',
  () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    let beatmapId = 0;

    const remove = async () => {
      // Cascades to matches, games, scores and rosters
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
      await db
        .delete(schema.players)
        .where(inArray(schema.players.osuId, PLAYER_OSU_IDS));
      await db
        .delete(schema.beatmaps)
        .where(eq(schema.beatmaps.osuId, BEATMAP_OSU_ID));
    };

    beforeAll(async () => {
      await remove();

      const players = await db
        .insert(schema.players)
        .values(
          PLAYER_OSU_IDS.map((osuId) => ({
            osuId,
            username: `closeness${osuId}`,
          }))
        )
        .returning({ id: schema.players.id, osuId: schema.players.osuId });
      const playerIds = PLAYER_OSU_IDS.map(
        (osuId) => players.find((player) => player.osuId === osuId)!.id
      );

      const [beatmap] = await db
        .insert(schema.beatmaps)
        .values({
          osuId: BEATMAP_OSU_ID,
          ruleset: Ruleset.Osu,
          rankedStatus: 1,
          diffName: 'closeness',
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
      beatmapId = beatmap!.id;

      let gameIndex = 0;
      for (const [index, seed] of tournamentSeeds.entries()) {
        const [tournament] = await db
          .insert(schema.tournaments)
          .values({
            name: `${NAME_PREFIX}${index}`,
            abbreviation: 'BCH',
            forumUrl: `https://osu.ppy.sh/community/forums/topics/1068${index}`,
            rankRangeLowerBound: 1,
            ruleset: Ruleset.Osu,
            lobbySize: seed.lobbySize,
            verificationStatus: seed.status,
          })
          .returning({ id: schema.tournaments.id });

        const [match] = await db
          .insert(schema.matches)
          .values({
            osuId: MATCH_OSU_ID_BASE + index,
            tournamentId: tournament!.id,
            verificationStatus: seed.status,
          })
          .returning({ id: schema.matches.id });

        for (const game of seed.games) {
          gameIndex += 1;
          const [row] = await db
            .insert(schema.games)
            .values({
              osuId: GAME_OSU_ID_BASE + gameIndex,
              ruleset: Ruleset.Osu,
              scoringType: 3,
              teamType: TeamType.HeadToHead,
              mods: 0,
              matchId: match!.id,
              beatmapId,
              verificationStatus: seed.status,
            })
            .returning({ id: schema.games.id });

          const gamePlayers = playerIds.slice(0, game.players);
          const scoreOf = (player: number) => 500_000 - player * 100_000;

          await db.insert(schema.gameScores).values(
            gamePlayers.map((playerId, player) => ({
              rawScore: scoreOf(player),
              placement: player + 1,
              accuracy: 0.95,
              maxCombo: 100,
              pass: true,
              isPerfectCombo: false,
              legacyPerfect: false,
              grade: 1,
              mods: 0,
              legacyTotalScore: 0,
              team: Team.NoTeam,
              ruleset: Ruleset.Osu,
              verificationStatus: seed.status,
              rejectionReason: 0,
              gameId: row!.id,
              playerId,
            }))
          );

          if (game.rosters) {
            await db.insert(schema.gameRosters).values(
              gamePlayers.map((playerId, player) => ({
                gameId: row!.id,
                team: Team.NoTeam,
                roster: [playerId],
                score: scoreOf(player),
              }))
            );
          }
        }
      }
    });

    afterAll(async () => {
      await remove();
      await pool.end();
    });

    it('counts head-to-head games of two players in 1v1 tournaments only', async () => {
      const stats = await call(
        getBeatmapStats,
        { id: beatmapId, keyType: 'otr' },
        { context: { db, headers: new Headers() } }
      );

      expect(stats.closeness.gameCount).toBe(1);
      expect(stats.closeness.excludedUnverifiedGameCount).toBe(1);
    });
  }
);
