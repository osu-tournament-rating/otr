import { and, desc, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  alias,
  QueryBuilder,
  type AnyPgColumn,
  type PgTable,
} from 'drizzle-orm/pg-core';

import * as schema from '@otr/core/db/schema';
import { VerificationStatus } from '@otr/core/osu';

/**
 * What a status tooltip says beyond the status itself: who decided it, and
 * whether the weekly rating run has rated it yet. Each helper is a subquery
 * that works as a selected field, so every list that shows a status can say
 * what the detail pages say.
 *
 * The subqueries are query builders over aliased tables, as
 * `mostPlayedRulesetSql` in `defaultRuleset.ts` explains: Drizzle keeps the
 * table names in a nested builder's conditions, and the aliases keep its
 * tables from taking the names of tables in the caller's query.
 */

/** The username of the admin who verified or rejected an item, or null. */
export function reviewerUsernameSql(
  verifiedByUserId: AnyColumn
): SQL<string | null> {
  const user = alias(schema.users, 'reviewer_user');
  const player = alias(schema.players, 'reviewer_player');

  const username = new QueryBuilder()
    .select({ username: player.username })
    .from(user)
    .innerJoin(player, eq(player.id, user.playerId))
    .where(eq(user.id, verifiedByUserId))
    .limit(1);

  return sql<string | null>`${username}`;
}

/** An entity's audit table, as `gameAudits` and `gameScoreAudits` share it. */
type AuditTable = PgTable & {
  id: AnyPgColumn;
  referenceIdLock: AnyPgColumn;
  actionUserId: AnyPgColumn;
  changes: AnyPgColumn;
};

/**
 * The username of the admin who last set a verified or rejected item to its
 * current status, read from its audit log, or null. For games and scores,
 * which keep no verifier of their own. The log names an admin only for
 * changes since auditing began, and has spelled the status key both ways.
 */
function auditedReviewerUsernameSql(
  audits: AuditTable,
  entity: { id: AnyColumn; verificationStatus: AnyColumn }
): SQL<string | null> {
  const user = alias(schema.users, 'audited_reviewer_user');
  const player = alias(schema.players, 'audited_reviewer_player');
  const statusSet = sql`coalesce(${audits.changes} -> 'verification_status' ->> 'newValue', ${audits.changes} -> 'verificationStatus' ->> 'newValue')::int`;

  const username = new QueryBuilder()
    .select({ username: player.username })
    .from(audits)
    .innerJoin(user, eq(user.id, audits.actionUserId))
    .innerJoin(player, eq(player.id, user.playerId))
    .where(
      and(
        eq(audits.referenceIdLock, entity.id),
        sql`${statusSet} = ${entity.verificationStatus}`
      )
    )
    .orderBy(desc(audits.id))
    .limit(1);

  return sql<
    string | null
  >`case when ${entity.verificationStatus} in (${VerificationStatus.Verified}, ${VerificationStatus.Rejected}) then ${username} end`;
}

/** The admin who verified or rejected a game, when its audit log says. */
export function gameReviewerUsernameSql(game: {
  id: AnyColumn;
  verificationStatus: AnyColumn;
}): SQL<string | null> {
  return auditedReviewerUsernameSql(
    alias(schema.gameAudits, 'reviewer_game_audit'),
    game
  );
}

/** The admin who verified or rejected a score, when its audit log says. */
export function scoreReviewerUsernameSql(score: {
  id: AnyColumn;
  verificationStatus: AnyColumn;
}): SQL<string | null> {
  return auditedReviewerUsernameSql(
    alias(schema.gameScoreAudits, 'reviewer_score_audit'),
    score
  );
}

/**
 * True for a verified tournament the weekly rating run has not rated yet.
 * That run writes player stats for every verified tournament, so a verified
 * one with none is waiting for it.
 */
export function tournamentPendingRatingSql(tournament: {
  id: AnyColumn;
  verificationStatus: AnyColumn;
}): SQL<boolean> {
  const stats = alias(schema.playerTournamentStats, 'pending_rating_stats');

  const rated = new QueryBuilder()
    .select({ one: sql`1` })
    .from(stats)
    .where(eq(stats.tournamentId, tournament.id));

  return sql<boolean>`(${tournament.verificationStatus} = ${VerificationStatus.Verified} and not exists ${rated})`.mapWith(
    Boolean
  );
}

/**
 * True for a verified match the weekly rating run has not rated yet. The run
 * rates a match only when its tournament is verified too, and writes player
 * stats for each match it rates.
 */
export function matchPendingRatingSql(match: {
  id: AnyColumn;
  tournamentId: AnyColumn;
  verificationStatus: AnyColumn;
}): SQL<boolean> {
  const stats = alias(schema.playerMatchStats, 'pending_rating_match_stats');
  const tournament = alias(schema.tournaments, 'pending_rating_tournament');

  const tournamentVerified = new QueryBuilder()
    .select({ one: sql`1` })
    .from(tournament)
    .where(
      and(
        eq(tournament.id, match.tournamentId),
        eq(tournament.verificationStatus, VerificationStatus.Verified)
      )
    );

  const rated = new QueryBuilder()
    .select({ one: sql`1` })
    .from(stats)
    .where(eq(stats.matchId, match.id));

  return sql<boolean>`(${match.verificationStatus} = ${VerificationStatus.Verified} and exists ${tournamentVerified} and not exists ${rated})`.mapWith(
    Boolean
  );
}
