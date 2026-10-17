import {
  and,
  asc,
  count,
  desc,
  eq,
  sql,
  sum,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

/**
 * A player's default ruleset: the one they have played the most verified
 * tournaments in, then the most verified matches, then the one with their most
 * recent verified tournament, then the lowest ruleset number. A player with no
 * verified tournaments gets osu!. `playerId` is the caller's players id
 * column, and the result works as a selected field or in a join condition.
 *
 * player_tournament_stats only gets rows for verified tournaments, but a
 * tournament rejected since the last weekly run keeps its rows until then, so
 * the subquery checks the status itself.
 *
 * The subquery is a query builder, not a raw `sql` template, because of how
 * Drizzle writes a select that reads one table with no joins: it drops the
 * table name from every column at the top level of each selected expression.
 * A raw template's columns sit at that level, so `${stats.playerId} =
 * ${playerId}` would render as `"player_id" = "id"`, and Postgres resolves
 * both names inside the subquery without ever reaching the caller's player.
 * The query then fails on an ambiguous name or, when only one subquery table
 * has the column, quietly compares that table with itself. Drizzle writes a
 * nested query builder on its own, with its table names intact. The same rule
 * applies to the subquery's own select list, which keeps its table names only
 * because the subquery has a join.
 *
 * The aliases keep the subquery's tables from taking the names of tables in
 * the caller's query. Inside the subquery, an unaliased
 * `"player_tournament_stats"` or `"tournaments"` would mean the subquery's own
 * copy, so a column the caller passed from either table would bind to that
 * copy instead of the caller's row.
 */
export function defaultRulesetSql(playerId: AnyColumn): SQL<Ruleset> {
  const stats = alias(schema.playerTournamentStats, 'default_ruleset_stats');
  const tournament = alias(schema.tournaments, 'default_ruleset_tournament');

  const mostPlayed = new QueryBuilder()
    .select({ ruleset: tournament.ruleset })
    .from(stats)
    .innerJoin(tournament, eq(tournament.id, stats.tournamentId))
    .where(
      and(
        eq(stats.playerId, playerId),
        eq(tournament.verificationStatus, VerificationStatus.Verified)
      )
    )
    .groupBy(tournament.ruleset)
    .orderBy(
      desc(count()),
      desc(sum(stats.matchesPlayed)),
      sql`max(coalesce(${tournament.endTime}, ${tournament.startTime})) desc nulls last`,
      asc(tournament.ruleset)
    )
    .limit(1);

  return sql<Ruleset>`coalesce(${mostPlayed}, ${Ruleset.Osu})`.mapWith(Number);
}
