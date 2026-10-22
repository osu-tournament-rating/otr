import {
  GameWarningFlags,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu';

import type {
  AutomationGame,
  AutomationGameRoster,
  AutomationMatch,
  AutomationMatchRoster,
  AutomationScore,
} from './types';
import {
  addWarningFlag,
  aggregateScoreRoster,
  countValidScores,
} from './utils';

export const generateRostersFromScores = (
  scores: AutomationScore[]
): AutomationGameRoster[] => {
  if (scores.length === 0) {
    return [];
  }

  const gameId = scores[0]?.gameId ?? 0;
  const grouped = aggregateScoreRoster(scores);

  return Array.from(grouped.entries()).map(([team, roster]) => ({
    id: 0,
    gameId,
    team,
    roster: Array.from(roster),
    score: scores
      .filter((score) => score.team === team)
      .reduce((sum, score) => sum + score.score, 0),
  }));
};

export const ensureGameRosters = (
  game: AutomationGame
): AutomationGameRoster[] => {
  if (game.rosters.length > 0) {
    return game.rosters;
  }

  return generateRostersFromScores(
    game.scores.filter((score) =>
      isScoreEligibleForRosters(score.verificationStatus)
    )
  );
};

const isScoreEligibleForRosters = (status: VerificationStatus) =>
  status !== VerificationStatus.Rejected;

const determineWinningTeam = (game: AutomationGame): Team | null => {
  const verifiedScores = game.scores.filter(
    (score) => score.verificationStatus === VerificationStatus.Verified
  );

  if (verifiedScores.length === 0) {
    return null;
  }

  const totals = new Map<Team, number>();

  for (const score of verifiedScores) {
    totals.set(score.team, (totals.get(score.team) ?? 0) + score.score);
  }

  const ordered = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);

  return ordered[0]?.[0] ?? null;
};

export const generateMatchRosters = (
  games: AutomationGame[]
): AutomationMatchRoster[] => {
  if (games.length === 0) {
    return [];
  }

  const matchId = games[0]?.matchId ?? 0;

  const rosterMap = new Map<Team, Set<number>>();
  const points = new Map<Team, number>();

  for (const game of games) {
    const rosters = ensureGameRosters(game);

    if (rosters.length === 0) {
      continue;
    }

    for (const roster of rosters) {
      if (!rosterMap.has(roster.team)) {
        rosterMap.set(roster.team, new Set<number>());
      }

      const set = rosterMap.get(roster.team)!;
      roster.roster.forEach((playerId) => set.add(playerId));
    }

    const winningTeam = determineWinningTeam(game);
    if (winningTeam != null) {
      points.set(winningTeam, (points.get(winningTeam) ?? 0) + 1);
    }
  }

  return Array.from(rosterMap.entries()).map(([team, roster]) => ({
    id: 0,
    matchId,
    team,
    roster: Array.from(roster),
    score: points.get(team) ?? 0,
  }));
};

export const ensureMatchRosters = (
  match: AutomationMatch
): AutomationMatchRoster[] => {
  if (match.rosters.length > 0) {
    return match.rosters;
  }

  return generateMatchRosters(match.games);
};

export const trackBeatmapUsage = (
  tournamentGames: AutomationGame[],
  currentGame: AutomationGame
) => {
  const beatmapId = currentGame.beatmap?.osuId;

  if (!beatmapId) {
    return;
  }

  const usageCount = tournamentGames.filter(
    (game) => game.beatmap?.osuId === beatmapId
  ).length;

  if (usageCount === 1) {
    currentGame.warningFlags = addWarningFlag(
      currentGame.warningFlags,
      GameWarningFlags.BeatmapUsedOnce
    );
  }
};

/**
 * The players on each side of a game, from its scores. A team game has a side
 * per team. osu! gives the scores of a head-to-head game no team, so there
 * each player is a side of their own.
 */
export const gameSides = (
  game: Pick<AutomationGame, 'teamType'>,
  scores: AutomationScore[]
): Map<number, Set<number>> =>
  game.teamType === TeamType.HeadToHead
    ? new Map(
        scores.map((score) => [score.playerId, new Set([score.playerId])])
      )
    : aggregateScoreRoster(scores);

/** Whether the game's valid scores form two sides of `lobbySize` players. */
export const gameHasQualifiedRoster = (
  game: AutomationGame,
  lobbySize: number
) => {
  const validScores = countValidScores(game.scores);

  if (validScores.length === 0) {
    return false;
  }

  if (validScores.length % 2 !== 0) {
    return false;
  }

  const sides = gameSides(game, validScores);

  if (sides.size !== 2) {
    return false;
  }

  const counts = Array.from(sides.values()).map((players) => players.size);

  return counts.every((count) => count === lobbySize);
};

export const rosterOverlaps = (
  matchRosters: AutomationMatchRoster[]
): boolean => {
  const rosterSets = matchRosters.map((roster) => new Set(roster.roster));

  for (let i = 0; i < rosterSets.length; i += 1) {
    for (let j = i + 1; j < rosterSets.length; j += 1) {
      const first = rosterSets[i];
      const second = rosterSets[j];
      for (const playerId of first) {
        if (second.has(playerId)) {
          return true;
        }
      }
    }
  }

  return false;
};

export const markBeatmapSingleUse = (tournament: AutomationMatch[]) => {
  const allGames = tournament.flatMap((match) => match.games);

  for (const game of allGames) {
    if (game.beatmap == null) {
      continue;
    }

    trackBeatmapUsage(allGames, game);
  }
};

export const assignBeatmapUsageWarning = (
  game: AutomationGame,
  tournament: AutomationMatch[]
) => {
  const allGames = tournament.flatMap((match) => match.games);
  trackBeatmapUsage(allGames, game);
};

export const ensureBeatmapUsageWarning = (
  game: AutomationGame,
  tournament: AutomationMatch[]
) => {
  if (game.warningFlags & GameWarningFlags.BeatmapUsedOnce) {
    return;
  }

  assignBeatmapUsageWarning(game, tournament);
};
