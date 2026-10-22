export enum AdminNoteRouteTarget {
  Game = 'game',
  GameScore = 'gamescore',
  Match = 'match',
  OAuthClient = 'oauthclient',
  Player = 'player',
  Tournament = 'tournament',
}

export enum FilteringFailReason {
  None = 0,
  MinRating = 1,
  MaxRating = 2,
  NotEnoughTournaments = 4,
  PeakRatingTooHigh = 8,
  NotEnoughMatches = 16,
  TooManyMatches = 32,
  TooManyTournaments = 64,
}

export enum GameRejectionReason {
  None = 0,
  NoScores = 1,
  InvalidMods = 2,
  RulesetMismatch = 4,
  InvalidScoringType = 8,
  InvalidTeamType = 16,
  FailedTeamVsConversion = 32,
  NoValidScores = 64,
  LobbySizeMismatch = 128,
  NoEndTime = 256,
  RejectedMatch = 512,
  BeatmapNotPooled = 1024,
}

export enum GameWarningFlags {
  None = 0,
  BeatmapUsedOnce = 1,
}

export enum MatchRejectionReason {
  None = 0,
  NoData = 1,
  NoGames = 2,
  NamePrefixMismatch = 4,
  FailedTeamVsConversion = 8,
  NoValidGames = 16,
  UnexpectedGameCount = 32,
  NoEndTime = 64,
  RejectedTournament = 128,
}

export enum MatchWarningFlags {
  None = 0,
  UnexpectedNameFormat = 1,
  LowGameCount = 2,
  UnexpectedBeatmapsFound = 4,
  OverlappingRosters = 8,
}

export enum Mods {
  None = 0,
  NoFail = 1,
  Easy = 2,
  TouchDevice = 4,
  Hidden = 8,
  HardRock = 16,
  SuddenDeath = 32,
  DoubleTime = 64,
  Relax = 128,
  HalfTime = 256,
  Nightcore = 512,
  Flashlight = 1024,
  Autoplay = 2048,
  SpunOut = 4096,
  Relax2 = 8192,
  Perfect = 16384,
  InvalidMods = 22688,
  Key4 = 32768,
  Key5 = 65536,
  Key6 = 131072,
  Key7 = 262144,
  Key8 = 524288,
  FadeIn = 1048576,
  ScoreIncreaseMods = 1049688,
  Random = 2097152,
  Cinema = 4194304,
  Target = 8388608,
  Key9 = 16777216,
  KeyCoop = 33554432,
  Key1 = 67108864,
  Key3 = 134217728,
  Key2 = 268435456,
  KeyMod = 521109504,
  FreeModAllowed = 522171579,
  ScoreV2 = 536870912,
  Mirror = 1073741824,
}

export enum RatingAdjustmentType {
  Initial = 0,
  Decay = 1,
  Match = 2,
  VolatilityDecay = 3,
}

export enum Roles {
  User = 'user',
  Client = 'client',
  Admin = 'admin',
  Verifier = 'verifier',
  Submit = 'submit',
  Whitelist = 'whitelist',
}

export enum Ruleset {
  Osu = 0,
  Taiko = 1,
  Catch = 2,
  ManiaOther = 3,
  Mania4k = 4,
  Mania7k = 5,
}

export enum ScoreGrade {
  SSH = 0,
  SH = 1,
  SS = 2,
  S = 3,
  A = 4,
  B = 5,
  C = 6,
  D = 7,
}

export enum ScoreRejectionReason {
  None = 0,
  ScoreBelowMinimum = 1,
  InvalidMods = 2,
  RulesetMismatch = 4,
  RejectedGame = 8,
}

export enum ScoringType {
  Score = 0,
  Accuracy = 1,
  Combo = 2,
  ScoreV2 = 3,
  Lazer = 4,
}

export enum Team {
  NoTeam = 0,
  Blue = 1,
  Red = 2,
}

export enum TeamType {
  HeadToHead = 0,
  TagCoop = 1,
  TeamVs = 2,
  TagTeamVs = 3,
}

export enum TournamentRejectionReason {
  None = 0,
  NoVerifiedMatches = 1,
  NotEnoughVerifiedMatches = 2,
  AbnormalWinCondition = 4,
  AbnormalFormat = 8,
  VaryingLobbySize = 16,
  IncompleteData = 32,
}

export enum TournamentQuerySortType {
  Id = 0,
  StartTime = 1,
  EndTime = 2,
  /**
   * Best `searchQuery` match first. The public `GET /tournaments?sort=3` uses
   * it, so it stays and keeps its number.
   */
  SearchQueryRelevance = 3,
  SubmissionDate = 4,
  LobbySize = 5,
}

export enum VerificationStatus {
  None = 0,
  PreRejected = 1,
  PreVerified = 2,
  Rejected = 3,
  Verified = 4,
}

export enum ReportEntityType {
  Tournament = 0,
  Match = 1,
  Game = 2,
  Score = 3,
}

export enum ReportStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
}

/**
 * Where a held request stands: a tournament submission from a non-admin, or
 * a registrant filter request flagged for unknown players. Stored in
 * `tournament_submissions.status` and `filter_requests.status`.
 */
export enum ApprovalStatus {
  Pending = 0,
  Approved = 1,
  Denied = 2,
}

export enum AuditActionType {
  Created = 0,
  Updated = 1,
  Deleted = 2,
}

export enum AuditEntityType {
  Tournament = 0,
  Match = 1,
  Game = 2,
  Score = 3,
  Beatmap = 4,
}

export type BitwiseEnum = number;
