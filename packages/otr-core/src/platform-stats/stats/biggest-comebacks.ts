import { sql } from 'drizzle-orm';

import { MATCH_RECORD_LIMIT } from '../constants';
import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import {
  decidedMatches,
  type MatchRecord,
  type MatchRecordRow,
  perRuleset,
  recentWindowStart,
  toMatchRecord,
  VERIFIED,
  verifiedMatches,
} from './shared';

export interface BiggestComeback extends MatchRecord {
  /** The most maps the winners trailed by at any point. */
  deficit: number;
}

/** Matches of the last 12 months won after trailing by the most maps. */
export interface BiggestComebacks {
  /** Every match won after trailing, beyond the ones listed. */
  total: number;
  /** The largest deficits first, then the most recent. */
  matches: BiggestComeback[];
}

/**
 * Replays each match's verified games in the order they started and finds
 * the winners' largest deficit. A match counts only when its games add up
 * to its score, so the deficit and the score tell the same story. A level
 * game scores for neither side.
 */
export const biggestComebacks: PerRulesetPlatformStat<BiggestComebacks> = {
  key: PlatformStatKey.BiggestComebacks,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<
      MatchRecordRow & { deficit: number; total: string }
    >(
      db,
      sql`
        with verified_matches as materialized (
          ${verifiedMatches(recentWindowStart)}
        ),
        decided as materialized (${decidedMatches}),
        game_results as (
          select
            d.match_id,
            g.start_time,
            g.id as game_id,
            sign(w.score - l.score) as result
          from decided d
          inner join games g
            on g.match_id = d.match_id and g.verification_status = ${VERIFIED}
          inner join game_rosters w
            on w.game_id = g.id and w.team = d.winner_team
          inner join game_rosters l
            on l.game_id = g.id and l.team <> d.winner_team
        ),
        running as (
          select
            match_id,
            count(*) filter (where result > 0) over played as won,
            count(*) filter (where result < 0) over played as lost
          from game_results
          window played as (partition by match_id order by start_time, game_id)
        ),
        tallies as (
          select
            match_id,
            max(lost - won) as deficit,
            max(won) as won,
            max(lost) as lost
          from running
          group by match_id
        ),
        comebacks as (
          select d.*, t.deficit
          from decided d
          inner join tallies t on t.match_id = d.match_id
          where t.won = d.winner_score
            and t.lost = d.loser_score
            and t.deficit > 0
        ),
        ranked as (
          select
            comebacks.*,
            row_number() over (
              partition by ruleset
              order by deficit desc, start_time desc, match_id desc
            ) as rank,
            count(*) over (partition by ruleset) as total
          from comebacks
        )
        select *
        from ranked
        where rank <= ${MATCH_RECORD_LIMIT}
        order by ruleset, rank`
    );

    return perRuleset(rows, (rulesetRows) => ({
      total: Number(rulesetRows[0]?.total ?? 0),
      matches: rulesetRows.map((row) => ({
        ...toMatchRecord(row),
        deficit: Number(row.deficit),
      })),
    }));
  },
};
