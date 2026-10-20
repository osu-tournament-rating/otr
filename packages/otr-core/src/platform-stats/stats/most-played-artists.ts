import { sql } from 'drizzle-orm';

import {
  MOST_PLAYED_CREATORS_LIMIT,
  MOST_PLAYED_MIN_TOURNAMENTS,
} from '../constants';
import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import { perRuleset, recentGames } from './shared';

export interface MostPlayedArtist {
  /** As the beatmap or its set records it. */
  artist: string;
  /** Verified tournaments that played one of their songs. */
  tournaments: number;
  /** Beatmaps of their songs those tournaments played. */
  beatmaps: number;
}

/** The artists whose songs the most tournaments played lately. */
export interface MostPlayedArtists {
  /** Every artist of a beatmap of a verified game in the window. */
  total: number;
  /**
   * Most tournaments first, then most beatmaps. Only artists played in
   * `MOST_PLAYED_MIN_TOURNAMENTS` or more tournaments.
   */
  artists: MostPlayedArtist[];
}

/**
 * Artists of beatmaps of verified games in the last 12 months, by how many
 * verified tournaments played their songs. An artist is the text osu!
 * records, so one written two ways counts as two.
 */
export const mostPlayedArtists: PerRulesetPlatformStat<MostPlayedArtists> = {
  key: PlatformStatKey.MostPlayedArtists,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      artist: string;
      tournaments: string;
      beatmaps: string;
      total: string;
    }>(
      db,
      sql`
        with recent_games as materialized (${recentGames}),
        credited as (
          select
            rg.ruleset,
            rg.tournament_id,
            rg.beatmap_id,
            coalesce(nullif(b.artist_override, ''), s.artist) as artist
          from recent_games rg
          inner join beatmaps b on b.id = rg.beatmap_id
          left join beatmapsets s on s.id = b.beatmapset_id
        ),
        artist_counts as (
          select
            ruleset,
            artist,
            count(distinct tournament_id) as tournaments,
            count(distinct beatmap_id) as beatmaps
          from credited
          where artist <> ''
          group by ruleset, artist
        ),
        ranked as (
          select
            artist_counts.*,
            row_number() over (
              partition by ruleset
              order by tournaments desc, beatmaps desc, artist
            ) as rank,
            count(*) over (partition by ruleset) as total
          from artist_counts
        )
        select ruleset, artist, tournaments, beatmaps, total
        from ranked
        where rank <= ${MOST_PLAYED_CREATORS_LIMIT}
        order by ruleset, rank`
    );

    return perRuleset(rows, (rulesetRows) => ({
      total: Number(rulesetRows[0]?.total ?? 0),
      artists: rulesetRows
        .filter((row) => Number(row.tournaments) >= MOST_PLAYED_MIN_TOURNAMENTS)
        .map((row) => ({
          artist: row.artist,
          tournaments: Number(row.tournaments),
          beatmaps: Number(row.beatmaps),
        })),
    }));
  },
};
