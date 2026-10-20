import { Team, VerificationStatus } from '@otr/core/osu';

import { calculateOtrMatchCosts } from './match-cost-calculator';
import type {
  MatchProcessingResult,
  PlayerMatchStatRecord,
  PlayerTournamentStatRecord,
  StatsCalculationResult,
  StatsMatch,
  StatsTournament,
  StatsGame,
  StatsScore,
} from './types';

interface GameProcessingResult {
  gameId: number;
  rosters: Array<{
    team: Team;
    roster: number[];
    score: number;
  }>;
  verifiedScores: StatsScore[];
  winningTeam: Team | null;
}

const ensureVerified = <T extends { verificationStatus: VerificationStatus }>(
  items: T[]
) =>
  items.filter(
    (item) => item.verificationStatus === VerificationStatus.Verified
  );

const uniqueNumbers = (values: Iterable<number>) => Array.from(new Set(values));

const sanitizeNumber = (value: number) => (Number.isFinite(value) ? value : 0);

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + sanitizeNumber(value), 0);
  return sanitizeNumber(total / values.length);
};

/**
 * The team with the highest total, or null when no team leads on its own: a
 * tied game goes to neither team.
 */
const determineWinningTeam = (scores: StatsScore[]) => {
  const totals = new Map<Team, number>();

  for (const score of scores) {
    const current = totals.get(score.team) ?? 0;
    totals.set(score.team, current + score.score);
  }

  return soleLeader(totals);
};

/** The key with the highest value, or null when the highest value is shared. */
const soleLeader = <K>(values: Map<K, number>): K | null => {
  let leader: K | null = null;
  let best = Number.NEGATIVE_INFINITY;
  let shared = false;

  for (const [key, value] of values.entries()) {
    if (value > best) {
      best = value;
      leader = key;
      shared = false;
    } else if (value === best) {
      shared = true;
    }
  }

  return shared ? null : leader;
};

const generateGameRosters = (game: StatsGame, scores: StatsScore[]) => {
  if (scores.length === 0) {
    return [];
  }

  const rosterMap = new Map<Team, { players: Set<number>; total: number }>();

  for (const score of scores) {
    const entry = rosterMap.get(score.team) ?? {
      players: new Set<number>(),
      total: 0,
    };
    entry.players.add(score.playerId);
    entry.total += score.score;
    rosterMap.set(score.team, entry);
  }

  return Array.from(rosterMap.entries()).map(([team, entry]) => ({
    team,
    roster: Array.from(entry.players),
    score: entry.total,
    gameId: game.id,
  }));
};

const generateMatchRosters = (
  matchId: number,
  gameResults: GameProcessingResult[]
) => {
  if (gameResults.length === 0) {
    return [];
  }

  const rosterMap = new Map<Team, Set<number>>();
  const points = new Map<Team, number>();

  for (const result of gameResults) {
    for (const roster of result.rosters) {
      const existing = rosterMap.get(roster.team) ?? new Set<number>();
      roster.roster.forEach((playerId) => existing.add(playerId));
      rosterMap.set(roster.team, existing);
    }

    if (result.winningTeam != null) {
      const current = points.get(result.winningTeam) ?? 0;
      points.set(result.winningTeam, current + 1);
    }
  }

  return Array.from(rosterMap.entries()).map(([team, players]) => ({
    matchId,
    team,
    roster: Array.from(players),
    score: points.get(team) ?? 0,
  }));
};

/**
 * Whether the player lost the match: they did not win it, and another team won
 * more games than a team they played for. A drawn match is neither a win nor a
 * loss. Player profiles count losses from the stored rosters by the same rule,
 * so the two agree for a player who played for more than one team.
 */
const lostMatch = (
  matchRosters: MatchProcessingResult['matchRosters'],
  stat: PlayerMatchStatRecord
) =>
  !stat.won &&
  matchRosters.some(
    (own) =>
      own.roster.includes(stat.playerId) &&
      matchRosters.some(
        (other) => other.team !== own.team && other.score > own.score
      )
  );

