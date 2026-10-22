import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, Team, VerificationStatus } from '@otr/core/osu';

import { getPlayerStats } from '../playerProcedures';
import { createTestDb, removePlayers, testDatabaseUrl } from './test-utils';

const SEED_OSU_ID = 990_000_310;
const SEED_NAME = 'player-stats-match-record';

describe.skipIf(!testDatabaseUrl)('getPlayerStats match record', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const osuIds = [SEED_OSU_ID, SEED_OSU_ID + 1, SEED_OSU_ID + 2];
  let playerId = 0;
  let switcherId = 0;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(eq(schema.tournaments.name, SEED_NAME));
    await removePlayers(db, osuIds);
  };

  beforeAll(async () => {
    await removeSeed();

    const [player, opponent, switcher] = await db
      .insert(schema.players)
      .values(osuIds.map((osuId) => ({ osuId, username: `record-${osuId}` })))
      .returning({ id: schema.players.id });
    playerId = player!.id;
    switcherId = switcher!.id;

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: SEED_NAME,
        abbreviation: 'PSMR',
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${SEED_OSU_ID}`,
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
        verificationStatus: VerificationStatus.Verified,
      })
      .returning({ id: schema.tournaments.id });

    // Games won by the player and by the opponent: a win, a loss, a draw.
    const results = [
      [2, 1],
      [1, 2],
      [1, 1],
    ];
    const matches = await db
      .insert(schema.matches)
      .values(
        results.map((_, index) => ({
          osuId: SEED_OSU_ID + index,
          tournamentId: tournament!.id,
          verificationStatus: VerificationStatus.Verified,
          startTime: `2026-01-0${index + 1}T00:00:00Z`,
        }))
      )
      .returning({ id: schema.matches.id });

    for (const [index, [own, theirs]] of results.entries()) {
      const matchId = matches[index]!.id;
      await db.insert(schema.matchRosters).values([
        { matchId, team: Team.Red, roster: [player!.id], score: own! },
        { matchId, team: Team.Blue, roster: [opponent!.id], score: theirs! },
      ]);
      await db.insert(schema.playerMatchStats).values({
        playerId: player!.id,
        matchId,
        matchCost: 1,
        averageScore: 500_000,
        averagePlacement: 1.5,
        averageMisses: 0,
        averageAccuracy: 0.95,
        gamesPlayed: own! + theirs!,
        gamesWon: own!,
        gamesLost: theirs!,
        won: own! > theirs!,
        teammateIds: [],
        opponentIds: [opponent!.id],
      });
    }

    // A player who played for both teams, which ended Red 3, Blue 1. The
    // worker stored a win, from the Red roster.
    const [switchedMatch] = await db
      .insert(schema.matches)
      .values({
        osuId: SEED_OSU_ID + results.length,
        tournamentId: tournament!.id,
        verificationStatus: VerificationStatus.Verified,
        startTime: '2026-01-10T00:00:00Z',
      })
      .returning({ id: schema.matches.id });
    const matchId = switchedMatch!.id;
    await db.insert(schema.matchRosters).values([
      { matchId, team: Team.Red, roster: [switcher!.id], score: 3 },
      {
        matchId,
        team: Team.Blue,
        roster: [switcher!.id, opponent!.id],
        score: 1,
      },
    ]);
    await db.insert(schema.playerMatchStats).values({
      playerId: switcher!.id,
      matchId,
      matchCost: 1,
      averageScore: 500_000,
      averagePlacement: 1.5,
      averageMisses: 0,
      averageAccuracy: 0.95,
      gamesPlayed: 4,
      gamesWon: 3,
      gamesLost: 1,
      won: true,
      teammateIds: [],
      opponentIds: [opponent!.id],
    });
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it('counts a drawn match as neither a win nor a loss', async () => {
    const stats = await call(
      getPlayerStats,
      { id: playerId, keyType: 'otr', ruleset: Ruleset.Osu },
      { context: { db, headers: new Headers() } }
    );

    expect(stats.matchStats).toMatchObject({
      matchesPlayed: 3,
      matchesWon: 1,
      matchesLost: 1,
    });
  });

  it('does not count a won match as lost for a player who also played for the losing team', async () => {
    const stats = await call(
      getPlayerStats,
      { id: switcherId, keyType: 'otr', ruleset: Ruleset.Osu },
      { context: { db, headers: new Headers() } }
    );

    expect(stats.matchStats).toMatchObject({
      matchesPlayed: 1,
      matchesWon: 1,
      matchesLost: 0,
    });
  });
});
