import { sql } from 'drizzle-orm';

import { RATING_GAP_BUCKET_SIZE, RATING_GAP_BUCKETS } from '../constants';
import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import {
  decidedMatches,
  perRuleset,
  sideRatings,
  verifiedMatches,
} from './shared';

export interface RatingGapBucket {
  /** The smallest gap in the bucket, a multiple of the bucket size. */
  minGap: number;
  /** Matches with a winner whose sides were this far apart. */
  matches: number;
  /** Of those, the ones the higher-rated side won. */
  higherRatedWins: number;
}

/**
 * How often the higher-rated side wins a match, by the rating gap between
 * the sides, over every verified match with a winner.
 */
export interface HigherRatedWins {
  /** Every bucket, the smallest gaps first. */
  buckets: RatingGapBucket[];
  /** The median gap between the sides; null without a match. */
  medianGap: number | null;
}

/**
 * A side's rating is its players' average rating going into the match, so
 * a match counts only when every player on both sides has one. Matches
 * whose sides are level, by maps or by rating, have no higher-rated winner
 * and are left out.
 */
export const higherRatedWins: PerRulesetPlatformStat<HigherRatedWins> = {
  key: PlatformStatKey.HigherRatedWins,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      bucket: number;
      matches: string;
      higher_rated_wins: string;
      median_gap: number | null;
    }>(
      db,
      sql`
        with verified_matches as materialized (${verifiedMatches()}),
        decided as (${decidedMatches}),
        sides as (${sideRatings()}),
        gaps as (
          -- Positive when the higher-rated side won.
          select d.ruleset, w.rating - l.rating as gap
          from decided d
          inner join sides w
            on w.match_id = d.match_id and w.team = d.winner_team
          inner join sides l
            on l.match_id = d.match_id and l.team <> d.winner_team
          where w.rated and l.rated
            -- Averages of the same ratings can differ in the last bit.
            and abs(w.rating - l.rating) > 1e-6
        ),
        medians as (
          select
            ruleset,
            percentile_cont(0.5) within group (order by abs(gap)) as median_gap
          from gaps
          group by ruleset
        )
        select
          gaps.ruleset,
          least(
            floor(abs(gap) / ${RATING_GAP_BUCKET_SIZE}),
            ${RATING_GAP_BUCKETS - 1}
          )::int as bucket,
          count(*) as matches,
          count(*) filter (where gap > 0) as higher_rated_wins,
          medians.median_gap
        from gaps
        inner join medians on medians.ruleset = gaps.ruleset
        group by 1, 2, medians.median_gap`
    );

    return perRuleset(rows, (rulesetRows) => ({
      buckets: Array.from({ length: RATING_GAP_BUCKETS }, (_, bucket) => {
        const row = rulesetRows.find((item) => item.bucket === bucket);
        return {
          minGap: bucket * RATING_GAP_BUCKET_SIZE,
          matches: Number(row?.matches ?? 0),
          higherRatedWins: Number(row?.higher_rated_wins ?? 0),
        };
      }),
      medianGap:
        rulesetRows[0]?.median_gap === undefined ||
        rulesetRows[0].median_gap === null
          ? null
          : Number(rulesetRows[0].median_gap),
    }));
  },
};
