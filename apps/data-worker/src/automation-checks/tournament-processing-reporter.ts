import {
  GameRejectionReason,
  GameWarningFlags,
  MatchRejectionReason,
  MatchWarningFlags,
  ScoreRejectionReason,
  TournamentRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';

import type {
  AutomationGame,
  AutomationMatch,
  AutomationScore,
  AutomationTournament,
} from './types';
import { isPreVerifiedOrVerified } from './utils';

export interface RejectionGroup {
  reason: string;
  count: number;
}

export interface VerificationCounts {
  preVerified: number;
  verified: number;
  preRejected: number;
  rejected: number;
}

export interface TournamentProcessingState {
  tournamentId: number;
  abbreviation: string;
  tournamentStatusBefore: VerificationStatus;
  tournamentStatusAfter: VerificationStatus;
  tournamentRejectionReason: TournamentRejectionReason;
  matchRejections: RejectionGroup[];
  gameRejections: RejectionGroup[];
  scoreRejections: RejectionGroup[];
  totalMatches: number;
  totalGames: number;
  totalScores: number;
  matchesWithWarnings: number;
  gamesWithWarnings: number;
  matchCounts: VerificationCounts;
  gameCounts: VerificationCounts;
  scoreCounts: VerificationCounts;
}

const COLUMN_SEPARATOR = '\t';
const FIELD_SEPARATOR = ' | ';

const resolveEnumName = (
  value: number,
  enumObject: Record<string | number, string | number>
) => {
  const name = Object.entries(enumObject).find(
    ([, enumValue]) => typeof enumValue === 'number' && enumValue === value
  )?.[0];
  return name ?? value.toString();
};

const calculateCounts = <T>(
  items: T[],
  selector: (item: T) => VerificationStatus
): VerificationCounts => {
  let preVerified = 0;
  let verified = 0;
  let preRejected = 0;
  let rejected = 0;

  for (const status of items.map(selector)) {
    switch (status) {
      case VerificationStatus.PreVerified:
        preVerified += 1;
        break;
      case VerificationStatus.Verified:
        verified += 1;
        break;
      case VerificationStatus.PreRejected:
        preRejected += 1;
        break;
      case VerificationStatus.Rejected:
        rejected += 1;
        break;
      default:
        break;
    }
  }

  return { preVerified, verified, preRejected, rejected };
};

const groupRejections = <TEntity>(
  entities: TEntity[],
  selector: (entity: TEntity) => number,
  enumLookup: Record<string | number, string | number>
) => {
  const counts = new Map<number, number>();

  for (const entity of entities) {
    const value = selector(entity);
    if (value === 0) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([raw, count]) => ({
      reason: resolveEnumName(raw, enumLookup),
      count,
    }))
    .sort((a, b) => b.count - a.count);
};

export const captureTournamentProcessingState = (
  tournament: AutomationTournament,
  beforeStatus: VerificationStatus
): TournamentProcessingState => {
  const matches = tournament.matches;
  const games = matches.flatMap((match) => match.games);
  const scores = games.flatMap((game) => game.scores);

  return {
    tournamentId: tournament.id,
    abbreviation: tournament.abbreviation,
    tournamentStatusBefore: beforeStatus,
    tournamentStatusAfter: tournament.verificationStatus,
    tournamentRejectionReason: tournament.rejectionReason,
    matchRejections: groupRejections(
      matches,
      (match) => match.rejectionReason,
      MatchRejectionReason
    ),
    gameRejections: groupRejections(
      games,
      (game) => game.rejectionReason,
      GameRejectionReason
    ),
    scoreRejections: groupRejections(
      scores,
      (score) => score.rejectionReason,
      ScoreRejectionReason
    ),
    totalMatches: matches.length,
    totalGames: games.length,
    totalScores: scores.length,
    matchesWithWarnings: matches.filter(
      (match) => match.warningFlags !== MatchWarningFlags.None
    ).length,
    gamesWithWarnings: games.filter(
      (game) => game.warningFlags !== GameWarningFlags.None
    ).length,
    matchCounts: calculateCounts(matches, (match) => match.verificationStatus),
    gameCounts: calculateCounts(games, (game) => game.verificationStatus),
    scoreCounts: calculateCounts(scores, (score) => score.verificationStatus),
  };
};

const buildEntityInfo = (rejections: RejectionGroup[], warnings: number) => {
  const segments: string[] = [];

  if (rejections.length > 0) {
    const [top] = rejections;
    if (top && top.count > 0) {
      segments.push(`Rej: ${top.reason} x${top.count}`);
    }
  }

  if (warnings > 0) {
    segments.push(`Warn: ${warnings}`);
  }

  return segments.length > 0
    ? `${FIELD_SEPARATOR}${segments.join(FIELD_SEPARATOR)}`
    : '';
};

export const generateTournamentProcessingReport = (
  state: TournamentProcessingState
): string => {
  const lines: string[] = [];
  const tournamentRejection =
    state.tournamentRejectionReason !== TournamentRejectionReason.None
      ? `${FIELD_SEPARATOR}Rejection: ${resolveEnumName(
          state.tournamentRejectionReason,
          TournamentRejectionReason
        )}`
      : '';

  lines.push(
    [
      'Tournament',
      `${state.abbreviation} (ID: ${state.tournamentId})`,
      `Status: ${state.tournamentStatusBefore} → ${state.tournamentStatusAfter}${tournamentRejection}`,
    ].join(COLUMN_SEPARATOR)
  );

  lines.push(
    [
      'Matches',
      '',
      `Total: ${state.totalMatches}${FIELD_SEPARATOR}Pre-Ver: ${state.matchCounts.preVerified}${FIELD_SEPARATOR}Ver: ${state.matchCounts.verified}${FIELD_SEPARATOR}Pre-Rej: ${state.matchCounts.preRejected}${FIELD_SEPARATOR}Rej: ${state.matchCounts.rejected}${buildEntityInfo(state.matchRejections, state.matchesWithWarnings)}`,
    ].join(COLUMN_SEPARATOR)
  );

  lines.push(
    [
      'Games',
      '',
      `Total: ${state.totalGames}${FIELD_SEPARATOR}Pre-Ver: ${state.gameCounts.preVerified}${FIELD_SEPARATOR}Ver: ${state.gameCounts.verified}${FIELD_SEPARATOR}Pre-Rej: ${state.gameCounts.preRejected}${FIELD_SEPARATOR}Rej: ${state.gameCounts.rejected}${buildEntityInfo(state.gameRejections, state.gamesWithWarnings)}`,
    ].join(COLUMN_SEPARATOR)
  );

  lines.push(
    [
      'Scores',
      '',
      `Total: ${state.totalScores}${FIELD_SEPARATOR}Pre-Ver: ${state.scoreCounts.preVerified}${FIELD_SEPARATOR}Ver: ${state.scoreCounts.verified}${FIELD_SEPARATOR}Pre-Rej: ${state.scoreCounts.preRejected}${FIELD_SEPARATOR}Rej: ${state.scoreCounts.rejected}${buildEntityInfo(state.scoreRejections, 0)}`,
    ].join(COLUMN_SEPARATOR)
  );

  return lines.join('\n');
};

export const determinePostTournamentStatus = (
  rejectionReason: TournamentRejectionReason
): VerificationStatus =>
  rejectionReason === TournamentRejectionReason.None
    ? VerificationStatus.PreVerified
    : VerificationStatus.PreRejected;

export const isLockedVerificationStatus = (status: VerificationStatus) =>
  status === VerificationStatus.Verified ||
  status === VerificationStatus.Rejected;

export const cascadeMatchRejection = (match: AutomationMatch) => {
  match.verificationStatus = VerificationStatus.Rejected;
  match.rejectionReason |= MatchRejectionReason.RejectedTournament;

  for (const game of match.games) {
    game.verificationStatus = VerificationStatus.Rejected;
    game.rejectionReason |= GameRejectionReason.RejectedMatch;

    for (const score of game.scores) {
      score.verificationStatus = VerificationStatus.Rejected;
      score.rejectionReason |= ScoreRejectionReason.RejectedGame;
    }
  }
};

export const cascadeTournamentRejection = (matches: AutomationMatch[]) => {
  for (const match of matches) {
    cascadeMatchRejection(match);
  }
};

export const resetVerificationState = (
  match: AutomationMatch,
  overrideVerifiedState: boolean
) => {
  if (
    !overrideVerifiedState &&
    isLockedVerificationStatus(match.verificationStatus)
  ) {
    return;
  }

  match.verificationStatus = VerificationStatus.None;
  match.rejectionReason = MatchRejectionReason.None;
  match.warningFlags = MatchWarningFlags.None;

  for (const game of match.games) {
    if (
      overrideVerifiedState ||
      !isLockedVerificationStatus(game.verificationStatus)
    ) {
      game.verificationStatus = VerificationStatus.None;
      game.rejectionReason = GameRejectionReason.None;
      game.warningFlags = GameWarningFlags.None;
    }

    for (const score of game.scores) {
      if (
        overrideVerifiedState ||
        !isLockedVerificationStatus(score.verificationStatus)
      ) {
        score.verificationStatus = VerificationStatus.None;
        score.rejectionReason = ScoreRejectionReason.None;
      }
    }
  }
};

/** Every row of a rejected tournament follows its rejection, so none is checked. */
export const shouldSkipAutomation = (
  tournament: AutomationTournament,
  overrideVerifiedState: boolean
) =>
  !overrideVerifiedState &&
  tournament.verificationStatus === VerificationStatus.Rejected;

/**
 * An admin verified the tournament, so the checks keep its status and check
 * only the rows nobody decided, such as a match added since.
 */
export const keepsTournamentStatus = (
  tournament: AutomationTournament,
  overrideVerifiedState: boolean
) =>
  !overrideVerifiedState &&
  tournament.verificationStatus === VerificationStatus.Verified;

export const resetTournamentVerification = (
  tournament: AutomationTournament
) => {
  tournament.verificationStatus = VerificationStatus.None;
  tournament.rejectionReason = TournamentRejectionReason.None;
};

export const computeMatchesReadyForAutomation = (
  tournament: AutomationTournament
) => tournament.matches.filter((match) => match.games.length > 0);

export const hasAnyVerifiedEntity = (match: AutomationMatch) =>
  match.games.some((game) => isPreVerifiedOrVerified(game.verificationStatus));

export const hasVerifiedScore = (game: AutomationGame) =>
  game.scores.some((score) =>
    isPreVerifiedOrVerified(score.verificationStatus)
  );

export const applyScoreAutomationResult = (
  score: AutomationScore,
  rejection: ScoreRejectionReason
) => {
  if (rejection === ScoreRejectionReason.None) {
    score.verificationStatus = VerificationStatus.PreVerified;
    score.rejectionReason = ScoreRejectionReason.None;
  } else {
    score.verificationStatus = VerificationStatus.PreRejected;
    score.rejectionReason = rejection;
  }
};

export const applyGameAutomationResult = (
  game: AutomationGame,
  rejection: GameRejectionReason
) => {
  if (rejection === GameRejectionReason.None) {
    game.verificationStatus = VerificationStatus.PreVerified;
    game.rejectionReason = GameRejectionReason.None;
  } else {
    game.verificationStatus = VerificationStatus.PreRejected;
    game.rejectionReason = rejection;
  }
};

export const applyMatchAutomationResult = (
  match: AutomationMatch,
  rejection: MatchRejectionReason
) => {
  if (rejection === MatchRejectionReason.None) {
    match.verificationStatus = VerificationStatus.PreVerified;
    match.rejectionReason = MatchRejectionReason.None;
  } else {
    match.verificationStatus = VerificationStatus.PreRejected;
    match.rejectionReason = rejection;
  }
};
