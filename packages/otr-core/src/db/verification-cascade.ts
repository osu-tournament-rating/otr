import { and, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  GameWarningFlags,
  MatchWarningFlags,
  VerificationStatus,
} from '../osu/enums';
import * as schema from './schema';

export interface VerificationCascadeResult {
  matchCount: number;
  gameCount: number;
  scoreCount: number;
}

type MutationClient = Pick<
  NodePgDatabase<Record<string, unknown>>,
  'update' | 'select'
>;

type TimestampValue = string | SQL<unknown>;

type CascadeOptions = {
  updatedAt?: TimestampValue;
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

function resolveTimestamp(value?: TimestampValue): TimestampValue {
  return value ?? DEFAULT_TIMESTAMP;
}

/** Cascades to every score under the given games. */
async function cascadeScoresVerification(
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
      verificationStatus: VerificationStatus.Verified,
      rejectionReason: 0,
      updated: updatedAt,
    })
    .where(inArray(schema.gameScores.gameId, gameIds))
    .returning({ id: schema.gameScores.id });

  return updatedScores.length;
}

/** Cascades to every game under the given matches, clearing their warning flags. */
async function cascadeGamesVerification(
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
      verificationStatus: VerificationStatus.Verified,
      rejectionReason: 0,
      warningFlags: GameWarningFlags.None,
      updated: updatedAt,
    })
    .where(inArray(schema.games.matchId, matchIds))
    .returning({ id: schema.games.id });

  const gameIds = updatedGames.map((game) => game.id);

  return { gameIds, gameCount: updatedGames.length };
}

/**
 * Cascades to every match under the given tournaments, clearing their warning
 * flags. A match osu! returned no data for has no start time and stays as it
 * is, since the rating run cannot rate it.
 */
async function cascadeMatchesVerification(
  db: MutationClient,
  tournamentIds: number[],
  updatedAt: TimestampValue
): Promise<{ matchIds: number[]; matchCount: number }> {
  if (tournamentIds.length === 0) {
    return { matchIds: [], matchCount: 0 };
  }

  const updatedMatches = await db
    .update(schema.matches)
    .set({
      verificationStatus: VerificationStatus.Verified,
      rejectionReason: 0,
      warningFlags: MatchWarningFlags.None,
      updated: updatedAt,
    })
    .where(
      and(
        inArray(schema.matches.tournamentId, tournamentIds),
        isNotNull(schema.matches.startTime)
      )
    )
    .returning({ id: schema.matches.id });

  const matchIds = updatedMatches.map((match) => match.id);

  return { matchIds, matchCount: updatedMatches.length };
}

/** Cascades verification from a game to its scores. */
export async function cascadeGameVerification(
  db: MutationClient,
  gameIdsInput: readonly number[],
  options?: CascadeOptions
): Promise<VerificationCascadeResult> {
  const gameIds = normalizeIds(gameIdsInput);

  if (gameIds.length === 0) {
    return { matchCount: 0, gameCount: 0, scoreCount: 0 };
  }

  const updatedAt = resolveTimestamp(options?.updatedAt);
  const scoreCount = await cascadeScoresVerification(db, gameIds, updatedAt);

  return {
    matchCount: 0,
    gameCount: 0,
    scoreCount,
  };
}

/** Cascades verification from a match to its games and scores. */
export async function cascadeMatchVerification(
  db: MutationClient,
  matchIdsInput: readonly number[],
  options?: CascadeOptions
): Promise<VerificationCascadeResult> {
  const matchIds = normalizeIds(matchIdsInput);

  if (matchIds.length === 0) {
    return { matchCount: 0, gameCount: 0, scoreCount: 0 };
  }

  const updatedAt = resolveTimestamp(options?.updatedAt);

  const { gameIds, gameCount } = await cascadeGamesVerification(
    db,
    matchIds,
    updatedAt
  );
  const scoreCount = await cascadeScoresVerification(db, gameIds, updatedAt);

  return {
    matchCount: 0,
    gameCount,
    scoreCount,
  };
}

/** Cascades verification from a tournament to its matches, games and scores. */
export async function cascadeTournamentVerification(
  db: MutationClient,
  tournamentIdsInput: readonly number[],
  options?: CascadeOptions
): Promise<VerificationCascadeResult> {
  const tournamentIds = normalizeIds(tournamentIdsInput);

  if (tournamentIds.length === 0) {
    return { matchCount: 0, gameCount: 0, scoreCount: 0 };
  }

  const updatedAt = resolveTimestamp(options?.updatedAt);

  const { matchIds, matchCount } = await cascadeMatchesVerification(
    db,
    tournamentIds,
    updatedAt
  );
  const { gameIds, gameCount } = await cascadeGamesVerification(
    db,
    matchIds,
    updatedAt
  );
  const scoreCount = await cascadeScoresVerification(db, gameIds, updatedAt);

  return {
    matchCount,
    gameCount,
    scoreCount,
  };
}
