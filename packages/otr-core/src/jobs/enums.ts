/** Persisted in jobs.status. Never renumber, and never compare with < or >. */
export enum JobStatus {
  /** Waiting to be claimed, including a failed attempt waiting to retry. */
  Pending = 0,
  Running = 1,
  Succeeded = 2,
  /** Out of attempts, or failed in a way a retry can't fix. */
  Failed = 3,
  /** Cancelled by an admin before it ran, or dropped by its handler. */
  Cancelled = 4,
}

/**
 * Persisted in jobs.queue. The processor inserts TournamentStats jobs with raw
 * SQL, so that value is a contract with it.
 */
export enum JobQueue {
  OsuFetch = 'data.osu',
  OsuTrackFetch = 'data.osutrack',
  TournamentChecks = 'processing.checks.tournaments',
  TournamentStats = 'processing.stats.tournaments',
  BeatmapAttributes = 'processing.attributes.beatmaps',
  PlatformStats = 'processing.stats.platform',
}
