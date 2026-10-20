/**
 * Sentence-case names for the stored enums that people read, such as
 * rejection reasons in an audit diff. Keyed by the enum so a new member
 * fails the type check until it has a name. Verification status names live
 * in `@/lib/kit/status/verification` (`getVerificationStatusName`).
 */

import {
  FilteringFailReason,
  GameRejectionReason,
  GameWarningFlags,
  MatchRejectionReason,
  MatchWarningFlags,
  RatingAdjustmentType,
  ScoreGrade,
  ScoreRejectionReason,
  ScoringType,
  Team,
  TeamType,
  TournamentRejectionReason,
} from '@otr/core/osu';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue } from '@otr/core/jobs/enums';

import { EMPTY_VALUE } from './empty';

export type EnumLabels = Readonly<Record<number, string>>;

export const TOURNAMENT_REJECTION_REASON_LABELS: Readonly<
  Record<TournamentRejectionReason, string>
> = {
  [TournamentRejectionReason.None]: 'None',
  [TournamentRejectionReason.NoVerifiedMatches]: 'No verified matches',
  [TournamentRejectionReason.NotEnoughVerifiedMatches]:
    'Not enough verified matches',
  [TournamentRejectionReason.AbnormalWinCondition]: 'Abnormal win condition',
  [TournamentRejectionReason.AbnormalFormat]: 'Abnormal format',
  [TournamentRejectionReason.VaryingLobbySize]: 'Varying lobby size',
  [TournamentRejectionReason.IncompleteData]: 'Incomplete data',
};

export const MATCH_REJECTION_REASON_LABELS: Readonly<
  Record<MatchRejectionReason, string>
> = {
  [MatchRejectionReason.None]: 'None',
  [MatchRejectionReason.NoData]: 'No data',
  [MatchRejectionReason.NoGames]: 'No games',
  [MatchRejectionReason.NamePrefixMismatch]: 'Prefix mismatch',
  [MatchRejectionReason.FailedTeamVsConversion]: 'Failed Team Vs conversion',
  [MatchRejectionReason.NoValidGames]: 'No valid games',
  [MatchRejectionReason.UnexpectedGameCount]: 'Unexpected game count',
  [MatchRejectionReason.NoEndTime]: 'No end time',
  [MatchRejectionReason.RejectedTournament]: 'Rejected tournament',
};

export const MATCH_WARNING_FLAG_LABELS: Readonly<
  Record<MatchWarningFlags, string>
> = {
  [MatchWarningFlags.None]: 'None',
  [MatchWarningFlags.UnexpectedNameFormat]: 'Unexpected name format',
  [MatchWarningFlags.LowGameCount]: 'Low game count',
  [MatchWarningFlags.UnexpectedBeatmapsFound]:
    'Unpooled beatmap found beyond first two games',
  [MatchWarningFlags.OverlappingRosters]: 'Overlapping rosters found',
};

export const GAME_REJECTION_REASON_LABELS: Readonly<
  Record<GameRejectionReason, string>
> = {
  [GameRejectionReason.None]: 'None',
  [GameRejectionReason.NoScores]: 'No scores',
  [GameRejectionReason.InvalidMods]: 'Invalid mods',
  [GameRejectionReason.RulesetMismatch]: 'Ruleset mismatch',
  [GameRejectionReason.InvalidScoringType]: 'Invalid scoring type',
  [GameRejectionReason.InvalidTeamType]: 'Invalid team type',
  [GameRejectionReason.FailedTeamVsConversion]: 'Failed Team Vs conversion',
  [GameRejectionReason.NoValidScores]: 'No valid scores',
  [GameRejectionReason.LobbySizeMismatch]: 'Lobby size mismatch',
  [GameRejectionReason.NoEndTime]: 'No end time',
  [GameRejectionReason.RejectedMatch]: 'Rejected match',
  [GameRejectionReason.BeatmapNotPooled]: 'Beatmap not pooled',
};

export const GAME_WARNING_FLAG_LABELS: Readonly<
  Record<GameWarningFlags, string>
> = {
  [GameWarningFlags.None]: 'None',
  [GameWarningFlags.BeatmapUsedOnce]: 'Beatmap only used once',
};

export const SCORE_REJECTION_REASON_LABELS: Readonly<
  Record<ScoreRejectionReason, string>
