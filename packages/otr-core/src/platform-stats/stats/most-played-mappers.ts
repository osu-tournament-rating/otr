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

export interface MostPlayedMapper {
  playerId: number;
  osuId: number;
  username: string;
  /** Verified tournaments that played one of their beatmaps. */
  tournaments: number;
  /** Their beatmaps those tournaments played. */
  beatmaps: number;
}

/** The mappers whose beatmaps the most tournaments played lately. */
export interface MostPlayedMappers {
  /** Every mapper credited on a beatmap of a verified game in the window. */
  total: number;
  /**
   * Most tournaments first, then most beatmaps. Only mappers played in
   * `MOST_PLAYED_MIN_TOURNAMENTS` or more tournaments.
   */
  mappers: MostPlayedMapper[];
}

/**
 * Mappers credited on beatmaps of verified games in the last 12 months, by
 * how many verified tournaments played their beatmaps. A guest difficulty
 * counts for its own mapper, as osu! credits it.
 */
export const mostPlayedMappers: PerRulesetPlatformStat<MostPlayedMappers> = {
  key: PlatformStatKey.MostPlayedMappers,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      player_id: number;
      osu_id: string | number;
      username: string;
      tournaments: string;
      beatmaps: string;
      total: string;
    }>(
      db,
      sql`
        with recent_games as materialized (${recentGames}),
        mapper_counts as (
          select
            rg.ruleset,
            c.creators_id as player_id,
            count(distinct rg.tournament_id) as tournaments,
            count(distinct rg.beatmap_id) as beatmaps
          from recent_games rg
          inner join join_beatmap_creators c
            on c.created_beatmaps_id = rg.beatmap_id
          group by rg.ruleset, c.creators_id
        ),
        ranked as (
          select
            mapper_counts.*,
            row_number() over (
              partition by ruleset
              order by tournaments desc, beatmaps desc, player_id
            ) as rank,
            count(*) over (partition by ruleset) as total
          from mapper_counts
        )
        select
          ranked.ruleset,
          ranked.player_id,
          p.osu_id,
          p.username,
          ranked.tournaments,
          ranked.beatmaps,
          ranked.total
        from ranked
        inner join players p on p.id = ranked.player_id
        where ranked.rank <= ${MOST_PLAYED_CREATORS_LIMIT}
        order by ranked.ruleset, ranked.rank`
    );

    return perRuleset(rows, (rulesetRows) => ({
      total: Number(rulesetRows[0]?.total ?? 0),
      mappers: rulesetRows
        .filter((row) => Number(row.tournaments) >= MOST_PLAYED_MIN_TOURNAMENTS)
        .map((row) => ({
          playerId: row.player_id,
          osuId: Number(row.osu_id),
          username: row.username,
          tournaments: Number(row.tournaments),
          beatmaps: Number(row.beatmaps),
        })),
    }));
  },
};
