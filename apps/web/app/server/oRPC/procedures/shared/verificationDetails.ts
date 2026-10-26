import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';

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
