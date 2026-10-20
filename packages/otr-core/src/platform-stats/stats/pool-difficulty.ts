import { sql } from 'drizzle-orm';

import { Ruleset } from '../../osu/enums';
import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import {
  NO_FAIL,
  perRuleset,
  ratedRulesets,
  tournamentYear,
  VERIFIED,
  verifiedTournamentsByYear,
} from './shared';

/** One year's nomod beatmaps of one kind of tournament. */
export interface PoolDifficultyPoint {
  /** Beatmaps, each counted once per tournament that played it. */
  maps: number;
  tournaments: number;
  /** Star ratings of those maps. */
  median: number;
  p90: number;
}

export interface PoolDifficultyYear {
  year: number;
  /** Every verified tournament of the year in the ruleset. */
  tournaments: number;
  /** Open rank tournaments; null when none played a nomod beatmap. */
  open: PoolDifficultyPoint | null;
  /** Rank-restricted tournaments; null when none played a nomod beatmap. */
  restricted: PoolDifficultyPoint | null;
}

/** How hard nomod beatmaps were each year, oldest year first. */
export interface PoolDifficulty {
  years: PoolDifficultyYear[];
}

/**
 * Star ratings of the beatmaps verified tournaments played without mods,
 * per year. A game counts as nomod when it and every verified score in it
 * have no mod besides No Fail. Ratings are osu!'s, as stored when the
 * beatmap was fetched, so a star rating rework shows as a step. Maps osu!
 * gives no rating (0) are left out, and so are maps converted from another
 * ruleset, whose rating is the original ruleset's.
 */
export const poolDifficulty: PerRulesetPlatformStat<PoolDifficulty> = {
  key: PlatformStatKey.PoolDifficulty,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      year: number;
      tournaments: string;
      open: boolean | null;
      maps: string | null;
      pool_tournaments: string | null;
      median: number | null;
      p90: number | null;
    }>(
      db,
      sql`
        with nomod_games as materialized (
          select
            t.id as tournament_id,
            t.ruleset,
            t.rank_range_lower_bound <= 1 as open,
            ${tournamentYear(sql`t`)} as year,
            g.beatmap_id
          from games g
          inner join matches m on m.id = g.match_id
          inner join tournaments t on t.id = m.tournament_id
          where g.verification_status = ${VERIFIED}
            and m.verification_status = ${VERIFIED}
            and t.verification_status = ${VERIFIED}
            and t.ruleset in (${ratedRulesets})
            and (g.mods & ~${NO_FAIL}) = 0
            and not exists (
              select 1
              from game_scores s
              where s.game_id = g.id
                and s.verification_status = ${VERIFIED}
                and (s.mods & ~${NO_FAIL}) <> 0
            )
        ),
        pooled as (
          select distinct ng.ruleset, ng.year, ng.open, ng.tournament_id, b.id, b.sr
          from nomod_games ng
          inner join beatmaps b on b.id = ng.beatmap_id
          where b.sr > 0
            and (
              b.ruleset = ng.ruleset
              or (
                ng.ruleset in (${Ruleset.Mania4k}, ${Ruleset.Mania7k})
                and b.ruleset in (${Ruleset.ManiaOther}, ${Ruleset.Mania4k}, ${Ruleset.Mania7k})
              )
            )
        ),
        points as (
          select
            ruleset,
            year,
            open,
            count(*) as maps,
            count(distinct tournament_id) as pool_tournaments,
            percentile_cont(0.5) within group (order by sr) as median,
            percentile_cont(0.9) within group (order by sr) as p90
          from pooled
          group by ruleset, year, open
        ),
        years as (${verifiedTournamentsByYear})
        select
          years.ruleset,
          years.year,
          years.tournaments,
          points.open,
          points.maps,
          points.pool_tournaments,
          points.median,
          points.p90
        from years
        left join points
          on points.ruleset = years.ruleset and points.year = years.year
        order by years.ruleset, years.year, points.open desc`
    );

    return perRuleset(rows, (rulesetRows) => {
      const years = new Map<number, PoolDifficultyYear>();

      for (const row of rulesetRows) {
        const year = Number(row.year);
        const entry = years.get(year) ?? {
          year,
          tournaments: Number(row.tournaments),
          open: null,
          restricted: null,
        };
        years.set(year, entry);
        if (row.open === null) continue;

        entry[row.open ? 'open' : 'restricted'] = {
          maps: Number(row.maps),
          tournaments: Number(row.pool_tournaments),
          median: Number(row.median),
          p90: Number(row.p90),
        };
      }

      return { years: [...years.values()] };
    });
  },
};
