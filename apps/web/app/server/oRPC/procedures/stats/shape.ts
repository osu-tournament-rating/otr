/**
 * Shapes the stats page's query rows into the compact per-ruleset entries
 * the page receives for every ruleset at once.
 */
import {
  RANK_RANGE_BUCKET_KEYS,
  type RankRangeBucketKey,
  getRankRangeBucketKey,
} from '@/lib/beatmaps/rankRange';
import type {
  CountryCountData,
  CountrySummaryData,
  MatchStartTimesData,
  RankRestrictionYearData,
} from '@/lib/orpc/schema/statsPage';

/** How many countries a country chart shows. */
export const COUNTRY_BAR_LIMIT = 10;

/**
 * One ruleset's players by country: the `COUNTRY_BAR_LIMIT` countries with
 * the most, most first (ties by code), and the totals over every country.
 */
export function summarizeCountries(
  rows: readonly CountryCountData[]
): CountrySummaryData {
  const sorted = [...rows].sort(
    (a, b) => b.players - a.players || a.country.localeCompare(b.country)
  );

  return {
    countries: sorted
      .slice(0, COUNTRY_BAR_LIMIT)
      .map(({ country, players }) => ({ country, players })),
    countryCount: rows.length,
    players: rows.reduce((sum, row) => sum + row.players, 0),
  };
}

/**
 * Verified tournaments per year in each rank restriction band, every band
 * present, oldest year first. The bands are the site's
 * (`RANK_RANGE_BUCKETS`): open rank, under 1,000, and the community's 4-,
 * 5- and 6-digit tournaments. A tournament counts in the band its lower
 * bound falls in.
 */
export function bandRankRestrictions(
  rows: readonly {
    year: number;
    rankRangeLowerBound: number;
    tournaments: number;
  }[]
): RankRestrictionYearData[] {
  const byYear = new Map<number, Record<RankRangeBucketKey, number>>();

  for (const row of rows) {
    const band = getRankRangeBucketKey(row.rankRangeLowerBound);
    if (band === null) continue;

    const bands =
      byYear.get(row.year) ??
      (Object.fromEntries(
        RANK_RANGE_BUCKET_KEYS.map((key) => [key, 0])
      ) as Record<RankRangeBucketKey, number>);
    bands[band] += row.tournaments;
    byYear.set(row.year, bands);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, bands]) => ({ year, bands }));
}

/**
 * One ruleset's matches by weekday and hour, every cell present: Monday
 * first, each day from 00:00 UTC.
 */
export function tabulateMatchStartTimes(
  rows: readonly { weekday: number; hour: number; matches: number }[]
): MatchStartTimesData {
  const weekdays = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );
  let matches = 0;

  for (const row of rows) {
    const day = weekdays[row.weekday - 1];
    if (!day || row.hour < 0 || row.hour > 23) continue;
    day[row.hour] = (day[row.hour] ?? 0) + row.matches;
    matches += row.matches;
  }

  return { matches, weekdays };
}
