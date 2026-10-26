import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  matchPendingRatingSql,
  reviewerUsernameSql,
  tournamentPendingRatingSql,
} from '../verificationDetails';

// Seeds and deletes rows; point it at a disposable database
const url = process.env.SEARCH_TEST_DATABASE_URL;

const PREFIX = 'Verification details 1264';
const REVIEWER_OSU_ID = 999_126_401;
const PLAYER_OSU_ID = 999_126_402;
const REVIEWER_NAME = 'reviewer1264';

describe.skipIf(!url)('verification details', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  const tournamentIds = new Map<string, number>();
  const matchIds = new Map<string, number>();

  const remove = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${PREFIX}%`));
    await db.delete(schema.users).where(
      inArray(
        schema.users.playerId,
        db
          .select({ id: schema.players.id })
          .from(schema.players)
          .where(
            inArray(schema.players.osuId, [REVIEWER_OSU_ID, PLAYER_OSU_ID])
          )
      )
    );
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, [REVIEWER_OSU_ID, PLAYER_OSU_ID]));
  };

  beforeAll(async () => {
    await remove();

    const [reviewer, player] = await db
      .insert(schema.players)
      .values([
        { osuId: REVIEWER_OSU_ID, username: REVIEWER_NAME },
        { osuId: PLAYER_OSU_ID, username: 'player1264' },
      ])
      .returning({ id: schema.players.id });
    const [reviewerUser] = await db
      .insert(schema.users)
      .values({ playerId: reviewer!.id, scopes: ['admin'] })
      .returning({ id: schema.users.id });

    const tournamentSeeds = {
      rated: VerificationStatus.Verified,
      unrated: VerificationStatus.Verified,
      preVerified: VerificationStatus.PreVerified,
    };
    for (const [key, status] of Object.entries(tournamentSeeds)) {
      const [row] = await db
        .insert(schema.tournaments)
        .values({
          name: `${PREFIX} ${key}`,
          abbreviation: `VD-${key}`,
          forumUrl: `https://osu.ppy.sh/community/forums/topics/1264`,
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: status,
          verifiedByUserId:
            status === VerificationStatus.Verified ? reviewerUser!.id : null,
        })
        .returning({ id: schema.tournaments.id });
      tournamentIds.set(key, row!.id);
    }

    const matchSeeds: Record<
      string,
      { tournament: string; status: VerificationStatus }
    > = {
      rated: { tournament: 'rated', status: VerificationStatus.Verified },
      unrated: { tournament: 'unrated', status: VerificationStatus.Verified },
      preVerified: {
        tournament: 'unrated',
        status: VerificationStatus.PreVerified,
      },
      inPreVerifiedTournament: {
        tournament: 'preVerified',
        status: VerificationStatus.Verified,
      },
    };
    let osuId = 999_126_400_000;
    for (const [key, seed] of Object.entries(matchSeeds)) {
      const [row] = await db
        .insert(schema.matches)
        .values({
          osuId: osuId++,
          name: `${PREFIX} ${key}`,
          tournamentId: tournamentIds.get(seed.tournament)!,
          verificationStatus: seed.status,
        })
        .returning({ id: schema.matches.id });
      matchIds.set(key, row!.id);
    }

    await db.insert(schema.playerTournamentStats).values({
      playerId: player!.id,
      tournamentId: tournamentIds.get('rated')!,
      averageRatingDelta: 0,
      averageMatchCost: 1,
      averageScore: 0,
      averagePlacement: 1,
      averageAccuracy: 1,
      matchesPlayed: 1,
      matchesWon: 1,
      matchesLost: 0,
      gamesPlayed: 1,
      gamesWon: 1,
      gamesLost: 0,
      teammateIds: [],
    });
    await db.insert(schema.playerMatchStats).values({
      playerId: player!.id,
      matchId: matchIds.get('rated')!,
      matchCost: 1,
      averageScore: 0,
      averagePlacement: 1,
      averageMisses: 0,
      averageAccuracy: 1,
      gamesPlayed: 1,
      gamesWon: 1,
      gamesLost: 0,
      won: true,
      teammateIds: [],
      opponentIds: [],
    });
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  // Each query reads one table with no joins, the shape in which Drizzle
  // drops table names from selected expressions (see `defaultRuleset.ts`).
  const tournamentsByKey = async () => {
    const rows = await db
      .select({
        name: schema.tournaments.name,
        reviewer: reviewerUsernameSql(schema.tournaments.verifiedByUserId),
        pendingRating: tournamentPendingRatingSql(schema.tournaments),
      })
      .from(schema.tournaments)
      .where(like(schema.tournaments.name, `${PREFIX}%`));
    return new Map(rows.map((row) => [row.name.slice(PREFIX.length + 1), row]));
  };

  it('names the admin who verified a tournament, and no one otherwise', async () => {
    const rows = await tournamentsByKey();

    expect(rows.get('unrated')?.reviewer).toBe(REVIEWER_NAME);
    expect(rows.get('preVerified')?.reviewer).toBeNull();
  });

  it('marks only a verified tournament without player stats as pending rating', async () => {
    const rows = await tournamentsByKey();

    expect(rows.get('unrated')?.pendingRating).toBe(true);
    expect(rows.get('rated')?.pendingRating).toBe(false);
    expect(rows.get('preVerified')?.pendingRating).toBe(false);
  });

  it('marks only a verified match in a verified tournament without player stats as pending rating', async () => {
    const rows = await db
      .select({
        name: schema.matches.name,
        pendingRating: matchPendingRatingSql(schema.matches),
      })
      .from(schema.matches)
      .where(like(schema.matches.name, `${PREFIX}%`));
    const byKey = new Map(
      rows.map((row) => [row.name.slice(PREFIX.length + 1), row.pendingRating])
    );

    expect(byKey.size).toBe(4);
    expect(byKey.get('unrated')).toBe(true);
    expect(byKey.get('rated')).toBe(false);
    expect(byKey.get('preVerified')).toBe(false);
    expect(byKey.get('inPreVerifiedTournament')).toBe(false);
  });
});
