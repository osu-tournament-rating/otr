import { sql } from 'drizzle-orm';

import { MATCH_RECORD_LIMIT, UPSET_MIN_EARLIER_MATCHES } from '../constants';
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
  sideRatings,
  toMatchRecord,
  verifiedMatches,
} from './shared';

export interface BiggestUpset extends MatchRecord {
  /** The winners' average rating going into the match. */
  winnerRating: number;
  /** The losers' average rating going into the match, the higher one. */
  loserRating: number;
}

/** Matches of the last 12 months the lower-rated side won. */
export interface BiggestUpsets {
  /** Every upset that counts, beyond the ones listed. */
  total: number;
  /** The widest rating gaps first. */
  matches: BiggestUpset[];
}

/**
 * An upset counts when every player on both sides had a rating going into
 * the match and `UPSET_MIN_EARLIER_MATCHES` rated matches before it. A
 * side's rating is its players' average.
 */
export const biggestUpsets: PerRulesetPlatformStat<BiggestUpsets> = {
  key: PlatformStatKey.BiggestUpsets,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<
      MatchRecordRow & {
        winner_rating: number;
        loser_rating: number;
        total: string;
      }
    >(
      db,
      sql`
        with verified_matches as materialized (
          ${verifiedMatches(recentWindowStart)}
        ),
        decided as (${decidedMatches}),
        sides as (
          ${sideRatings({ minEarlierMatches: UPSET_MIN_EARLIER_MATCHES })}
        ),
        upsets as (
          select d.*, w.rating as winner_rating, l.rating as loser_rating
          from decided d
          inner join sides w
            on w.match_id = d.match_id and w.team = d.winner_team
          inner join sides l
            on l.match_id = d.match_id and l.team <> d.winner_team
          where w.rated and l.rated and w.experienced and l.experienced
            -- Averages of the same ratings can differ in the last bit.
            and l.rating - w.rating > 1e-6
        ),
        ranked as (
          select
            upsets.*,
            row_number() over (
              partition by ruleset
              order by loser_rating - winner_rating desc, match_id desc
            ) as rank,
            count(*) over (partition by ruleset) as total
          from upsets
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
        winnerRating: Number(row.winner_rating),
        loserRating: Number(row.loser_rating),
      })),
    }));
  },
};
