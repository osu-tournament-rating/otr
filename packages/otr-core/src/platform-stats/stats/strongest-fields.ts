import { sql } from 'drizzle-orm';

import { FIELD_SIZE, STRONGEST_FIELDS_LIMIT } from '../constants';
import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import {
  isoTimestamp,
  MATCH_ADJUSTMENT,
  perRuleset,
  ratedRulesets,
  recentWindowStart,
  VERIFIED,
} from './shared';

export interface StrongestField {
  tournamentId: number;
  name: string;
  abbreviation: string;
  lobbySize: number;
  rankRangeLowerBound: number;
  /** ISO 8601, UTC; null when not recorded. */
  startTime: string | null;
  endTime: string | null;
  /** Players with a rating going into one of its verified matches. */
  players: number;
  /** The average rating of its `FIELD_SIZE` highest-rated players. */
  rating: number;
}

/** Tournaments of the last 12 months with the strongest fields. */
export interface StrongestFields {
  /** Every tournament with a full field, beyond the ones listed. */
  total: number;
  /** The highest ratings first. */
  tournaments: StrongestField[];
}

/**
 * Verified tournaments that ended in the last 12 months, by the average
 * rating of their 16 highest-rated players. Each player's rating is the
 * one they went into their first verified match of the tournament with.
 * A tournament with fewer than 16 rated players has no full field and is
 * left out.
 */
export const strongestFields: PerRulesetPlatformStat<StrongestFields> = {
  key: PlatformStatKey.StrongestFields,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      id: number;
      name: string;
      abbreviation: string;
      lobby_size: number;
      rank_range_lower_bound: number;
      start_time: string | null;
      end_time: string | null;
      players: number;
      rating: number;
      total: string;
    }>(
      db,
      sql`
        with recent_tournaments as materialized (
          select
            id, name, abbreviation, ruleset, lobby_size,
            rank_range_lower_bound, start_time, end_time
          from tournaments
          where verification_status = ${VERIFIED}
            and ruleset in (${ratedRulesets})
            and end_time >= ${recentWindowStart}
        ),
        entering as (
          select distinct on (rt.id, ra.player_id)
            rt.id as tournament_id, ra.player_id, ra.rating_before
          from recent_tournaments rt
          inner join matches m
            on m.tournament_id = rt.id and m.verification_status = ${VERIFIED}
          inner join rating_adjustments ra
            on ra.match_id = m.id and ra.adjustment_type = ${MATCH_ADJUSTMENT}
          order by rt.id, ra.player_id, ra.timestamp, ra.id
        ),
        placed as (
          select
            entering.*,
            row_number() over (
              partition by tournament_id order by rating_before desc
            ) as place,
            count(*) over (partition by tournament_id) as players
          from entering
        ),
        fields as (
          select
            tournament_id,
            avg(rating_before) as rating,
            max(players)::int as players
          from placed
          where place <= ${FIELD_SIZE}
          group by tournament_id
          having max(players) >= ${FIELD_SIZE}
        ),
        ranked as (
          select
            rt.*,
            fields.rating,
            fields.players,
            row_number() over (
              partition by rt.ruleset order by fields.rating desc, rt.id desc
            ) as rank,
            count(*) over (partition by rt.ruleset) as total
          from fields
          inner join recent_tournaments rt on rt.id = fields.tournament_id
        )
        select
          ruleset,
          id,
          name,
          abbreviation,
          lobby_size,
          rank_range_lower_bound,
          ${isoTimestamp(sql`start_time`)} as start_time,
          ${isoTimestamp(sql`end_time`)} as end_time,
          players,
          rating,
          total
        from ranked
        where rank <= ${STRONGEST_FIELDS_LIMIT}
        order by ruleset, rank`
    );

    return perRuleset(rows, (rulesetRows) => ({
      total: Number(rulesetRows[0]?.total ?? 0),
      tournaments: rulesetRows.map((row) => ({
        tournamentId: row.id,
        name: row.name,
        abbreviation: row.abbreviation,
        lobbySize: row.lobby_size,
        rankRangeLowerBound: row.rank_range_lower_bound,
        startTime: row.start_time,
        endTime: row.end_time,
        players: Number(row.players),
        rating: Number(row.rating),
      })),
    }));
  },
};