export class TournamentStatsCalculator {
  calculateAllStatistics(tournament: StatsTournament): StatsCalculationResult {
    if (tournament.verificationStatus !== VerificationStatus.Verified) {
      return {
        success: false,
        errorMessage: `Tournament ${tournament.id} is not verified (status: ${tournament.verificationStatus})`,
      };
    }

    const verifiedMatches = ensureVerified(tournament.matches);

    if (verifiedMatches.length === 0) {
      return {
        success: false,
        errorMessage: `No verified matches found for tournament ${tournament.id}`,
      };
    }

    const matchResults: MatchProcessingResult[] = [];
    const skippedMatchIds: number[] = [];
    let totalPlayerMatchStats = 0;

    for (const match of verifiedMatches) {
      const matchResult = this.processMatch(match);
      if (!matchResult) {
        skippedMatchIds.push(match.id);
        continue;
      }

      matchResults.push(matchResult);
      totalPlayerMatchStats += matchResult.playerMatchStats.length;
    }

    if (matchResults.length === 0) {
      return {
        success: false,
        errorMessage: `No verified match in tournament ${tournament.id} has verified scores and rating changes`,
      };
    }

    const playerTournamentStats = this.aggregateTournamentStats(
      tournament,
      verifiedMatches,
      matchResults
    );

    return {
      success: true,
      verifiedMatchesCount: verifiedMatches.length,
      skippedMatchIds,
      playerMatchStatsCount: totalPlayerMatchStats,
      playerTournamentStatsCount: playerTournamentStats.length,
      matches: matchResults,
      playerTournamentStats,
    };
  }

  /**
   * The match's rosters and player stats, or null when the rating run skips
   * it too: no verified game with verified scores, or no rating changes.
   * Verified games without verified scores are left out, as the rating run
   * leaves them out.
   */
  private processMatch(match: StatsMatch): MatchProcessingResult | null {
    if (match.verificationStatus !== VerificationStatus.Verified) {
      return null;
    }

    if (match.playerRatingAdjustments.length === 0) {
      return null;
    }

    const countedGames: StatsGame[] = [];
    const gameResults: GameProcessingResult[] = [];

    for (const game of ensureVerified(match.games)) {
      const result = this.processGame(game);
      if (!result) {
        continue;
      }
      countedGames.push(game);
      gameResults.push(result);
    }

    if (gameResults.length === 0) {
      return null;
    }

    const matchRosters = generateMatchRosters(match.id, gameResults);

    const playerMatchStats = this.generatePlayerMatchStatistics(
      match,
      countedGames,
      gameResults,
      matchRosters
    );

    return {
      matchId: match.id,
      matchRosters,
      gameRosters: gameResults.map((result) => ({
        gameId: result.gameId,
        rosters: result.rosters,
      })),
      playerMatchStats,
    };
  }

  private processGame(game: StatsGame): GameProcessingResult | null {
    if (game.verificationStatus !== VerificationStatus.Verified) {
      return null;
    }

    const verifiedScores = ensureVerified(game.scores);
    if (verifiedScores.length === 0) {
      return null;
    }

    const orderedScores = [...verifiedScores].sort((a, b) => b.score - a.score);
    const rosters = generateGameRosters(game, orderedScores);
    const winningTeam = determineWinningTeam(orderedScores);

    return {
      gameId: game.id,
      rosters,
      winningTeam,
      verifiedScores: orderedScores,
    };
  }

  private generatePlayerMatchStatistics(
    match: StatsMatch,
    verifiedGames: StatsGame[],
    gameResults: GameProcessingResult[],
    matchRosters: Array<{
      team: Team;
      roster: number[];
      score: number;
    }>
  ): PlayerMatchStatRecord[] {
    const matchCosts = calculateOtrMatchCosts(verifiedGames);
    const playerScores = new Map<number, StatsScore[]>();
    const winningTeamByGame = new Map<number, Team | null>();

    for (const result of gameResults) {
      winningTeamByGame.set(result.gameId, result.winningTeam);
      for (const score of result.verifiedScores) {
        const list = playerScores.get(score.playerId) ?? [];
        list.push(score);
        playerScores.set(score.playerId, list);
      }
    }

    // A drawn match has no winner, so nobody in it won.
    const winningTeam = soleLeader(
      new Map(matchRosters.map((roster) => [roster.team, roster.score]))
    );

    const stats: PlayerMatchStatRecord[] = [];

    for (const [playerId, scores] of playerScores.entries()) {
      const gamesPlayed = scores.length;

      const averageScore = average(scores.map((score) => score.score));
      const averagePlacement = average(scores.map((score) => score.placement));
      const averageMisses = average(scores.map((score) => score.statMiss ?? 0));
      const averageAccuracy = average(scores.map((score) => score.accuracy));

      let gamesWon = 0;
      let gamesLost = 0;

      const uniqueGameIds = new Set(scores.map((score) => score.gameId));

      for (const gameId of uniqueGameIds) {
        const score = scores.find((s) => s.gameId === gameId);
        if (!score) {
          continue;
        }
        const winningTeam = winningTeamByGame.get(gameId);
        if (winningTeam == null) {
          continue;
        }
        if (winningTeam === score.team) {
          gamesWon += 1;
        } else {
          gamesLost += 1;
        }
      }

      const matchRoster = matchRosters.find((roster) =>
        roster.roster.includes(playerId)
      );
      const teammateIds = matchRoster
        ? uniqueNumbers(matchRoster.roster.filter((id) => id !== playerId))
        : [];
      const opponentIds = matchRosters
        .filter((roster) => roster.team !== matchRoster?.team)
        .flatMap((roster) => roster.roster)
        .filter((id) => id !== playerId);

      const matchCost = sanitizeNumber(matchCosts.get(playerId) ?? 0);
      const won = winningTeam !== null && matchRoster?.team === winningTeam;

      stats.push({
        playerId,
        matchId: match.id,
        matchCost,
        averageScore,
        averagePlacement,
        averageMisses,
        averageAccuracy,
        gamesPlayed,
        gamesWon,
        gamesLost,
        won,
        teammateIds,
        opponentIds: uniqueNumbers(opponentIds),
      });
    }

    return stats;
  }

