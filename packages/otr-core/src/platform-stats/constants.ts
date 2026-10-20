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
