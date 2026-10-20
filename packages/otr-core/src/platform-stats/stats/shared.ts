/**
 * SQL and row helpers shared by the stored statistics of matches and
 * tournaments. Every query reads only verified data under verified parents,
 * in the rated rulesets.
 */
import { sql, type SQL } from 'drizzle-orm';

import {
  RatingAdjustmentType,
  type Team,
  VerificationStatus,
} from '../../osu/enums';
import { RECENT_MONTHS } from '../constants';
import { PLATFORM_STATS_RULESETS, type PlatformStatsRuleset } from '../types';

export const VERIFIED = VerificationStatus.Verified;
export const MATCH_ADJUSTMENT = RatingAdjustmentType.Match;

/**
 * The start of "the last 12 months": that long before the newest verified
 * tournament ended. It follows the data rather than the clock, so a copy of
 * the database reads as production did when the copy was made.
 */
export const recentWindowStart = sql`(
  select max(end_time) - make_interval(months => ${RECENT_MONTHS})
  from tournaments
  where verification_status = ${VERIFIED}
)`;

/** The rated rulesets as an SQL list, for `ruleset in (…)`. */
export const ratedRulesets = sql.join(
  PLATFORM_STATS_RULESETS.map((ruleset) => sql`${ruleset}`),
  sql`, `
);

/**
 * A CTE body: verified matches of verified tournaments in a rated ruleset,
 * with their tournament. With `since`, only matches that started then or
 * later.
 */
export const verifiedMatches = (since?: SQL) => sql`
  select
    m.id as match_id,
    m.name as match_name,
    m.start_time,
    t.id as tournament_id,
    t.name as tournament_name,
    t.ruleset
  from matches m
  inner join tournaments t on t.id = m.tournament_id
  where m.verification_status = ${VERIFIED}
    and t.verification_status = ${VERIFIED}
    and t.ruleset in (${ratedRulesets})
    ${since ? sql`and m.start_time >= ${since}` : sql``}`;

/**
 * A CTE body over a `verified_matches` CTE: each match one side won, with
 * the winner's team and both sides' map scores. Level matches are left out.
 */
export const decidedMatches = sql`
  select
    vm.*,
    w.team as winner_team,
    w.score as winner_score,
    l.score as loser_score
  from verified_matches vm
  inner join match_rosters w on w.match_id = vm.match_id
  inner join match_rosters l on l.match_id = vm.match_id and l.team <> w.team
  where w.score > l.score`;

/**
 * A CTE body over a `verified_matches` CTE: each side's rating going into
 * the match, the average of its players' `rating_before`, and whether every
 * player has one. With `minEarlierMatches`, also whether every player had
 * at least that many rated matches in the ruleset before this one.
 */
export const sideRatings = ({
  minEarlierMatches,
}: { minEarlierMatches?: number } = {}) => sql`
  select
    mr.match_id,
    mr.team,
    avg(ra.rating_before) as rating,
    count(ra.id) = count(*) as rated
    ${
      minEarlierMatches === undefined
        ? sql``
        : sql`, coalesce(bool_and(earlier.matches >= ${minEarlierMatches}), false) as experienced`
    }
  from verified_matches vm
  inner join match_rosters mr on mr.match_id = vm.match_id
  cross join unnest(mr.roster) as p(player_id)
  left join rating_adjustments ra
    on ra.match_id = mr.match_id
    and ra.player_id = p.player_id
    and ra.adjustment_type = ${MATCH_ADJUSTMENT}
  ${
    minEarlierMatches === undefined
      ? sql``
      : // Counting stops at the threshold, so a veteran costs no more than a
        // newcomer.
        sql`left join lateral (
          select count(*) as matches
          from (
            select 1
            from rating_adjustments e
            where e.player_id = ra.player_id
              and e.ruleset = ra.ruleset
              and e.adjustment_type = ${MATCH_ADJUSTMENT}
              and e.timestamp < ra.timestamp
            limit ${minEarlierMatches}
          ) counted
        ) earlier on true`
  }
  group by mr.match_id, mr.team`;

/** A UTC timestamp as an ISO 8601 string, in SQL, so no driver parses it. */
export const isoTimestamp = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** A match a statistic lists, with its result. */
export interface MatchRecord {
  matchId: number;
  /** As stored, such as `OWC: (Japan) vs (Korea)`; some are blank. */
  matchName: string;
  tournamentId: number;
  tournamentName: string;
  /**
   * The winning side. In a match named `(A) vs (B)`, red is A and blue is
   * B.
   */
  winnerTeam: Team;
  /** Maps each side won. */
  winnerScore: number;
  loserScore: number;
}

/** The columns of a decided match that make a MatchRecord. */
export interface MatchRecordRow {
  ruleset: number;
  match_id: number;
  match_name: string;
  tournament_id: number;
  tournament_name: string;
  winner_team: number;
  winner_score: number;
  loser_score: number;
}

export const toMatchRecord = (row: MatchRecordRow): MatchRecord => ({
  matchId: row.match_id,
  matchName: row.match_name,
  tournamentId: row.tournament_id,
  tournamentName: row.tournament_name,
  winnerTeam: row.winner_team as Team,
  winnerScore: row.winner_score,
  loserScore: row.loser_score,
});

/**
 * One value per rated ruleset, built from that ruleset's rows; rows of
 * other rulesets are ignored.
 */
export const perRuleset = <TRow extends { ruleset: number }, T>(
  rows: readonly TRow[],
  build: (rows: TRow[]) => T
): Record<PlatformStatsRuleset, T> =>
  Object.fromEntries(
    PLATFORM_STATS_RULESETS.map((ruleset) => [
      ruleset,
      build(rows.filter((row) => row.ruleset === ruleset)),
    ])
  ) as Record<PlatformStatsRuleset, T>;
