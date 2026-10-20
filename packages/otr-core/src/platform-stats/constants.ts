/**
 * The numbers behind the stored statistics that the site also prints. This
 * module imports nothing, so client code can read it without pulling in the
 * database schema.
 */

/** How far back the statistics of recent matches and tournaments look. */
export const RECENT_MONTHS = 12;

/** Rows a list of match records keeps per ruleset. */
export const MATCH_RECORD_LIMIT = 5;

/**
 * Rated matches every player needs in the ruleset before an upset counts.
 * Players whose first rating was set too low would otherwise fill the list.
 */
export const UPSET_MIN_EARLIER_MATCHES = 10;

/** The width of a rating gap bucket. */
export const RATING_GAP_BUCKET_SIZE = 100;

/** Rating gap buckets per ruleset; the last holds every wider gap (500+). */
export const RATING_GAP_BUCKETS = 6;

/** How many of a tournament's highest-rated players make its field. */
export const FIELD_SIZE = 16;

/** Tournaments the strongest fields keep per ruleset. */
export const STRONGEST_FIELDS_LIMIT = 10;

/** Beatmaps the most played list keeps per ruleset. */
export const MOST_PLAYED_BEATMAPS_LIMIT = 10;

/** Mappers, and artists, the most played lists keep per ruleset. */
export const MOST_PLAYED_CREATORS_LIMIT = 5;

/**
 * Tournaments of the last 12 months a beatmap, mapper or artist must have
 * been played in to be listed. Below it, a small ruleset's list is a tie
 * between maps that two tournaments happened to share.
 */
export const MOST_PLAYED_MIN_TOURNAMENTS = 3;

/**
 * Tournaments a year's open rank, or rank-restricted, pools need before
 * their star ratings are charted; a year with fewer leaves a gap.
 */
export const POOL_DIFFICULTY_MIN_TOURNAMENTS = 5;
