import { eq, inArray } from 'drizzle-orm';
import { Ruleset, Team, VerificationStatus } from '@otr/core/osu';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';
import * as schema from '@otr/core/db/schema';
import {
  TournamentStatsCalculator,
  type MatchProcessingResult,
  type PlayerMatchStatRecord,
  type StatsCalculationSuccess,
  type StatsMatch,
  type StatsTournament,
} from './index';

/** Skipped: nothing to calculate, which is expected. Failed: the calculation broke. */
export type TournamentStatsOutcome =
  | { status: 'processed' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

interface TournamentStatsServiceOptions {
  db: DatabaseClient;
  logger: Logger;
  calculator: TournamentStatsCalculator;
}

export class TournamentStatsService {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly calculator: TournamentStatsCalculator;

  constructor(options: TournamentStatsServiceOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.calculator = options.calculator;
  }

  async processTournamentStats(
    tournamentId: number
  ): Promise<TournamentStatsOutcome> {
    const tournament = await this.loadTournamentWithAllData(tournamentId);

    if (!tournament) {
      this.logger.error('Tournament not found for stats processing', {
        tournamentId,
      });
      return { status: 'skipped', reason: 'The tournament no longer exists' };
    }

    if (tournament.verificationStatus !== VerificationStatus.Verified) {
      this.logger.error(
        `Stats processing triggered for unverified tournament [Id: ${tournament.id} | Status: ${tournament.verificationStatus}]`,
        {
          tournamentId,
          verificationStatus: tournament.verificationStatus,
        }
      );
      return { status: 'skipped', reason: 'The tournament is not verified' };
    }

    const result = this.calculator.calculateAllStatistics(tournament);

    if (!result.success) {
      this.logger.error(
        `Failed to calculate statistics for tournament ${tournament.id}: ${result.errorMessage ?? 'Unknown error'}`,
        {
          tournamentId: tournament.id,
          error: result.errorMessage,
        }
      );
      return {
        status: 'failed',
        reason: `Calculating statistics failed: ${result.errorMessage ?? 'Unknown error'}`,
      };
    }

    await this.persistCalculationResults(tournament, result);

    this.logger.info(
      `Tournament ${tournament.id} statistics processed successfully [Matches: ${result.verifiedMatchesCount} | PlayerTournamentStats: ${result.playerTournamentStatsCount} | PlayerMatchStats: ${result.playerMatchStatsCount}]`,
      {
        tournamentId: tournament.id,
        verifiedMatches: result.verifiedMatchesCount,
        playerTournamentStats: result.playerTournamentStatsCount,
        playerMatchStats: result.playerMatchStatsCount,
      }
    );

    return { status: 'processed' };
  }

  private async loadTournamentWithAllData(
    tournamentId: number
  ): Promise<StatsTournament | null> {
    const tournamentRow = await this.db.query.tournaments.findFirst({
      where: eq(schema.tournaments.id, tournamentId),
      columns: {
        id: true,
        verificationStatus: true,
      },
      with: {
        matches: {
          columns: {
            id: true,
            verificationStatus: true,
          },
          with: {
            games: {
              columns: {
                id: true,
                matchId: true,
                verificationStatus: true,
              },
              with: {
                gameScores: {
                  columns: {
                    id: true,
                    gameId: true,
                    playerId: true,
                    score: true,
                    placement: true,
                    accuracy: true,
                    statGreat: true,
                    statOk: true,
                    statMeh: true,
                    statMiss: true,
                    statGood: true,
                    statPerfect: true,
                    team: true,
                    ruleset: true,
                    verificationStatus: true,
                  },
                },
                gameRosters: {
                  columns: {
                    id: true,
                    team: true,
                    roster: true,
                    score: true,
                    gameId: true,
                  },
                },
              },
            },
            matchRosters: {
              columns: {
                id: true,
                team: true,
                roster: true,
                score: true,
                matchId: true,
              },
            },
            ratingAdjustments: {
              columns: {
                id: true,
                playerId: true,
                ratingBefore: true,
                ratingAfter: true,
              },
            },
          },
        },
      },
    });

    if (!tournamentRow) {
      return null;
    }

    return {
      id: tournamentRow.id,
      verificationStatus:
        tournamentRow.verificationStatus as VerificationStatus,
      matches:
        tournamentRow.matches?.map((match): StatsMatch => ({
          id: match.id,
          verificationStatus: match.verificationStatus as VerificationStatus,
          games:
            match.games?.map((game): StatsMatch['games'][number] => ({
              id: game.id,
              matchId: game.matchId,
              verificationStatus: game.verificationStatus as VerificationStatus,
              scores:
                game.gameScores?.map((score) => ({
                  id: score.id,
                  gameId: score.gameId,
                  playerId: score.playerId,
                  score: score.score,
                  placement: score.placement,
                  accuracy: score.accuracy,
                  statGreat: score.statGreat,
                  statOk: score.statOk,
                  statMeh: score.statMeh,
                  statMiss: score.statMiss,
                  statGood: score.statGood,
                  statPerfect: score.statPerfect,
                  team: score.team as Team,
                  ruleset: score.ruleset as Ruleset,
                  verificationStatus:
                    score.verificationStatus as VerificationStatus,
                })) ?? [],
              rosters:
                game.gameRosters?.map((roster) => ({
                  id: roster.id,
                  team: roster.team as Team,
                  roster: roster.roster ?? [],
                  score: roster.score,
                  gameId: roster.gameId,
                })) ?? [],
            })) ?? [],
          playerRatingAdjustments:
            match.ratingAdjustments?.map((adjustment) => ({
              id: adjustment.id,
              playerId: adjustment.playerId,
              ratingBefore: adjustment.ratingBefore,
              ratingAfter: adjustment.ratingAfter,
            })) ?? [],
        })) ?? [],
    };
  }

  private async persistCalculationResults(
    tournament: StatsTournament,
    result: StatsCalculationSuccess
  ) {
    const playerMatchStats = this.extractPlayerMatchStats(result.matches);
    const matchRosters = this.extractMatchRosters(result.matches);
    const gameRosters = this.extractGameRosters(result.matches);
    const playerTournamentStats = result.playerTournamentStats;

    const matchIds = result.matches.map((match) => match.matchId);
    const gameIds = result.matches.flatMap((match) =>
      match.gameRosters.map((game) => game.gameId)
    );

    await this.db.transaction(async (tx) => {
      if (gameIds.length > 0) {
        await tx
          .delete(schema.gameRosters)
          .where(inArray(schema.gameRosters.gameId, gameIds));
      }

      if (matchIds.length > 0) {
        await tx
          .delete(schema.matchRosters)
          .where(inArray(schema.matchRosters.matchId, matchIds));

        await tx
          .delete(schema.playerMatchStats)
          .where(inArray(schema.playerMatchStats.matchId, matchIds));
      }

      await tx
        .delete(schema.playerTournamentStats)
        .where(eq(schema.playerTournamentStats.tournamentId, tournament.id));

      if (gameRosters.length > 0) {
        await tx.insert(schema.gameRosters).values(gameRosters);
      }

      if (matchRosters.length > 0) {
        await tx.insert(schema.matchRosters).values(matchRosters);
      }

      if (playerMatchStats.length > 0) {
        await tx.insert(schema.playerMatchStats).values(playerMatchStats);
      }

      if (playerTournamentStats.length > 0) {
        await tx
          .insert(schema.playerTournamentStats)
          .values(playerTournamentStats);
      }
    });
  }

  private extractPlayerMatchStats(
    matches: MatchProcessingResult[]
  ): PlayerMatchStatRecord[] {
    return matches.flatMap((match) => match.playerMatchStats);
  }

  private extractMatchRosters(matches: MatchProcessingResult[]) {
    return matches.flatMap((match) =>
      match.matchRosters.map((roster) => ({
        matchId: match.matchId,
        team: roster.team as Team,
        roster: roster.roster,
        score: roster.score,
      }))
    );
  }

  private extractGameRosters(matches: MatchProcessingResult[]) {
    return matches.flatMap((match) =>
      match.gameRosters.flatMap((game) =>
        game.rosters.map((roster) => ({
          gameId: game.gameId,
          team: roster.team as Team,
          roster: roster.roster,
          score: roster.score,
        }))
      )
    );
  }
}
