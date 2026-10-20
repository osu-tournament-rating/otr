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
