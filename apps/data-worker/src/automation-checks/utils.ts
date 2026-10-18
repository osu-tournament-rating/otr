import {
  GameRejectionReason,
  MatchWarningFlags,
  Mods,
  Team,
  VerificationStatus,
} from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import type { AutomationGame, AutomationScore } from './types';

const INVALID_MODS = new Set<Mods>([
  Mods.SuddenDeath,
  Mods.Perfect,
  Mods.Relax,
  Mods.Autoplay,
  Mods.Relax2,
]);

/**
 * The lazer mods that make a score invalid: the stable set above, by its
 * lazer acronyms, plus Cinema. Every other lazer mod passes, fun mods
 * included, since lazer tournaments pool them. Settings are not checked.
 */
const INVALID_LAZER_MODS = new Set([
  // Autoplay
  'AT',
  // Cinema (lazer's acronym; stable uses CM)
  'CN',
  // Relax
  'RX',
  // Autopilot
  'AP',
  // Sudden Death
  'SD',
  // Perfect
  'PF',
]);

const PLACEHOLDER_THRESHOLD = new Date('1970-01-01T00:00:00.000Z').getTime();

export const isPlaceholderDate = (value: string | null | undefined) => {
  if (!value) {
    return true;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return parsed <= PLACEHOLDER_THRESHOLD;
};

export const isPreVerifiedOrVerified = (status: VerificationStatus) =>
  status === VerificationStatus.PreVerified ||
  status === VerificationStatus.Verified;

export const hasInvalidMods = (mods: Mods, lazerMods: LazerMod[] | null) =>
  Array.from(INVALID_MODS).some((flag) => (mods & flag) === flag) ||
  (lazerMods?.some((mod) => INVALID_LAZER_MODS.has(mod.acronym)) ?? false);

export const combineRejection = <T extends number>(current: T, next: T): T =>
  (current | next) as T;

export const addWarningFlag = <T extends number>(current: T, flag: T): T =>
  (current | flag) as T;

export const clearWarningFlags = <T extends number>(): T => 0 as T;

export const hasWarningFlag = (flags: number, flag: number) =>
  (flags & flag) === flag;

export const aggregateScoreRoster = (scores: AutomationScore[]) => {
  const teams = new Map<Team, Set<number>>();

  for (const score of scores) {
    const set = teams.get(score.team) ?? new Set<number>();
    set.add(score.playerId);
    teams.set(score.team, set);
  }

  return teams;
};

export const countValidScores = (scores: AutomationScore[]) =>
  scores.filter((score) => isPreVerifiedOrVerified(score.verificationStatus));

export const gameHasValidScores = (game: AutomationGame) =>
  countValidScores(game.scores).length > 0;

export const ensureTeamAssignments = (
  scores: AutomationScore[],
  assignments: Map<number, Team>
) => {
  for (const score of scores) {
    const assigned = assignments.get(score.playerId);
    if (assigned !== undefined) {
      score.team = assigned;
    }
  }
};

export const assignMatchWarning = (
  flags: MatchWarningFlags,
  flag: MatchWarningFlags
) => addWarningFlag(flags, flag);

export const addGameRejection = (
  rejection: GameRejectionReason,
  reason: GameRejectionReason
) => combineRejection(rejection, reason);

export const WITHOUT_REJECTIONS = (value: number) => value === 0;