> = {
  [ScoreRejectionReason.None]: 'None',
  [ScoreRejectionReason.ScoreBelowMinimum]: 'Below minimum score',
  [ScoreRejectionReason.InvalidMods]: 'Invalid mods',
  [ScoreRejectionReason.RulesetMismatch]: 'Ruleset mismatch',
  [ScoreRejectionReason.RejectedGame]: 'Rejected game',
};

export const SCORING_TYPE_LABELS: Readonly<Record<ScoringType, string>> = {
  [ScoringType.Score]: 'ScoreV1',
  [ScoringType.Accuracy]: 'Accuracy',
  [ScoringType.Combo]: 'Combo',
  [ScoringType.ScoreV2]: 'ScoreV2',
  [ScoringType.Lazer]: 'Lazer',
};

export const TEAM_TYPE_LABELS: Readonly<Record<TeamType, string>> = {
  [TeamType.HeadToHead]: 'Head to head',
  [TeamType.TagCoop]: 'Tag co-op',
  [TeamType.TeamVs]: 'Team Vs',
  [TeamType.TagTeamVs]: 'Tag team Vs',
};

export const TEAM_LABELS: Readonly<Record<Team, string>> = {
  [Team.NoTeam]: 'No team',
  [Team.Blue]: 'Blue',
  [Team.Red]: 'Red',
};

export const SCORE_GRADE_LABELS: Readonly<Record<ScoreGrade, string>> = {
  [ScoreGrade.SSH]: 'SSH',
  [ScoreGrade.SH]: 'SH',
  [ScoreGrade.SS]: 'SS',
  [ScoreGrade.S]: 'S',
  [ScoreGrade.A]: 'A',
  [ScoreGrade.B]: 'B',
  [ScoreGrade.C]: 'C',
  [ScoreGrade.D]: 'D',
};

export const DATA_FETCH_STATUS_LABELS: Readonly<
  Record<DataFetchStatus, string>
> = {
  [DataFetchStatus.NotFetched]: 'Not fetched',
  [DataFetchStatus.Fetching]: 'Fetching',
  [DataFetchStatus.Fetched]: 'Fetched',
  [DataFetchStatus.NotFound]: 'Not found',
  [DataFetchStatus.Error]: 'Error',
};

/** The kinds of change in a player's rating history. */
export const RATING_ADJUSTMENT_TYPE_LABELS: Readonly<
  Record<RatingAdjustmentType, string>
> = {
  [RatingAdjustmentType.Initial]: 'Initial',
  [RatingAdjustmentType.Decay]: 'Decay',
  [RatingAdjustmentType.Match]: 'Match',
  [RatingAdjustmentType.VolatilityDecay]: 'Volatility decay',
};

/** Why a player failed the filter tool's criteria: a short name per flag. */
export const FILTERING_FAIL_REASON_LABELS: Readonly<
  Record<FilteringFailReason, string>
> = {
  [FilteringFailReason.None]: 'None',
  [FilteringFailReason.MinRating]: 'Low rating',
  [FilteringFailReason.MaxRating]: 'High rating',
  [FilteringFailReason.NotEnoughTournaments]: 'Low tournaments',
  [FilteringFailReason.PeakRatingTooHigh]: 'High peak',
  [FilteringFailReason.NotEnoughMatches]: 'Low matches',
  [FilteringFailReason.TooManyMatches]: 'High matches',
  [FilteringFailReason.TooManyTournaments]: 'High tournaments',
};

/** The sentence behind each filter failure name, for its tooltip. */
export const FILTERING_FAIL_REASON_DESCRIPTIONS: Readonly<
  Record<FilteringFailReason, string>
> = {
  [FilteringFailReason.None]: 'No failure reason',
  [FilteringFailReason.MinRating]: 'Rating below the minimum',
  [FilteringFailReason.MaxRating]: 'Rating above the maximum',
  [FilteringFailReason.NotEnoughTournaments]:
    'Fewer tournaments than the minimum',
  [FilteringFailReason.PeakRatingTooHigh]: 'Peak rating above the maximum',
  [FilteringFailReason.NotEnoughMatches]: 'Fewer matches than the minimum',
  [FilteringFailReason.TooManyMatches]: 'More matches than the maximum',
  [FilteringFailReason.TooManyTournaments]: 'More tournaments than the maximum',
};

