/**
 * Shapes the stats page's query rows into the compact per-ruleset entries
 * the page receives for every ruleset at once.
 */
import type {
  CountryCountData,
  CountrySummaryData,
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
