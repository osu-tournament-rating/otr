import type { Ruleset, Team, VerificationStatus } from '@otr/core/osu';

export interface StatsTournament {
  id: number;
  verificationStatus: VerificationStatus;
  matches: StatsMatch[];
}

export interface StatsMatch {
  id: number;
  verificationStatus: VerificationStatus;
  games: StatsGame[];
  playerRatingAdjustments: MatchRatingAdjustment[];
}

export interface StatsGame {
  id: number;
  matchId: number;
  verificationStatus: VerificationStatus;
  scores: StatsScore[];
  rosters: StatsGameRoster[];
}

export interface StatsScore {
  id: number;
  gameId: number;
  playerId: number;
  score: number;
  placement: number;
  accuracy: number;
  statGreat: number | null;
  statOk: number | null;
  statMeh: number | null;
  statMiss: number | null;
  statGood: number | null;
  statPerfect: number | null;
  team: Team;
  ruleset: Ruleset;
  verificationStatus: VerificationStatus;
}

export interface StatsGameRoster {
  id: number;
  team: Team;
  roster: number[];
  score: number;
  gameId: number;
}

export interface StatsMatchRoster {
  id: number;
  team: Team;
  roster: number[];
  score: number;
  matchId: number;
}

export interface MatchRatingAdjustment {
  id: number;
  playerId: number;
  ratingBefore: number;
  ratingAfter: number;
}

export interface PlayerMatchStatRecord {
  playerId: number;
  matchId: number;
  matchCost: number;
  averageScore: number;
  averagePlacement: number;
  averageMisses: number;
  averageAccuracy: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  won: boolean;
  teammateIds: number[];
  opponentIds: number[];
}

export interface PlayerTournamentStatRecord {
  playerId: number;
  tournamentId: number;
  averageRatingDelta: number;
  averageMatchCost: number;
  averageScore: number;
  averagePlacement: number;
  averageAccuracy: number;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  matchWinRate: number;
  teammateIds: number[];
}

export interface GameRosterResult {
  gameId: number;
  rosters: Array<{
    team: Team;
    roster: number[];
    score: number;
  }>;
}

export interface MatchProcessingResult {
  matchId: number;
  playerMatchStats: PlayerMatchStatRecord[];
  matchRosters: Array<{
    team: Team;
    roster: number[];
    score: number;
  }>;
  gameRosters: GameRosterResult[];
}

export interface StatsCalculationFailure {
  success: false;
  errorMessage: string;
}

export interface StatsCalculationSuccess {
  success: true;
  verifiedMatchesCount: number;
  /**
   * Verified matches left out because the rating run leaves them out too:
   * no verified game with verified scores, or no rating changes.
   */
  skippedMatchIds: number[];
  playerMatchStatsCount: number;
  playerTournamentStatsCount: number;
  matches: MatchProcessingResult[];
  playerTournamentStats: PlayerTournamentStatRecord[];
}

export type StatsCalculationResult =
  StatsCalculationFailure | StatsCalculationSuccess;
