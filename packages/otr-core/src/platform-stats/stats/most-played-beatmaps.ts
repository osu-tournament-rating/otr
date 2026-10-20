import { sql } from 'drizzle-orm';

import {
  MOST_PLAYED_BEATMAPS_LIMIT,
  MOST_PLAYED_MIN_TOURNAMENTS,
} from '../constants';
import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import { perRuleset, recentGames } from './shared';

export interface MostPlayedBeatmap {
  osuId: number;
  diffName: string;
  /** Null when neither the beatmap nor its set records one. */
  artist: string | null;
  title: string | null;
  /** osu!'s star rating without mods; 0 when osu! has none. */
  starRating: number;
  /** Verified tournaments that played it in the last 12 months. */
  tournaments: number;
  /** Verified games on it in those months. */
  games: number;
}

/** The beatmaps the most tournaments played in the last 12 months. */
export interface MostPlayedBeatmaps {
  /** Every beatmap played in a verified game in those months. */
  total: number;
  /**
   * Most tournaments first, then most games. Only beatmaps played in
   * `MOST_PLAYED_MIN_TOURNAMENTS` or more tournaments.
   */
  beatmaps: MostPlayedBeatmap[];
}

/**
 * Beatmaps of verified games in the last 12 months, by how many verified
 * tournaments played them.
 */
export const mostPlayedBeatmaps: PerRulesetPlatformStat<MostPlayedBeatmaps> = {
  key: PlatformStatKey.MostPlayedBeatmaps,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      osu_id: string | number;
      diff_name: string;
      artist: string | null;
      title: string | null;
      sr: number;
      tournaments: string;
      games: string;
      total: string;
    }>(
      db,
      sql`
          with recent_games as materialized (${recentGames}),
          beatmap_counts as (
            select
              ruleset,
              beatmap_id,
              count(distinct tournament_id) as tournaments,
              count(*) as games
            from recent_games
            group by ruleset, beatmap_id
          ),
          ranked as (
            select
              beatmap_counts.*,
              row_number() over (
                partition by ruleset
                order by tournaments desc, games desc, beatmap_id
              ) as rank,
              count(*) over (partition by ruleset) as total
            from beatmap_counts
          )
          select
            ranked.ruleset,
            ranked.tournaments,
            ranked.games,
            ranked.total,
            b.osu_id,
            b.diff_name,
            b.sr,
            coalesce(nullif(b.artist_override, ''), s.artist) as artist,
            coalesce(nullif(b.title_override, ''), s.title) as title
          from ranked
          inner join beatmaps b on b.id = ranked.beatmap_id
          left join beatmapsets s on s.id = b.beatmapset_id
          where ranked.rank <= ${MOST_PLAYED_BEATMAPS_LIMIT}
          order by ranked.ruleset, ranked.rank`
    );

    // The minimum applies after ranking, so a ruleset with no beatmap
    // over it still reports how many it played.
    return perRuleset(rows, (rulesetRows) => ({
      total: Number(rulesetRows[0]?.total ?? 0),
      beatmaps: rulesetRows
        .filter((row) => Number(row.tournaments) >= MOST_PLAYED_MIN_TOURNAMENTS)
        .map((row) => ({
          osuId: Number(row.osu_id),
          diffName: row.diff_name,
          artist: row.artist,
          title: row.title,
          starRating: Number(row.sr),
          tournaments: Number(row.tournaments),
          games: Number(row.games),
        })),
    }));
  },
};
