/**
 * The platform stats page's statistics that are fast enough to read on every
 * request (each well under 100 ms on production's data). Slower ones are
 * stored by the data worker; see `@otr/core/platform-stats`.
 */
import { sql, type SQL } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { type Ruleset, VerificationStatus } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';

type QueryDb = Pick<DatabaseClient, 'execute'>;

const VERIFIED = VerificationStatus.Verified;

/** How far back the median time to verify looks, from the newest verification. */
export const VERIFICATION_WINDOW_DAYS = 90;

const rowsOf = async <TRow>(db: QueryDb, query: SQL): Promise<TRow[]> =>
  (await db.execute(query)).rows as TRow[];

/** A UTC timestamp as an ISO 8601 string, in SQL, so no driver parses it. */
const isoTimestamp = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Every audit row that set a tournament to Verified, at millisecond
 * precision. The audit trail has written the change three ways over time.
 */
const verificationEvents = () => {
  const verifiedChange = (field: string, value: string) =>
    sql`${schema.tournamentAudits.changes} @> ${JSON.stringify({
      [field]: { [value]: VERIFIED },
    })}::jsonb`;

  return sql`
    select
      ${schema.tournamentAudits.referenceIdLock} as tournament_id,
      date_trunc('milliseconds', ${schema.tournamentAudits.created}) as verified_at
    from ${schema.tournamentAudits}
    where ${verifiedChange('verification_status', 'newValue')}
      or ${verifiedChange('verificationStatus', 'newValue')}
      or ${verifiedChange('verificationStatus', 'NewValue')}`;
};

export interface VerificationSummary {
  windowDays: number;
  /** Tournaments first verified in the window. */
  tournaments: number;
  /** Median days from their end to their first verification; null for none. */
  medianDays: number | null;
}

/**
 * How fast verification happens lately: the median time from a verified
 * tournament's end to its first verification, over tournaments first
 * verified in the 90 days up to the newest verification. A tournament
 * verified before it ended counts as zero days; one without an end is left
 * out. Re-verifications don't count, since only the first one does.
 */
export async function getVerificationSummary(
  db: QueryDb
): Promise<VerificationSummary> {
  const [row] = await rowsOf<{
    tournaments: string;
    median_days: number | null;
  }>(
    db,
    sql`
      with events as (${verificationEvents()}),
      firsts as (
        select tournament_id, min(verified_at) as first_at
        from events
        group by tournament_id
      ),
      verified as (
        select
          firsts.first_at,
          greatest(
            0,
            extract(epoch from firsts.first_at - ${schema.tournaments.endTime}) / 86400
          ) as days
        from firsts
        inner join ${schema.tournaments}
          on ${schema.tournaments.id} = firsts.tournament_id
        where ${schema.tournaments.verificationStatus} = ${VERIFIED}
          and ${schema.tournaments.endTime} is not null
      )
      select
        count(*) as tournaments,
        percentile_cont(0.5) within group (order by days) as median_days
      from verified
      where first_at > (select max(first_at) from verified)
        - make_interval(days => ${VERIFICATION_WINDOW_DAYS})`
  );

  return {
    windowDays: VERIFICATION_WINDOW_DAYS,
    tournaments: Number(row?.tournaments ?? 0),
    medianDays:
      row?.median_days === null || row?.median_days === undefined
        ? null
        : Number(row.median_days),
  };
}

export interface RecentlyVerifiedTournament {
  id: number;
  name: string;
  abbreviation: string;
  ruleset: Ruleset;
  lobbySize: number;
  rankRangeLowerBound: number;
  isLazer: boolean;
  /** ISO 8601, UTC; null when the tournament has no end. */
  endTime: string | null;
  /** The latest verification, ISO 8601, UTC. */
  verifiedAt: string;
}

export interface RecentlyVerifiedCursor {
  verifiedAt: string;
  id: number;
}

export interface RecentlyVerifiedPage {
  items: RecentlyVerifiedTournament[];
  /** Verified tournaments the audit trail records a verification for. */
  totalCount: number;
  /** Where the next page starts; null after the last. */
  nextCursor: RecentlyVerifiedCursor | null;
}

/**
 * Verified tournaments, most recently verified first, each at its latest
 * verification. Tournaments verified before the audit trail began have no
 * verification on record and are left out. Pages by keyset, so a
 * verification between two pages neither repeats nor skips a row.
 */
export async function getRecentlyVerified(
  db: QueryDb,
  { limit, cursor }: { limit: number; cursor?: RecentlyVerifiedCursor }
): Promise<RecentlyVerifiedPage> {
  const rows = await rowsOf<{
    id: number;
    name: string;
    abbreviation: string;
    ruleset: number;
    lobby_size: number;
    rank_range_lower_bound: number;
    is_lazer: boolean;
    end_time: string | null;
    verified_at: string;
    total: string;
  }>(
    db,
    sql`
      with events as (${verificationEvents()}),
      latest as (
        select distinct on (tournament_id) tournament_id, verified_at
        from events
        order by tournament_id, verified_at desc
      ),
      feed as (
        select
          ${schema.tournaments.id} as id,
          ${schema.tournaments.name} as name,
          ${schema.tournaments.abbreviation} as abbreviation,
          ${schema.tournaments.ruleset} as ruleset,
          ${schema.tournaments.lobbySize} as lobby_size,
          ${schema.tournaments.rankRangeLowerBound} as rank_range_lower_bound,
          ${schema.tournaments.isLazer} as is_lazer,
          ${schema.tournaments.endTime} as end_time_raw,
          latest.verified_at,
          count(*) over () as total
        from latest
        inner join ${schema.tournaments}
          on ${schema.tournaments.id} = latest.tournament_id
        where ${schema.tournaments.verificationStatus} = ${VERIFIED}
      )
      select
        id, name, abbreviation, ruleset, lobby_size, rank_range_lower_bound,
        is_lazer, total,
        ${isoTimestamp(sql`end_time_raw`)} as end_time,
        ${isoTimestamp(sql`verified_at`)} as verified_at
      from feed
      ${
        cursor
          ? sql`where (verified_at, id) < (${cursor.verifiedAt}::timestamptz, ${cursor.id})`
          : sql``
      }
      order by feed.verified_at desc, id desc
      limit ${limit + 1}`
  );

  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    ruleset: row.ruleset as Ruleset,
    lobbySize: row.lobby_size,
    rankRangeLowerBound: row.rank_range_lower_bound,
    isLazer: row.is_lazer,
    endTime: row.end_time,
    verifiedAt: row.verified_at,
  }));
  const last = items.at(-1);

  return {
    items,
    totalCount: Number(rows[0]?.total ?? 0),
    nextCursor:
      rows.length > limit && last
        ? { verifiedAt: last.verifiedAt, id: last.id }
        : null,
  };
}
