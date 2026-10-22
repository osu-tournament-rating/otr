import { Team, TeamType, VerificationStatus } from '@otr/core/osu';

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

/**
 * The players of a game who play for one result, and their total score. In a
 * team game a side is a team. osu! gives the scores of a head-to-head game no
 * team, so in a 1v1 tournament each player there is a side of their own, with
 * no team: o!TR invents no red or blue.
 */
interface GameSide {
  team: Team;
  players: Set<number>;
  score: number;
}

interface GameProcessingResult {
  gameId: number;
  sides: GameSide[];
  verifiedScores: StatsScore[];
  /** The side with the highest total, or null for a tied game. */
  winningSide: GameSide | null;
}

type MatchRoster = MatchProcessingResult['matchRosters'][number];

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
 * Whether each player of the game is a side of their own: a head-to-head game
 * in a 1v1 tournament. A head-to-head game an admin verified in a team
 * tournament records no sides, so its scores keep the teams they are stored
 * with.
 */
const hasPlayerSides = (game: StatsGame, oneVsOne: boolean) =>
  oneVsOne && game.teamType === TeamType.HeadToHead;

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

/** The game's sides, in the order of their best score. */
const generateGameSides = (
  game: StatsGame,
  scores: StatsScore[],
  oneVsOne: boolean
) => {
  const headToHead = hasPlayerSides(game, oneVsOne);
  const sides = new Map<string, GameSide>();

  for (const score of scores) {
    const key = headToHead ? `player:${score.playerId}` : `team:${score.team}`;
    const side = sides.get(key) ?? {
      team: headToHead ? Team.NoTeam : score.team,
      players: new Set<number>(),
      score: 0,
    };
    side.players.add(score.playerId);
    side.score += score.score;
    sides.set(key, side);
  }

  return Array.from(sides.values());
};

/**
 * The match's rosters: each side's players and the games it won. When any
 * game of a 1v1 was head-to-head, every side of the match is one player with
 * no team, so a 1v1 that switched modes keeps one side per player. A game won
 * by a side of several players then scores a point for each of them.
 */
const generateMatchRosters = (
  games: StatsGame[],
  gameResults: GameProcessingResult[],
  oneVsOne: boolean
): MatchRoster[] => {
  const headToHead = games.some((game) => hasPlayerSides(game, oneVsOne));
  const rosters = new Map<string, MatchRoster>();
  const add = (
    key: string,
    team: Team,
    players: Iterable<number>,
    won: boolean
  ) => {
    const roster = rosters.get(key) ?? { team, roster: [], score: 0 };
    roster.roster = uniqueNumbers([...roster.roster, ...players]);
    if (won) {
      roster.score += 1;
    }
    rosters.set(key, roster);
  };

  for (const result of gameResults) {
    for (const side of result.sides) {
      const won = side === result.winningSide;

      if (headToHead) {
        for (const playerId of side.players) {
          add(`player:${playerId}`, Team.NoTeam, [playerId], won);
        }
      } else {
        add(`team:${side.team}`, side.team, side.players, won);
      }
    }
  }

  return Array.from(rosters.values());
};

/**
 * Whether the player lost the match: they did not win it, and another side won
 * more games than a side they played for. A drawn match is neither a win nor a
 * loss. Player profiles count losses from the stored rosters by the same rule,
 * so the two agree for a player who played for more than one team.
 */
const lostMatch = (matchRosters: MatchRoster[], stat: PlayerMatchStatRecord) =>
  !stat.won &&
  matchRosters.some(
    (own) =>
      own.roster.includes(stat.playerId) &&
      matchRosters.some((other) => other !== own && other.score > own.score)
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
      const matchResult = this.processMatch(match, tournament.lobbySize === 1);
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
  private processMatch(
    match: StatsMatch,
    oneVsOne: boolean
  ): MatchProcessingResult | null {
    if (match.verificationStatus !== VerificationStatus.Verified) {
      return null;
    }

    if (match.playerRatingAdjustments.length === 0) {
      return null;
    }

    const countedGames: StatsGame[] = [];
    const gameResults: GameProcessingResult[] = [];

    for (const game of ensureVerified(match.games)) {
      const result = this.processGame(game, oneVsOne);
      if (!result) {
        continue;
      }
      countedGames.push(game);
      gameResults.push(result);
    }

    if (gameResults.length === 0) {
      return null;
    }

    const matchRosters = generateMatchRosters(
      countedGames,
      gameResults,
      oneVsOne
    );

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
        rosters: result.sides.map((side) => ({
          team: side.team,
          roster: Array.from(side.players),
          score: side.score,
        })),
      })),
      playerMatchStats,
    };
  }

  private processGame(
    game: StatsGame,
    oneVsOne: boolean
  ): GameProcessingResult | null {
    if (game.verificationStatus !== VerificationStatus.Verified) {
      return null;
    }

    const verifiedScores = ensureVerified(game.scores);
    if (verifiedScores.length === 0) {
      return null;
    }

    const orderedScores = [...verifiedScores].sort((a, b) => b.score - a.score);
    const sides = generateGameSides(game, orderedScores, oneVsOne);

    return {
      gameId: game.id,
      sides,
      // A tied game goes to neither side.
      winningSide: soleLeader(new Map(sides.map((side) => [side, side.score]))),
      verifiedScores: orderedScores,
    };
  }

  private generatePlayerMatchStatistics(
    match: StatsMatch,
    verifiedGames: StatsGame[],
    gameResults: GameProcessingResult[],
    matchRosters: MatchRoster[]
  ): PlayerMatchStatRecord[] {
    const matchCosts = calculateOtrMatchCosts(verifiedGames);
    const playerScores = new Map<number, StatsScore[]>();
    const winningSideByGame = new Map<number, GameSide | null>();

    for (const result of gameResults) {
      winningSideByGame.set(result.gameId, result.winningSide);
      for (const score of result.verifiedScores) {
        const list = playerScores.get(score.playerId) ?? [];
        list.push(score);
        playerScores.set(score.playerId, list);
      }
    }

    // A drawn match has no winner, so nobody in it won.
    const winningRoster = soleLeader(
      new Map(matchRosters.map((roster) => [roster, roster.score]))
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

      for (const gameId of new Set(scores.map((score) => score.gameId))) {
        const winningSide = winningSideByGame.get(gameId);
        if (winningSide == null) {
          continue;
        }
        if (winningSide.players.has(playerId)) {
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
        .filter((roster) => roster !== matchRoster)
        .flatMap((roster) => roster.roster)
        .filter((id) => id !== playerId);

      const matchCost = sanitizeNumber(matchCosts.get(playerId) ?? 0);
      const won = winningRoster !== null && matchRoster === winningRoster;

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
