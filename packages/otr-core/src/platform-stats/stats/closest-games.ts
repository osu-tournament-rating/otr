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

export interface ClosestGameBeatmap {
  osuId: number;
  diffName: string;
  /** Null when neither the beatmap nor its set records one. */
  artist: string | null;
  title: string | null;
}

export interface ClosestGame extends MatchRecord {
  /** Points the winners won the tiebreaker by. */
  margin: number;
  /** The tiebreaker's beatmap; null when the game has none. */
  beatmap: ClosestGameBeatmap | null;
}

/** Tiebreakers of the last 12 months won by the fewest points. */
export interface ClosestGames {
  /** Every tiebreaker that counts, beyond the ones listed. */
  total: number;
  /** The smallest margins first. */
  games: ClosestGame[];
}

/**
 * A tiebreaker is the last verified game of a match won by one map, when
 * the match's winners won it; one the losers won means the games and the
 * match score disagree, and it is left out. So are level games.
 */
export const closestGames: PerRulesetPlatformStat<ClosestGames> = {
  key: PlatformStatKey.ClosestGames,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<
      MatchRecordRow & {
        margin: number;
        beatmap_osu_id: string | number | null;
        diff_name: string | null;
        artist: string | null;
        title: string | null;
        total: string;
      }
    >(
      db,
      sql`
        with verified_matches as materialized (
          ${verifiedMatches(recentWindowStart)}
        ),
        decided as (${decidedMatches}),
        won_by_one as materialized (
          select * from decided where winner_score = loser_score + 1
        ),
        last_games as (
          select distinct on (g.match_id)
            g.match_id, g.id as game_id, g.beatmap_id
          from games g
          inner join won_by_one d on d.match_id = g.match_id
          where g.verification_status = ${VERIFIED}
          order by g.match_id, g.start_time desc, g.id desc
        ),
        tiebreakers as (
          select d.*, lg.beatmap_id, w.score - l.score as margin
          from won_by_one d
          inner join last_games lg on lg.match_id = d.match_id
          inner join game_rosters w
            on w.game_id = lg.game_id and w.team = d.winner_team
          inner join game_rosters l
            on l.game_id = lg.game_id and l.team <> d.winner_team
        ),
        ranked as (
          select
            tiebreakers.*,
            row_number() over (
              partition by ruleset
              order by margin, start_time desc, match_id desc
            ) as rank,
            count(*) over (partition by ruleset) as total
          from tiebreakers
          where margin > 0
        )
        select
          ranked.*,
          b.osu_id as beatmap_osu_id,
          b.diff_name,
          coalesce(nullif(b.artist_override, ''), s.artist) as artist,
          coalesce(nullif(b.title_override, ''), s.title) as title
        from ranked
        left join beatmaps b on b.id = ranked.beatmap_id
        left join beatmapsets s on s.id = b.beatmapset_id
        where rank <= ${MATCH_RECORD_LIMIT}
        order by ruleset, rank`
    );

    return perRuleset(rows, (rulesetRows) => ({
      total: Number(rulesetRows[0]?.total ?? 0),
      games: rulesetRows.map((row) => ({
        ...toMatchRecord(row),
        margin: Number(row.margin),
        beatmap:
          row.beatmap_osu_id === null || row.diff_name === null
            ? null
            : {
                osuId: Number(row.beatmap_osu_id),
                diffName: row.diff_name,
                artist: row.artist,
                title: row.title,
              },
      })),
    }));
  },
};
