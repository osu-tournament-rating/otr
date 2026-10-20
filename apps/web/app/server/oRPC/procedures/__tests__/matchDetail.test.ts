import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import { getMatch } from '../matchesProcedures';
import { createTestDb, testDatabaseUrl } from './test-utils';

const NAME_PREFIX = 'match-detail-';
const PLAYER_OSU_ID = 999_067_001;
const MATCH_OSU_ID_BASE = 999_067_100;

describe.skipIf(!testDatabaseUrl)('getMatch player match stats', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const matchIds = {} as Record<'verified' | 'rejected', number>;
  let playerId = 0;

  const remove = async () => {
    // Cascades to matches and their stats
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.players)
      .where(eq(schema.players.osuId, PLAYER_OSU_ID));
  };

  beforeAll(async () => {
    await remove();

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: PLAYER_OSU_ID, username: 'match-detail' })
      .returning({ id: schema.players.id });
    playerId = player!.id;

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}tournament`,
        abbreviation: 'MD',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999067',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 4,
        verificationStatus: VerificationStatus.Verified,
      })
      .returning({ id: schema.tournaments.id });

    // Both had stats computed while verified; one was rejected since, and
    // keeps them until the weekly rating run deletes them.
    const statuses = [
      ['verified', VerificationStatus.Verified],
      ['rejected', VerificationStatus.Rejected],
    ] as const;

    for (const [index, [key, status]] of statuses.entries()) {
      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: MATCH_OSU_ID_BASE + index,
          name: `${NAME_PREFIX}${key}`,
          tournamentId: tournament!.id,
          verificationStatus: status,
        })
        .returning({ id: schema.matches.id });
      matchIds[key] = match!.id;

      await db.insert(schema.playerMatchStats).values({
        matchCost: 1.2,
        averageScore: 500_000,
        averagePlacement: 1,
        averageMisses: 0,
        averageAccuracy: 0.98,
        gamesPlayed: 5,
        gamesWon: 4,
        gamesLost: 1,
        won: true,
        teammateIds: [],
        opponentIds: [],
        playerId,
        matchId: match!.id,
      });
    }
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  const detail = (id: number) =>
    call(
      getMatch,
      { id, keyType: 'otr' },
      { context: { db, headers: new Headers() } }
    );

  it('returns player match stats for a verified match', async () => {
    const match = await detail(matchIds.verified);

    expect(match.playerMatchStats.map((stats) => stats.playerId)).toEqual([
      playerId,
    ]);
  });

  // The stats say who won and by how many games, which a match that no
  // longer counts must not reveal.
  it('leaves out player match stats of a match rejected since they were computed', async () => {
    const match = await detail(matchIds.rejected);

    expect(match.playerMatchStats).toEqual([]);
  });
});
