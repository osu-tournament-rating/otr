import { sql } from 'drizzle-orm';

import * as schema from '../../db/schema';
import { VerificationStatus } from '../../osu/enums';
import {
  PlatformStatKey,
  queryRows,
  type AllRulesetsPlatformStat,
} from '../types';

/** Totals over every ruleset, for the stats page's overview. */
export interface HeadlineTotals {
  /** Verified tournaments. */
  tournaments: number;
  /** Verified matches of verified tournaments. */
  matches: number;
  /** Verified games of those matches. */
  games: number;
  /** Verified scores of those games. */
  scores: number;
  /** Players with a rating in at least one ruleset. */
  ratedPlayers: number;
}

const VERIFIED = VerificationStatus.Verified;

/**
 * Each level is counted only under verified parents, because every level
 * has its own status. The score count reads every verified score, about a
 * second on production's data, which is why it is stored.
 */
export const headlineTotals: AllRulesetsPlatformStat<HeadlineTotals> = {
  key: PlatformStatKey.HeadlineTotals,
  version: 1,
  scope: 'all',
  compute: async (db) => {
    const rows = await queryRows<Record<keyof HeadlineTotals, string>>(
      db,
      sql`
        select
          (
            select count(*) from ${schema.tournaments}
            where ${schema.tournaments.verificationStatus} = ${VERIFIED}
          ) as tournaments,
          (
            select count(*) from ${schema.matches}
            inner join ${schema.tournaments}
              on ${schema.tournaments.id} = ${schema.matches.tournamentId}
            where ${schema.matches.verificationStatus} = ${VERIFIED}
              and ${schema.tournaments.verificationStatus} = ${VERIFIED}
          ) as matches,
          (
            select count(*) from ${schema.games}
            inner join ${schema.matches}
              on ${schema.matches.id} = ${schema.games.matchId}
            inner join ${schema.tournaments}
              on ${schema.tournaments.id} = ${schema.matches.tournamentId}
            where ${schema.games.verificationStatus} = ${VERIFIED}
              and ${schema.matches.verificationStatus} = ${VERIFIED}
              and ${schema.tournaments.verificationStatus} = ${VERIFIED}
          ) as games,
          (
            select count(*) from ${schema.gameScores}
            inner join ${schema.games}
              on ${schema.games.id} = ${schema.gameScores.gameId}
            inner join ${schema.matches}
              on ${schema.matches.id} = ${schema.games.matchId}
            inner join ${schema.tournaments}
              on ${schema.tournaments.id} = ${schema.matches.tournamentId}
            where ${schema.gameScores.verificationStatus} = ${VERIFIED}
              and ${schema.games.verificationStatus} = ${VERIFIED}
              and ${schema.matches.verificationStatus} = ${VERIFIED}
              and ${schema.tournaments.verificationStatus} = ${VERIFIED}
          ) as scores,
          (
            select count(distinct ${schema.playerRatings.playerId})
            from ${schema.playerRatings}
          ) as "ratedPlayers"`
    );

    const row = rows[0];
    return {
      tournaments: Number(row?.tournaments ?? 0),
      matches: Number(row?.matches ?? 0),
      games: Number(row?.games ?? 0),
      scores: Number(row?.scores ?? 0),
      ratedPlayers: Number(row?.ratedPlayers ?? 0),
    };
  },
};
