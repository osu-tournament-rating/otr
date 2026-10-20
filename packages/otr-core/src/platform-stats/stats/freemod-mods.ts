import { sql } from 'drizzle-orm';

import {
  PlatformStatKey,
  queryRows,
  type PerRulesetPlatformStat,
} from '../types';
import {
  isFreemodGame,
  perRuleset,
  ratedRulesets,
  tournamentYear,
  VERIFIED,
  verifiedTournamentsByYear,
} from './shared';

export interface FreemodModsYear {
  year: number;
  /** Every verified tournament of the year in the ruleset. */
  tournaments: number;
  /** Verified freemod games that year. */
  games: number;
  /** Verified scores in those games. */
  scores: number;
  /** Those scores per combination of mods, as osu! stored them. */
  mods: { mods: number; scores: number }[];
}

/** The mods players picked on freemod maps, per year, oldest first. */
export interface FreemodMods {
  years: FreemodModsYear[];
}

/**
 * The mods of verified scores in verified freemod games, per tournament
 * year. osu! records no freemod flag on stable games, so a game counts as
 * freemod by the site's rule (`isFreemodGame`), and one where no player
 * picked a mod besides No Fail reads as a nomod game.
 */
export const freemodMods: PerRulesetPlatformStat<FreemodMods> = {
  key: PlatformStatKey.FreemodMods,
  version: 1,
  scope: 'ruleset',
  compute: async (db) => {
    const rows = await queryRows<{
      ruleset: number;
      year: number;
      tournaments: string;
      games: string | null;
      mods: number | null;
      scores: string | null;
    }>(
      db,
      sql`
        with freemod_games as materialized (
          select g.id as game_id, t.ruleset, ${tournamentYear(sql`t`)} as year
          from games g
          inner join matches m on m.id = g.match_id
          inner join tournaments t on t.id = m.tournament_id
          where g.verification_status = ${VERIFIED}
            and m.verification_status = ${VERIFIED}
            and t.verification_status = ${VERIFIED}
            and t.ruleset in (${ratedRulesets})
            and ${isFreemodGame(sql`g`)}
        ),
        game_years as (
          select ruleset, year, count(*) as games
          from freemod_games
          group by ruleset, year
        ),
        mod_years as (
          select fg.ruleset, fg.year, s.mods, count(*) as scores
          from freemod_games fg
          inner join game_scores s
            on s.game_id = fg.game_id and s.verification_status = ${VERIFIED}
          group by fg.ruleset, fg.year, s.mods
        ),
        years as (${verifiedTournamentsByYear})
        select
          years.ruleset,
          years.year,
          years.tournaments,
          game_years.games,
          mod_years.mods,
          mod_years.scores
        from years
        left join game_years
          on game_years.ruleset = years.ruleset and game_years.year = years.year
        left join mod_years
          on mod_years.ruleset = years.ruleset and mod_years.year = years.year
        order by years.ruleset, years.year, mod_years.scores desc, mod_years.mods`
    );

    return perRuleset(rows, (rulesetRows) => {
      const years = new Map<number, FreemodModsYear>();

      for (const row of rulesetRows) {
        const year = Number(row.year);
        const entry = years.get(year) ?? {
          year,
          tournaments: Number(row.tournaments),
          games: Number(row.games ?? 0),
          scores: 0,
          mods: [],
        };
        years.set(year, entry);
        if (row.mods === null || row.scores === null) continue;

        const scores = Number(row.scores);
        entry.scores += scores;
        entry.mods.push({ mods: Number(row.mods), scores });
      }

      return { years: [...years.values()] };
    });
  },
};
