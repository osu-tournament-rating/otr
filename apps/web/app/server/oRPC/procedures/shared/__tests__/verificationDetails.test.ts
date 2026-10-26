import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  gameReviewerUsernameSql,
  matchPendingRatingSql,
  reviewerUsernameSql,
  scoreReviewerUsernameSql,
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

const AUDIT_PREFIX = 'Audited reviewer 1264';
const FIRST_ADMIN_OSU_ID = 999_126_411;
const SECOND_ADMIN_OSU_ID = 999_126_412;

// Games and scores keep no verifier; the tooltip names the admin from their
// audit rows. Rows before October 2025 spell the key `verificationStatus`.
const statusChange = (
  key: 'verification_status' | 'verificationStatus',
  from: VerificationStatus,
  to: VerificationStatus
) => ({ [key]: { originalValue: from, newValue: to } });

describe.skipIf(!url)('audited reviewer', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  const adminIds: number[] = [];
  const gameIds = new Map<string, number>();
  let scoreId = 0;
  const osuIds = [FIRST_ADMIN_OSU_ID, SECOND_ADMIN_OSU_ID];

  const remove = async () => {
    const games = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
      .innerJoin(
        schema.tournaments,
        eq(schema.tournaments.id, schema.matches.tournamentId)
      )
      .where(like(schema.tournaments.name, `${AUDIT_PREFIX}%`));
    const ids = games.map((game) => game.id);
    if (ids.length > 0) {
      const scores = await db
        .select({ id: schema.gameScores.id })
        .from(schema.gameScores)
        .where(inArray(schema.gameScores.gameId, ids));
      await db
        .delete(schema.gameAudits)
        .where(inArray(schema.gameAudits.referenceIdLock, ids));
      if (scores.length > 0) {
        await db.delete(schema.gameScoreAudits).where(
          inArray(
            schema.gameScoreAudits.referenceIdLock,
            scores.map((score) => score.id)
          )
        );
      }
    }
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${AUDIT_PREFIX}%`));
    await db
      .delete(schema.users)
      .where(
        inArray(
          schema.users.playerId,
          db
            .select({ id: schema.players.id })
            .from(schema.players)
            .where(inArray(schema.players.osuId, osuIds))
        )
      );
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, osuIds));
  };

  beforeAll(async () => {
    await remove();

    const players = await db
      .insert(schema.players)
      .values([
        { osuId: FIRST_ADMIN_OSU_ID, username: 'firstadmin1264' },
        { osuId: SECOND_ADMIN_OSU_ID, username: 'secondadmin1264' },
      ])
      .returning({ id: schema.players.id });
    const users = await db
      .insert(schema.users)
      .values(players.map((player) => ({ playerId: player.id })))
      .returning({ id: schema.users.id });
    adminIds.push(...users.map((user) => user.id));

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: AUDIT_PREFIX,
        abbreviation: 'AR1264',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1264',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 4,
      })
      .returning({ id: schema.tournaments.id });
    const [match] = await db
      .insert(schema.matches)
      .values({ osuId: 999_126_410_000, tournamentId: tournament!.id })
      .returning({ id: schema.matches.id });

    const gameSeeds = {
      reverified: VerificationStatus.Verified,
      rejected: VerificationStatus.Rejected,
      bySystem: VerificationStatus.Verified,
      preVerified: VerificationStatus.PreVerified,
    };
    let osuId = 999_126_410_100;
    for (const [key, status] of Object.entries(gameSeeds)) {
      const [game] = await db
        .insert(schema.games)
        .values({
          osuId: osuId++,
          matchId: match!.id,
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 2,
          mods: 0,
          verificationStatus: status,
        })
        .returning({ id: schema.games.id });
      gameIds.set(key, game!.id);
    }

    const [first, second] = adminIds;
    const { PreVerified, Verified, Rejected } = VerificationStatus;
    // Inserting the games may have written audit rows of their own; these
    // rows come after them.
    await db.insert(schema.gameAudits).values([
      {
        referenceIdLock: gameIds.get('reverified')!,
        actionUserId: first,
        actionType: 1,
        changes: statusChange('verificationStatus', PreVerified, Verified),
      },
      {
        referenceIdLock: gameIds.get('reverified')!,
        actionUserId: first,
        actionType: 1,
        changes: statusChange('verification_status', Verified, Rejected),
      },
      {
        referenceIdLock: gameIds.get('reverified')!,
        actionUserId: second,
        actionType: 1,
        changes: statusChange('verification_status', Rejected, Verified),
      },
      {
        referenceIdLock: gameIds.get('rejected')!,
        actionUserId: first,
        actionType: 1,
        changes: statusChange('verificationStatus', PreVerified, Rejected),
      },
      // An admin's earlier decision doesn't name whoever set the status now.
      {
        referenceIdLock: gameIds.get('bySystem')!,
        actionUserId: first,
        actionType: 1,
        changes: statusChange('verification_status', PreVerified, Rejected),
      },
      {
        referenceIdLock: gameIds.get('bySystem')!,
        actionUserId: null,
        actionType: 1,
        changes: statusChange('verification_status', PreVerified, Verified),
      },
      {
        referenceIdLock: gameIds.get('preVerified')!,
        actionUserId: first,
        actionType: 1,
        changes: statusChange('verification_status', Verified, PreVerified),
      },
    ]);

    const [score] = await db
      .insert(schema.gameScores)
      .values({
        gameId: gameIds.get('reverified')!,
        playerId: players[0]!.id,
        rawScore: 1,
        placement: 1,
        accuracy: 1,
        maxCombo: 1,
        pass: true,
        isPerfectCombo: false,
        legacyPerfect: false,
        grade: 0,
        mods: 0,
        legacyTotalScore: 1,
        team: 0,
        ruleset: Ruleset.Osu,
        verificationStatus: Verified,
        rejectionReason: 0,
      })
      .returning({ id: schema.gameScores.id });
    scoreId = score!.id;
    await db.insert(schema.gameScoreAudits).values({
      referenceIdLock: scoreId,
      actionUserId: second,
      actionType: 1,
      changes: statusChange('verification_status', PreVerified, Verified),
    });
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  it('names the admin who last set a game to its status, under either key', async () => {
    const rows = await db
      .select({
        id: schema.games.id,
        reviewer: gameReviewerUsernameSql(schema.games),
      })
      .from(schema.games)
      .where(inArray(schema.games.id, [...gameIds.values()]));
    const byId = new Map(rows.map((row) => [row.id, row.reviewer]));

    expect(byId.size).toBe(4);
    expect(byId.get(gameIds.get('reverified')!)).toBe('secondadmin1264');
    expect(byId.get(gameIds.get('rejected')!)).toBe('firstadmin1264');
    expect(byId.get(gameIds.get('bySystem')!)).toBeNull();
    expect(byId.get(gameIds.get('preVerified')!)).toBeNull();
  });

  it('names the admin who verified a score', async () => {
    const [row] = await db
      .select({ reviewer: scoreReviewerUsernameSql(schema.gameScores) })
      .from(schema.gameScores)
      .where(eq(schema.gameScores.id, scoreId));

    expect(row?.reviewer).toBe('secondadmin1264');
  });
});
