import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  GameWarningFlags,
  MatchWarningFlags,
  VerificationStatus,
} from '../osu/enums';
import {
  cascadeGameRejection,
  cascadeMatchRejection,
} from './rejection-cascade';
import * as schema from './schema';

export interface VerificationResolveResult {
  matchCount: number;
  gameCount: number;
  scoreCount: number;
}

type MutationClient = Pick<
  NodePgDatabase<Record<string, unknown>>,
  'update' | 'select'
>;

type TimestampValue = string | SQL<unknown>;

type ResolveOptions = {
  updatedAt?: TimestampValue;
};

type TournamentResolveOptions = ResolveOptions & {
  verifiedByUserId?: number;
};

const DEFAULT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;

function resolveTimestamp(value?: TimestampValue): TimestampValue {
  return value ?? DEFAULT_TIMESTAMP;
}

async function resolveMatches(
  db: MutationClient,
  tournamentId: number,
  updatedAt: TimestampValue,
  verifiedByUserId?: number
): Promise<number> {
  const verified = await db
    .update(schema.matches)
    .set({
      verificationStatus: VerificationStatus.Verified,
      rejectionReason: 0,
      warningFlags: MatchWarningFlags.None,
      verifiedByUserId,
      updated: updatedAt,
    })
    .where(
      and(
        eq(schema.matches.tournamentId, tournamentId),
        eq(schema.matches.verificationStatus, VerificationStatus.PreVerified),
        // A match with no data has no start time, which the rating run needs
        isNotNull(schema.matches.startTime)
      )
    )
    .returning({ id: schema.matches.id });

  const rejected = await db
    .update(schema.matches)
    .set({
      verificationStatus: VerificationStatus.Rejected,
      warningFlags: MatchWarningFlags.None,
      verifiedByUserId,
      updated: updatedAt,
    })
    .where(
      and(
        eq(schema.matches.tournamentId, tournamentId),
        eq(schema.matches.verificationStatus, VerificationStatus.PreRejected)
      )
    )
    .returning({ id: schema.matches.id });

  return verified.length + rejected.length;
}

async function resolveGames(
  db: MutationClient,
  matchIds: number[],
  updatedAt: TimestampValue
): Promise<number> {
  const verified = await db
    .update(schema.games)
    .set({
      verificationStatus: VerificationStatus.Verified,
      rejectionReason: 0,
      warningFlags: GameWarningFlags.None,
      updated: updatedAt,
    })
    .where(
      and(
        inArray(schema.games.matchId, matchIds),
        eq(schema.games.verificationStatus, VerificationStatus.PreVerified)
      )
    )
    .returning({ id: schema.games.id });

  const rejected = await db
    .update(schema.games)
    .set({
      verificationStatus: VerificationStatus.Rejected,
      warningFlags: GameWarningFlags.None,
      updated: updatedAt,
    })
    .where(
      and(
        inArray(schema.games.matchId, matchIds),
        eq(schema.games.verificationStatus, VerificationStatus.PreRejected)
      )
    )
    .returning({ id: schema.games.id });

  return verified.length + rejected.length;
}

async function resolveScores(
  db: MutationClient,
  gameIds: number[],
  updatedAt: TimestampValue
): Promise<number> {
  const verified = await db
    .update(schema.gameScores)
    .set({
      verificationStatus: VerificationStatus.Verified,
      rejectionReason: 0,
      updated: updatedAt,
    })
    .where(
      and(
        inArray(schema.gameScores.gameId, gameIds),
        eq(schema.gameScores.verificationStatus, VerificationStatus.PreVerified)
      )
    )
    .returning({ id: schema.gameScores.id });

  const rejected = await db
    .update(schema.gameScores)
    .set({
      verificationStatus: VerificationStatus.Rejected,
      updated: updatedAt,
    })
    .where(
      and(
        inArray(schema.gameScores.gameId, gameIds),
        eq(schema.gameScores.verificationStatus, VerificationStatus.PreRejected)
      )
    )
    .returning({ id: schema.gameScores.id });

  return verified.length + rejected.length;
}

async function resolveUnderMatches(
  db: MutationClient,
  matchIds: number[],
  updatedAt: TimestampValue
): Promise<{ gameCount: number; scoreCount: number }> {
  if (matchIds.length === 0) {
    return { gameCount: 0, scoreCount: 0 };
  }

  const gameCount = await resolveGames(db, matchIds, updatedAt);

  const gameRows = await db
    .select({
      id: schema.games.id,
      verificationStatus: schema.games.verificationStatus,
    })
    .from(schema.games)
    .where(inArray(schema.games.matchId, matchIds));

  const rejectedGameIds = gameRows
    .filter((row) => row.verificationStatus === VerificationStatus.Rejected)
    .map((row) => row.id);
  const openGameIds = gameRows
    .filter((row) => row.verificationStatus !== VerificationStatus.Rejected)
    .map((row) => row.id);

  if (rejectedGameIds.length > 0) {
    await cascadeGameRejection(db, rejectedGameIds, { updatedAt });
  }

  const scoreCount =
    openGameIds.length > 0
      ? await resolveScores(db, openGameIds, updatedAt)
      : 0;

  return { gameCount, scoreCount };
}

/** Resolves pre-statuses under a tournament, re-cascading every rejected match and game. */
export async function resolveTournamentVerification(
  db: MutationClient,
  tournamentId: number,
  options?: TournamentResolveOptions
): Promise<VerificationResolveResult> {
  const updatedAt = resolveTimestamp(options?.updatedAt);

  const matchCount = await resolveMatches(
    db,
    tournamentId,
    updatedAt,
    options?.verifiedByUserId
  );

  const matchRows = await db
    .select({
      id: schema.matches.id,
      verificationStatus: schema.matches.verificationStatus,
    })
    .from(schema.matches)
    .where(eq(schema.matches.tournamentId, tournamentId));

  const rejectedMatchIds = matchRows
    .filter((row) => row.verificationStatus === VerificationStatus.Rejected)
    .map((row) => row.id);
  const openMatchIds = matchRows
    .filter((row) => row.verificationStatus !== VerificationStatus.Rejected)
    .map((row) => row.id);

  if (rejectedMatchIds.length > 0) {
    await cascadeMatchRejection(db, rejectedMatchIds, { updatedAt });
  }

  const { gameCount, scoreCount } = await resolveUnderMatches(
    db,
    openMatchIds,
    updatedAt
  );

  return { matchCount, gameCount, scoreCount };
}

/** Resolves pre-statuses under a match, re-cascading every rejected game. */
export async function resolveMatchVerification(
  db: MutationClient,
  matchId: number,
  options?: ResolveOptions
): Promise<VerificationResolveResult> {
  const updatedAt = resolveTimestamp(options?.updatedAt);
  const { gameCount, scoreCount } = await resolveUnderMatches(
    db,
    [matchId],
    updatedAt
  );

  return { matchCount: 0, gameCount, scoreCount };
}

/** Resolves pre-statuses under a game. */
export async function resolveGameVerification(
  db: MutationClient,
  gameId: number,
  options?: ResolveOptions
): Promise<VerificationResolveResult> {
  const updatedAt = resolveTimestamp(options?.updatedAt);
  const scoreCount = await resolveScores(db, [gameId], updatedAt);

  return { matchCount: 0, gameCount: 0, scoreCount };
}