  private aggregateTournamentStats(
    tournament: StatsTournament,
    matches: StatsMatch[],
    matchResults: MatchProcessingResult[]
  ): PlayerTournamentStatRecord[] {
    const matchById = new Map(
      matches.map((match) => [match.id, match] as const)
    );
    const aggregateMap = new Map<
      number,
      {
        matchStats: PlayerMatchStatRecord[];
        matchesLost: number;
        ratingDeltas: number[];
        teammateIds: Set<number>;
      }
    >();

    for (const matchResult of matchResults) {
      const match = matchById.get(matchResult.matchId);
      if (!match) {
        continue;
      }

      for (const stat of matchResult.playerMatchStats) {
        const adjustments = match.playerRatingAdjustments.filter(
          (adjustment) => adjustment.playerId === stat.playerId
        );

        if (adjustments.length === 0) {
          continue;
        }

        const entry = aggregateMap.get(stat.playerId) ?? {
          matchStats: [],
          matchesLost: 0,
          ratingDeltas: [],
          teammateIds: new Set<number>(),
        };

        entry.matchStats.push(stat);
        if (lostMatch(matchResult.matchRosters, stat)) {
          entry.matchesLost += 1;
        }
        adjustments.forEach((adjustment) => {
          entry.ratingDeltas.push(
            adjustment.ratingAfter - adjustment.ratingBefore
          );
        });
        stat.teammateIds.forEach((id) => entry.teammateIds.add(id));

        aggregateMap.set(stat.playerId, entry);
      }
    }

    const results: PlayerTournamentStatRecord[] = [];

    for (const [playerId, data] of aggregateMap.entries()) {
      if (data.ratingDeltas.length === 0 || data.matchStats.length === 0) {
        continue;
      }

      const matchesPlayed = data.matchStats.length;
      const matchesWon = data.matchStats.filter((stat) => stat.won).length;
      const { matchesLost } = data;
      const gamesPlayed = data.matchStats.reduce(
        (sum, stat) => sum + stat.gamesPlayed,
        0
      );
      const gamesWon = data.matchStats.reduce(
        (sum, stat) => sum + stat.gamesWon,
        0
      );
      const gamesLost = data.matchStats.reduce(
        (sum, stat) => sum + stat.gamesLost,
        0
      );

      const averageMatchCost = average(
        data.matchStats.map((stat) => stat.matchCost)
      );
      const averageScoreValue = average(
        data.matchStats.map((stat) => stat.averageScore)
      );
      const averagePlacement = average(
        data.matchStats.map((stat) => stat.averagePlacement)
      );
      const averageAccuracy = average(
        data.matchStats.map((stat) => stat.averageAccuracy)
      );

      const averageRatingDelta = average(data.ratingDeltas);

      results.push({
        playerId,
        tournamentId: tournament.id,
        averageRatingDelta,
        averageMatchCost,
        averageScore: Math.trunc(averageScoreValue),
        averagePlacement,
        averageAccuracy,
        matchesPlayed,
        matchesWon,
        matchesLost,
        gamesPlayed,
        gamesWon,
        gamesLost,
        matchWinRate: matchesPlayed > 0 ? matchesWon / matchesPlayed : 0,
        teammateIds: Array.from(data.teammateIds),
      });
    }

    return results;
  }
}
