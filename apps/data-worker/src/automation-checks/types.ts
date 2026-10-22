import {
  GameRejectionReason,
  GameWarningFlags,
  MatchRejectionReason,
  MatchWarningFlags,
  Mods,
  Ruleset,
  ScoreRejectionReason,
  ScoringType,
  Team,
  TeamType,
  TournamentRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

export interface AutomationTournament {
  id: number;
  abbreviation: string;
  ruleset: Ruleset;
  lobbySize: number;
  verificationStatus: VerificationStatus;
  rejectionReason: TournamentRejectionReason;
  /** The admin who verified or rejected the tournament. */
  verifiedByUserId?: number | null;
  matches: AutomationMatch[];
  pooledBeatmaps: AutomationBeatmap[];
}

export interface AutomationBeatmap {
  id: number;
  osuId: number;
}

export interface AutomationMatch {
  id: number;
  name: string;
  startTime: string | null;
  endTime: string | null;
  verificationStatus: VerificationStatus;
  rejectionReason: MatchRejectionReason;
  warningFlags: MatchWarningFlags;
  /** Set when the checks credit a new reviewer; otherwise the stored one stands. */
  verifiedByUserId?: number | null;
  games: AutomationGame[];
  rosters: AutomationMatchRoster[];
}

export interface AutomationMatchRoster {
  id: number;
  matchId: number;
  team: Team;
  roster: number[];
  score: number;
}

export interface AutomationGame {
  id: number;
  osuId: number;
  matchId: number;
  ruleset: Ruleset;
  scoringType: ScoringType;
  teamType: TeamType;
  mods: Mods;
  lazerMods: LazerMod[] | null;
  startTime: string;
  endTime: string;
  verificationStatus: VerificationStatus;
  rejectionReason: GameRejectionReason;
  warningFlags: GameWarningFlags;
  beatmap: AutomationBeatmap | null;
  scores: AutomationScore[];
  rosters: AutomationGameRoster[];
}

export interface AutomationGameRoster {
  id: number;
  gameId: number;
  team: Team;
  roster: number[];
  score: number;
}

export interface AutomationScore {
  id: number;
  score: number;
  mods: Mods;
  lazerMods: LazerMod[] | null;
  team: Team;
  ruleset: Ruleset;
  verificationStatus: VerificationStatus;
  rejectionReason: ScoreRejectionReason;
  playerId: number;
  gameId?: number;
}

export const enum PlaceholderDate {
  /** ISO timestamp representing a placeholder date before Unix epoch */
  MinValue = '0001-01-01T00:00:00.000Z',
}