/** The osu! API's beatmap `ranked` values; o!TR stores them as they come. */
export const RANKED_STATUS_LABELS: EnumLabels = {
  [-2]: 'Graveyard',
  [-1]: 'WIP',
  0: 'Pending',
  1: 'Ranked',
  2: 'Approved',
  3: 'Qualified',
  4: 'Loved',
};

/** Background job queues (`jobs.queue`), by the work each one does. */
export const JOB_QUEUE_LABELS: Readonly<Record<JobQueue, string>> = {
  [JobQueue.OsuFetch]: 'osu! fetches',
  [JobQueue.OsuTrackFetch]: 'osu!track fetches',
  [JobQueue.TournamentChecks]: 'Automated checks',
  [JobQueue.TournamentStats]: 'Tournament stats',
  [JobQueue.BeatmapAttributes]: 'Beatmap attributes',
};

/** The services outbound requests go to (`api_request_stats_daily.service`). */
export const API_SERVICE_LABELS: Readonly<Record<string, string>> = {
  osu: 'osu!',
  osutrack: 'osu!track',
};

/** The worker's request metric endpoints (`api_request_stats_daily.endpoint`). */
export const API_ENDPOINT_LABELS: Readonly<Record<string, string>> = {
  getMatch: 'Match',
  getRoomEvents: 'Room events',
  getBeatmap: 'Beatmap',
  getBeatmapset: 'Beatmapset',
  getUser: 'User',
  getForumTopic: 'Forum topic',
  beatmapFile: 'Beatmap file',
  statsHistory: 'Stats history',
};

/** The worker's request metric statuses (`api_request_stats_daily.status`). */
export const API_REQUEST_STATUS_LABELS: Readonly<Record<string, string>> = {
  success: 'Success',
  not_found: 'Not found',
  unauthorized: 'Unauthorized',
  rate_limited: 'Rate limited',
  invalid: 'Invalid',
  error: 'Error',
};

/**
 * The name of a stored text value, or the value itself when it has none, so
 * an endpoint or queue added after this release still reads.
 */
export function formatTextValue(
  value: string,
  labels: Readonly<Record<string, string>>
): string {
  return Object.hasOwn(labels, value) ? labels[value]! : value;
}

/** The name of one enum value, or `Unknown (7)` for a value with none. */
export function formatEnumValue(value: number, labels: EnumLabels): string {
  return labels[value] ?? `Unknown (${value})`;
}

/** The single-bit keys of a label table, lowest first. */
function namedFlags(labels: EnumLabels): number[] {
  return Object.keys(labels)
    .map(Number)
    .filter((flag) => flag > 0 && (flag & (flag - 1)) === 0)
    .sort((left, right) => left - right);
}

/**
 * The named flags set in a bitflag value, in bit order, so a caller can look
 * each one up in several tables (a name and a description). Bits with no
 * name are left out; zero, negative and fractional values give an empty list.
 */
export function getSetFlags<Flag extends number>(
  value: number,
  labels: Readonly<Record<Flag, string>>
): Flag[] {
  if (!Number.isInteger(value) || value <= 0) return [];
  return namedFlags(labels).filter((flag) => (value & flag) !== 0) as Flag[];
}

/**
 * The name of every flag set in a bitflag value, in bit order: `['No scores',
 * 'Invalid mods']`. Bits with no name read `Unknown (64)`. Zero, negative and
 * fractional values give an empty list.
 */
export function getFlagLabels(value: number, labels: EnumLabels): string[] {
  const flags = getSetFlags(value, labels);
  const names = flags.map((flag) => labels[flag]);

  if (Number.isInteger(value) && value > 0) {
    const unknown = flags.reduce((rest, flag) => rest & ~flag, value);
    if (unknown !== 0) names.push(`Unknown (${unknown})`);
  }

  return names;
}

/**
 * Every flag set in a bitflag value, joined: `No scores, Invalid mods`. Zero
 * reads as the `0` label (usually `None`).
 */
export function formatFlags(value: number, labels: EnumLabels): string {
  if (!Number.isInteger(value) || value < 0) return EMPTY_VALUE;
  if (value === 0) return labels[0] ?? 'None';

  return getFlagLabels(value, labels).join(', ');
}
