import { inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  GameRejectionReason,
  GameWarningFlags,
  MatchRejectionReason,
  MatchWarningFlags,
  ScoreRejectionReason,
  VerificationStatus,
} from '../osu/enums';
import * as schema from './schema';

export interface CascadeResult {
  matchCount: number;
  gameCount: number;
  scoreCount: number;
}

type MutationClient = Pick<NodePgDatabase<Record<string, unknown>>, 'update'>;

type TimestampValue = string | SQL<unknown>;

type MatchCascadeOptions = {
  updatedAt?: TimestampValue;
  appendMatchReason?: MatchRejectionReason;
};

type GameCascadeOptions = {
  updatedAt?: TimestampValue;
};

type TournamentCascadeOptions = {
  updatedAt?: TimestampValue;
  /** The admin credited on each match the rejection changes. */
  verifiedByUserId?: number;
};

function normalizeIds(ids: readonly number[]): number[] {
  const seen = new Set<number>();

  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      continue;
    }

    const normalized = Math.trunc(id);
    if (!seen.has(normalized)) {
      seen.add(normalized);
    }
  }

  return Array.from(seen.values());
}

const DEFAULT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;

/**
 * Credits `userId` as the reviewer of each match a cascade moves to `status`.
 * A match already there keeps the reviewer who put it there.
 */
export function creditReviewer(
  status: VerificationStatus,
  userId: number | undefined
): SQL | undefined {
  if (userId === undefined) {
    return undefined;
  }

  return sql`CASE WHEN ${schema.matches.verificationStatus} = ${status} THEN ${schema.matches.verifiedByUserId} ELSE ${userId}::integer END`;
}

function resolveTimestamp(value?: TimestampValue): TimestampValue {
  return value ?? DEFAULT_TIMESTAMP;
}

async function cascadeScores(
  db: MutationClient,
  gameIds: number[],
  updatedAt: TimestampValue
): Promise<number> {
  if (gameIds.length === 0) {
    return 0;
  }

  const updatedScores = await db
    .update(schema.gameScores)
    .set({
      verificationStatus: VerificationStatus.Rejected,
      rejectionReason: sql`${schema.gameScores.rejectionReason} | ${ScoreRejectionReason.RejectedGame}`,
      updated: updatedAt,
    })
    .where(inArray(schema.gameScores.gameId, gameIds))
    .returning({ id: schema.gameScores.id });

  return updatedScores.length;
}

async function cascadeGames(
  db: MutationClient,
  matchIds: number[],
  updatedAt: TimestampValue
): Promise<{ gameIds: number[]; gameCount: number }> {
  if (matchIds.length === 0) {
    return { gameIds: [], gameCount: 0 };
  }

  const updatedGames = await db
    .update(schema.games)
    .set({
      verificationStatus: VerificationStatus.Rejected,
      rejectionReason: sql`${schema.games.rejectionReason} | ${GameRejectionReason.RejectedMatch}`,
      warningFlags: GameWarningFlags.None,
      updated: updatedAt,
    })
    .where(inArray(schema.games.matchId, matchIds))
    .returning({ id: schema.games.id });

  const gameIds = updatedGames.map((game) => game.id);

  return { gameIds, gameCount: updatedGames.length };
}

export async function cascadeMatchRejection(
  db: MutationClient,
  matchIdsInput: readonly number[],
  options?: MatchCascadeOptions
): Promise<CascadeResult> {
  const matchIds = normalizeIds(matchIdsInput);

  if (matchIds.length === 0) {
    return { matchCount: 0, gameCount: 0, scoreCount: 0 };
  }

  const updatedAt = resolveTimestamp(options?.updatedAt);
  const matchUpdate: Record<string, unknown> = {
    verificationStatus: VerificationStatus.Rejected,
    warningFlags: MatchWarningFlags.None,
    updated: updatedAt,
  };

  if (options?.appendMatchReason !== undefined) {
    matchUpdate.rejectionReason = sql`${schema.matches.rejectionReason} | ${options.appendMatchReason}`;
  }

  const updatedMatches = await db
    .update(schema.matches)
    .set(matchUpdate)
    .where(inArray(schema.matches.id, matchIds))
    .returning({ id: schema.matches.id });

  const updatedMatchIds = updatedMatches.map((match) => match.id);

  const { gameIds, gameCount } = await cascadeGames(
    db,
    updatedMatchIds,
    updatedAt
  );
  const scoreCount = await cascadeScores(db, gameIds, updatedAt);

  return {
    matchCount: updatedMatches.length,
    gameCount,
    scoreCount,
  };
}

export async function cascadeTournamentRejection(
  db: MutationClient,
  tournamentIdsInput: readonly number[],
  options?: TournamentCascadeOptions
): Promise<CascadeResult> {
  const tournamentIds = normalizeIds(tournamentIdsInput);

  if (tournamentIds.length === 0) {
    return { matchCount: 0, gameCount: 0, scoreCount: 0 };
  }

  const updatedAt = resolveTimestamp(options?.updatedAt);

  const updatedMatches = await db
    .update(schema.matches)
    .set({
      verificationStatus: VerificationStatus.Rejected,
      rejectionReason: sql`${schema.matches.rejectionReason} | ${MatchRejectionReason.RejectedTournament}`,
      warningFlags: MatchWarningFlags.None,
      verifiedByUserId: creditReviewer(
        VerificationStatus.Rejected,
        options?.verifiedByUserId
      ),
      updated: updatedAt,
    })
    .where(inArray(schema.matches.tournamentId, tournamentIds))
    .returning({ id: schema.matches.id });

  const matchIds = updatedMatches.map((match) => match.id);
  const { gameIds, gameCount } = await cascadeGames(db, matchIds, updatedAt);
  const scoreCount = await cascadeScores(db, gameIds, updatedAt);

  return {
    matchCount: updatedMatches.length,
    gameCount,
    scoreCount,
  };
}

export async function cascadeGameRejection(
  db: MutationClient,
  gameIdsInput: readonly number[],
  options?: GameCascadeOptions
): Promise<CascadeResult> {
  const gameIds = normalizeIds(gameIdsInput);

  if (gameIds.length === 0) {
    return { matchCount: 0, gameCount: 0, scoreCount: 0 };
  }

  const updatedAt = resolveTimestamp(options?.updatedAt);
  const scoreCount = await cascadeScores(db, gameIds, updatedAt);

  return {
    matchCount: 0,
    gameCount: 0,
    scoreCount,
  };
}
