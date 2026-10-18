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
 * The ruleset a player has played the most verified tournaments in, then the
 * most verified matches, then the one with their most recent verified
 * tournament, then the lowest ruleset number. Null for a player with no
 * verified tournaments. `playerId` is the caller's players id column, and the
 * result works as a selected field or in a join condition. It ignores the
 * player's settings; `defaultRulesetSql` applies them and falls back to osu!.
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
export function mostPlayedRulesetSql(playerId: AnyColumn): SQL<Ruleset | null> {
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

  return sql<Ruleset | null>`${mostPlayed}`.mapWith((value): Ruleset | null =>
    Number(value)
  );
}

/**
 * A player's default ruleset: the profile ruleset they chose in their
 * settings, else `mostPlayedRulesetSql`, else osu!. Takes the caller's players
 * id column and works wherever `mostPlayedRulesetSql` does.
 *
 * The settings subquery follows the same rules as the one in
 * `mostPlayedRulesetSql`: its join keeps Drizzle from dropping its table
 * names, and its aliases keep its tables from taking the caller's names.
 * Admin notes, for one, select from an unaliased `"users"` joined to
 * `"players"`. A caller there that passed `users.player_id` would, without
 * the alias, compare the subquery's own users row with itself and pick up
 * any user's setting.
 */
export function defaultRulesetSql(playerId: AnyColumn): SQL<Ruleset> {
  const user = alias(schema.users, 'default_ruleset_user');
  const settings = alias(schema.userSettings, 'default_ruleset_settings');

  const chosen = new QueryBuilder()
    .select({ ruleset: settings.profileRuleset })
    .from(settings)
    .innerJoin(user, eq(user.id, settings.userId))
    .where(eq(user.playerId, playerId))
    .limit(1);

  return sql<Ruleset>`coalesce(${chosen}, ${mostPlayedRulesetSql(playerId)}, ${Ruleset.Osu})`.mapWith(
    Number
  );
}
