import { sql, type AnyColumn, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { RatingAdjustmentType } from '../osu/enums';
import * as schema from './schema';

/**
 * A player with no verified match in a ruleset for this many days is
 * inactive in it. It is the processor's `DECAY_DAYS`, the point where their
 * rating starts to decay; the processor's contract tests check the two match.
 */
export const INACTIVE_AFTER_DAYS = 184;

/**
 * The player rating to look at: a column (`player_ratings.id`), an aliased
 * field of a subquery, or an ID.
 */
type PlayerRatingId = AnyColumn | SQLWrapper | number;

const MATCH = sql.raw(String(RatingAdjustmentType.Match));
const INACTIVE_INTERVAL = sql.raw(`interval '${INACTIVE_AFTER_DAYS} days'`);

// The subqueries name their columns through this alias. Drizzle writes the
// columns of a select from one table without the table's name, and an
// unqualified `id` would then match the adjustment's own id.
const ADJUSTMENT = sql.identifier('activity_adjustment');
const adjustment = (column: AnyPgColumn) =>
  sql`${ADJUSTMENT}.${sql.identifier(column.name)}`;

const matchAdjustmentsOf = (playerRatingId: PlayerRatingId) => sql`
  from ${schema.ratingAdjustments} as ${ADJUSTMENT}
  where ${adjustment(schema.ratingAdjustments.playerRatingId)} = ${playerRatingId}
    and ${adjustment(schema.ratingAdjustments.adjustmentType)} = ${MATCH}`;

/**
 * When the player's last verified match in the rating's ruleset ended: the
 * time of their latest Match adjustment, as the processor dates it, in ISO
 * 8601 UTC (`2026-10-07T12:00:00.000Z`). Null before their first match.
 */
export const lastMatchTimeSql = (playerRatingId: PlayerRatingId) =>
  sql<string | null>`to_char((
    select max(${adjustment(schema.ratingAdjustments.timestamp)})
    ${matchAdjustmentsOf(playerRatingId)}
  ) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Whether the player played a verified match in the rating's ruleset within
 * the last `INACTIVE_AFTER_DAYS` days. Like the processor's decay, a match
 * exactly that many days ago no longer counts.
 */
export const isActiveSql = (playerRatingId: PlayerRatingId): SQL =>
  sql`exists (
    select 1
    ${matchAdjustmentsOf(playerRatingId)}
      and ${adjustment(schema.ratingAdjustments.timestamp)} > now() - ${INACTIVE_INTERVAL}
  )`;
