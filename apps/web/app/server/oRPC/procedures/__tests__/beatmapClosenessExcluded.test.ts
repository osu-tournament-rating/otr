import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, inArray, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, Team, TeamType, VerificationStatus } from '@otr/core/osu';

import { getBeatmapStats } from '../beatmapProcedures';
import { createTestDb, testDatabaseUrl } from './test-utils';

const NAME_PREFIX = 'beatmap-closeness-excluded-';
const BEATMAP_OSU_ID = 999_066_001;
const PLAYER_OSU_IDS = [999_066_301, 999_066_302, 999_066_303, 999_066_304];
const MATCH_OSU_ID_BASE = 999_066_100;
const GAME_OSU_ID_BASE = 999_066_200;

interface GameSeed {
  label: string;
  teamType: TeamType;
  status: VerificationStatus;
  /** One team per player, in the order of PLAYER_OSU_IDS. */
  teams: Team[];
}

interface TournamentSeed {
  status: VerificationStatus;
  games: GameSeed[];
}

// No game has rosters: the weekly rating run writes them only for fully
// verified games, and deletes them from games that are no longer verified.
const tournamentSeeds: TournamentSeed[] = [
  {
    status: VerificationStatus.PreVerified,
    games: [
      {
        label: 'two teams of two',
        teamType: TeamType.TeamVs,
        status: VerificationStatus.PreVerified,
        teams: [Team.Red, Team.Red, Team.Blue, Team.Blue],
      },
      {
        label: 'one team',
        teamType: TeamType.TeamVs,
        status: VerificationStatus.PreVerified,
        teams: [Team.Red, Team.Red, Team.Red],
      },
      {
        label: 'tag team',
        teamType: TeamType.TagTeamVs,
        status: VerificationStatus.PreVerified,
        teams: [Team.Red, Team.Blue],
      },
    ],
  },
  {
    status: VerificationStatus.Verified,
    games: [
      {
        label: 'fully verified',
        teamType: TeamType.TeamVs,
        status: VerificationStatus.Verified,
        teams: [Team.Red, Team.Blue],
      },
      {
        label: 'rejected game',
        teamType: TeamType.TeamVs,
        status: VerificationStatus.Rejected,
        teams: [Team.Red, Team.Blue],
      },
    ],
  },
];

describe.skipIf(!testDatabaseUrl)(
  'getBeatmapStats closeness excluded games',
  () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    let beatmapId = 0;

    const remove = async () => {
      // Cascades to matches, games and scores
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
            abbreviation: 'BCE',
            forumUrl: `https://osu.ppy.sh/community/forums/topics/1066${index}`,
            rankRangeLowerBound: 1,
            ruleset: Ruleset.Osu,
            lobbySize: 4,
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
              teamType: game.teamType,
              mods: 0,
              matchId: match!.id,
              beatmapId,
              verificationStatus: game.status,
            })
            .returning({ id: schema.games.id });

          // A game's rejection reaches its scores
          await db.insert(schema.gameScores).values(
            game.teams.map((team, player) => ({
              rawScore: 400_000 + player * 10_000,
              placement: player + 1,
              accuracy: 0.95,
              maxCombo: 100,
              pass: true,
              isPerfectCombo: false,
              legacyPerfect: false,
              grade: 1,
              mods: 0,
              legacyTotalScore: 0,
              team,
              ruleset: Ruleset.Osu,
              verificationStatus: game.status,
              rejectionReason: 0,
              gameId: row!.id,
              playerId: playerIds[player]!,
            }))
          );
        }
      }
    });

    afterAll(async () => {
      await remove();
      await pool.end();
    });

    it('counts Team Vs games with two teams of scores that are not verified at every level', async () => {
      const stats = await call(
        getBeatmapStats,
        { id: beatmapId, keyType: 'otr' },
        { context: { db, headers: new Headers() } }
      );

      // 'two teams of two' and 'rejected game'
      expect(stats.closeness.excludedUnverifiedGameCount).toBe(2);
    });
  }
);
