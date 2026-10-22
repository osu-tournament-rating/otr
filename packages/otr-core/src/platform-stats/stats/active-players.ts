import { sql } from 'drizzle-orm';

import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import { perRuleset, ratedRulesets, VERIFIED } from './shared';

export interface ActivePlayersYear {
  /** The UTC year matches started in. */
  year: number;
  /** Verified tournaments with a verified match that year. */
  tournaments: number;
  /** Players on a roster of a verified match that year. */
  players: number;
  /** Of those, the players whose first verified match in the ruleset it was. */
  newPlayers: number;
  /** Of the new players, those who played a verified match the next year. */
  newPlayersReturned: number;
}

/** Players of each year's verified matches, oldest year first. */
export interface ActivePlayers {
  years: ActivePlayersYear[];
}

/**
 * Who played verified matches each year, from the match rosters, and how
 * many were new to the ruleset. A player is new in the year of their first
 * verified match in it, so the first years of the data count nearly
 * everyone as new.
 */
export const activePlayers: PerRulesetPlatformStat<ActivePlayers> = {
  key: PlatformStatKey.ActivePlayers,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      year: number;
      tournaments: string;
      players: string;
      new_players: string;
      new_players_returned: string;
    }>(
      db,
      sql`
        with verified_matches as materialized (
          select
            m.id as match_id,
            t.id as tournament_id,
            t.ruleset,
            extract(year from m.start_time at time zone 'UTC')::int as year
          from matches m
          inner join tournaments t on t.id = m.tournament_id
          where m.verification_status = ${VERIFIED}
            and t.verification_status = ${VERIFIED}
            and t.ruleset in (${ratedRulesets})
            and m.start_time is not null
        ),
        played as materialized (
          select distinct vm.ruleset, vm.year, p.player_id
          from verified_matches vm
          inner join match_rosters mr on mr.match_id = vm.match_id
          cross join unnest(mr.roster) as p(player_id)
        ),
        debuts as (
          select ruleset, player_id, min(year) as year
          from played
          group by ruleset, player_id
        ),
        debut_years as (
          select
            d.ruleset,
            d.year,
            count(*) as new_players,
            count(next_year.player_id) as new_players_returned
          from debuts d
          left join played next_year
            on next_year.ruleset = d.ruleset
            and next_year.player_id = d.player_id
            and next_year.year = d.year + 1
          group by d.ruleset, d.year
        ),
        active_years as (
          select ruleset, year, count(*) as players
          from played
          group by ruleset, year
        ),
        tournament_years as (
          select ruleset, year, count(distinct tournament_id) as tournaments
          from verified_matches
          group by ruleset, year
        )
        select
          ay.ruleset,
          ay.year,
          ty.tournaments,
          ay.players,
          coalesce(dy.new_players, 0) as new_players,
          coalesce(dy.new_players_returned, 0) as new_players_returned
        from active_years ay
        inner join tournament_years ty
          on ty.ruleset = ay.ruleset and ty.year = ay.year
        left join debut_years dy
          on dy.ruleset = ay.ruleset and dy.year = ay.year
        order by ay.ruleset, ay.year`
    );

    return perRuleset(rows, (rulesetRows) => ({
      years: rulesetRows.map((row) => ({
        year: Number(row.year),
        tournaments: Number(row.tournaments),
        players: Number(row.players),
        newPlayers: Number(row.new_players),
        newPlayersReturned: Number(row.new_players_returned),
      })),
    }));
  },
};
