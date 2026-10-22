/**
 * Shapes the platform stats response into chart rows. Pure, so the server
 * and client agree and the rules are unit-tested.
 */
import { Ruleset, Team, type VerificationStatus } from '@otr/core/osu';

import { parseTeamNames } from '@/components/tournaments/matchRow';
import type { CountBarDatum } from '@/lib/kit/charts/count-bars';
import type { StackedBarDatum } from '@/lib/kit/charts/stacked-bars';
import { getNiceTicks, type NiceTicks } from '@/lib/kit/charts/ticks';
import { getStatusHueColor } from '@/lib/kit/color/verification';
import { getTierColor } from '@/lib/kit/color/tiers';
import { EMPTY_VALUE } from '@/lib/kit/format/empty';
import { formatLobbySize } from '@/lib/kit/format/fields';
import {
  formatCount,
  formatCountOf,
  formatYear,
} from '@/lib/kit/format/number';
import { RATED_RULESETS, getRulesetLabel } from '@/lib/kit/format/ruleset';
import { RATINGS_GROUPS } from '@/lib/kit/status/verification';
import type { VerificationStatusKey } from '@/lib/orpc/schema/stats';
import type {
  ActivePlayersData,
  CountryCountData,
  FreemodModsSummaryData,
  HigherRatedWinsData,
  LazerYearData,
  MatchRecordData,
  PoolDifficultyData,
  RankRestrictionYearData,
} from '@/lib/orpc/schema/statsPage';
import {
  getTierFromRating,
  type TierName,
  tierNames,
} from '@/lib/utils/tierData';

export function sumCounts(bars: readonly { count: number }[]): number {
  return bars.reduce((sum, bar) => sum + bar.count, 0);
}

function countOf(record: Record<string, number>, key: number): number {
  const value = record[String(key)];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Every tournament in the three ratings groups: Verified, "Not in ratings
 * yet" (Pending, Pre-verified and Pre-rejected) and Rejected, in that order.
 */
export function getVerificationBars(
  counts: Partial<Record<VerificationStatusKey, number>>
): CountBarDatum[] {
  const record = counts as Record<string, number>;
  return RATINGS_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    count: group.statuses.reduce(
      (sum, status: VerificationStatus) => sum + countOf(record, status),
      0
    ),
    fill: getStatusHueColor(group.hue),
  }));
}

/** Integer keys of a stats record, ignoring anything that is not one. */
function integerKeys(record: Record<string, number>): number[] {
  return Object.keys(record)
    .map((key) => Number(key))
    .filter(Number.isInteger);
}

/**
 * Verified tournaments per year, oldest first. Years without a tournament
 * between the first and the last are kept as zero, so the axis has no gaps.
 */
export function getYearBars(data: Record<string, number>): CountBarDatum[] {
  const years = integerKeys(data);
  if (years.length === 0) return [];

  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const year = first + index;
    return {
      key: String(year),
      label: formatYear(year),
      count: countOf(data, year),
    };
  });
}

/**
 * Verified tournaments per ruleset in the site's ruleset order. The five
 * rated rulesets always show; mania (other) only when it has tournaments.
 */
export function getRulesetBars(data: Record<string, number>): CountBarDatum[] {
  const rulesets = [
    ...RATED_RULESETS,
    ...(countOf(data, Ruleset.ManiaOther) > 0 ? [Ruleset.ManiaOther] : []),
  ];
  return rulesets.map((ruleset) => ({
    key: String(ruleset),
    label: getRulesetLabel(ruleset),
    count: countOf(data, ruleset),
  }));
}

/**
 * Verified tournaments per lobby size, from 1v1 to the largest size with a
 * tournament. Sizes in between with none are kept as zero.
 */
export function getLobbySizeBars(
  data: Record<string, number>
): CountBarDatum[] {
  const sizes = integerKeys(data).filter((size) => size >= 1);
  if (sizes.length === 0) return [];

  const largest = Math.max(...sizes);
  return Array.from({ length: largest }, (_, index) => {
    const size = index + 1;
    return {
      key: String(size),
      label: formatLobbySize(size),
      count: countOf(data, size),
    };
  });
}

/** One rating bucket of the distribution. */
export interface RatingBucket {
  /** The bucket's lowest rating, a multiple of the bucket size. */
  rating: number;
  count: number;
  tier: TierName;
  subTier: number | undefined;
  /** The tier's colour, for the bar and the tooltip marker. */
  fill: string;
  /** Share of players at or below this bucket, 0–1. */
  cumulative: number;
}

export interface RatingDistribution {
  buckets: RatingBucket[];
  totalPlayers: number;
  /** Tiers with a bucket in the data, lowest first, for the legend. */
  tiers: TierName[];
}

/**
 * Players per rating bucket, lowest first, with empty buckets between the
 * lowest and highest rating filled in as zero.
 */
export function getRatingDistribution(
  ratings: Record<string, number>,
  bucketSize: number
): RatingDistribution {
  const starts = integerKeys(ratings);
  if (starts.length === 0) return { buckets: [], totalPlayers: 0, tiers: [] };

  const first = Math.floor(Math.min(...starts) / bucketSize) * bucketSize;
  const last = Math.max(...starts);
  const totalPlayers = starts.reduce(
    (sum, start) => sum + countOf(ratings, start),
    0
  );

  const buckets: RatingBucket[] = [];
  let runningCount = 0;
  for (let rating = first; rating <= last; rating += bucketSize) {
    const count = countOf(ratings, rating);
    runningCount += count;
    const { tier, subTier } = getTierFromRating(rating);
    buckets.push({
      rating,
      count,
      tier,
      subTier,
      fill: getTierColor(tier),
      cumulative: totalPlayers > 0 ? runningCount / totalPlayers : 0,
    });
  }

  const present = new Set(buckets.map((bucket) => bucket.tier));
  return {
    buckets,
    totalPlayers,
    tiers: tierNames.filter((tier) => present.has(tier)),
  };
}

/** The bucket a rating falls in, by its lowest rating. */
export function getRatingBucketStart(rating: number, bucketSize: number) {
  return Math.floor(rating / bucketSize) * bucketSize;
}

/**
 * The distribution's two value axes on one set of gridlines: players on the
 * left by the shared tick rule, and the cumulative share on the right,
 * labelling the same lines from 0% to 100%. Three steps would label them
 * 33% and 67%, so a players axis with three gains a fourth.
 */
export function getRatingDistributionAxes(maxCount: number): {
  count: NiceTicks;
  share: NiceTicks;
} {
  const nice = getNiceTicks(0, maxCount, { integer: true });
  const count =
    nice.ticks.length === 4
      ? {
          ...nice,
          max: nice.max + nice.step,
          ticks: [...nice.ticks, nice.max + nice.step],
        }
      : nice;
  const steps = count.ticks.length - 1;

  return {
    count,
    share: {
      min: 0,
      max: 1,
      step: 1 / steps,
      ticks: count.ticks.map((_, index) => index / steps),
    },
  };
}

/**
 * Trend charts start at the first year in which every ruleset together has
 * at least this many verified tournaments. The years before it hold one or
 * two tournaments each, from before rated data begins around 2018.
 */
export const TREND_MIN_TOURNAMENTS = 10;

/**
 * The first year of every trend chart: the first year in which the site's
 * verified tournaments, every ruleset together, reach
 * `TREND_MIN_TOURNAMENTS`. Null when no year does.
 *
 * Every ruleset's charts start here, so a small ruleset keeps its early
 * years. The share charts' tooltips give each year's count, which shows
 * when a year rests on a few tournaments.
 */
export function getTrendStartYear(
  totals: Readonly<Record<string, number>>
): number | null {
  const years = Object.entries(totals)
    .filter(([, count]) => count >= TREND_MIN_TOURNAMENTS)
    .map(([year]) => Number(year))
    .filter(Number.isInteger);

  return years.length > 0 ? Math.min(...years) : null;
}

/**
 * The years a trend chart covers: from its first year with data at or
 * after `startYear` to its last year with data, every year in between
 * included. Empty when there is no start year or no data from it on.
 */
export function getTrendYears(
  totals: ReadonlyMap<number, number>,
  startYear: number | null
): number[] {
  if (startYear === null) return [];

  const years = [...totals.entries()]
    .filter(([year, count]) => year >= startYear && count > 0)
    .map(([year]) => year)
    .sort((a, b) => a - b);
  const first = years[0];
  const last = years.at(-1);
  if (first === undefined || last === undefined) return [];

  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/**
 * The share of verified tournaments played on osu!lazer, per year, over the
 * trend years. Null when no verified tournament was on lazer, which the
 * panel shows as an empty state rather than a flat line at 0%.
 */
export function getLazerShareBars(
  rows: readonly LazerYearData[],
  startYear: number | null
): StackedBarDatum[] | null {
  if (!rows.some((row) => row.lazer > 0)) return null;

  const byYear = new Map(rows.map((row) => [row.year, row]));
  const totals = new Map(rows.map((row) => [row.year, row.total]));

  return getTrendYears(totals, startYear).map((year) => ({
    key: String(year),
    label: formatYear(year),
    values: { lazer: byYear.get(year)?.lazer ?? 0 },
    total: byYear.get(year)?.total ?? 0,
  }));
}

/**
 * Each year's verified tournaments per rank restriction band as stacked
 * columns, over the trend years.
 */
export function getRankRestrictionBars(
  years: readonly RankRestrictionYearData[],
  startYear: number | null
): StackedBarDatum[] {
  const byYear = new Map(years.map((entry) => [entry.year, entry.bands]));
  const totals = new Map(
    years.map((entry) => [
      entry.year,
      Object.values(entry.bands).reduce((sum, value) => sum + value, 0),
    ])
  );

  return getTrendYears(totals, startYear).map((year) => ({
    key: String(year),
    label: formatYear(year),
    values: byYear.get(year) ?? {},
  }));
}

/**
 * A ruleset's leading countries, in the server's order (most players
 * first), labelled with their names. `names` comes from the server
 * (`getCountryNames`).
 */
export function getCountryBars(
  rows: readonly CountryCountData[],
  names: Readonly<Record<string, string>>
): CountBarDatum[] {
  return rows.map((row) => ({
    key: row.country,
    label: names[row.country] ?? row.country,
    count: row.players,
  }));
}

/** A median time to verify: `4 days`, `1 day`, or `Under a day`. */
export function formatDaysToVerify(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return EMPTY_VALUE;
  if (days < 1) return 'Under a day';
  return formatCountOf(Math.round(days), 'day');
}

/**
 * The share of matches the higher-rated side won in each rating gap bucket,
 * labelled `0–100` to `500+`: one series out of each bucket's matches.
 */
export function getRatingGapBars(
  buckets: HigherRatedWinsData['buckets']
): StackedBarDatum[] {
  return buckets.map((bucket, index) => {
    const next = buckets[index + 1];
    return {
      key: String(bucket.minGap),
      label: next
        ? `${formatCount(bucket.minGap)}–${formatCount(next.minGap)}`
        : `${formatCount(bucket.minGap)}+`,
      values: { higherRated: bucket.higherRatedWins },
      total: bucket.matches,
    };
  });
}

/**
 * A listed match's two sides, winner first, from a name such as
 * `OWC: (Japan) vs (Korea)`, where red is the first. Null for a name in
 * another form, which the row shows as it is.
 */
export function getMatchSides(
  match: Pick<MatchRecordData, 'matchName' | 'winnerTeam'>
): { winner: string; loser: string } | null {
  const teams = parseTeamNames(match.matchName);
  if (!teams) return null;

  return match.winnerTeam === Team.Blue
    ? { winner: teams.blue, loser: teams.red }
    : { winner: teams.red, loser: teams.blue };
}

/**
 * Each year's active players over the trend years, split into those new to
 * the ruleset and those who played in an earlier year.
 */
export function getActivePlayerBars(
  years: ActivePlayersData['years'],
  startYear: number | null
): StackedBarDatum[] {
  const byYear = new Map(years.map((entry) => [entry.year, entry]));
  const totals = new Map(years.map((entry) => [entry.year, entry.tournaments]));

  return getTrendYears(totals, startYear).map((year) => {
    const entry = byYear.get(year);
    return {
      key: String(year),
      label: formatYear(year),
      values: {
        returning: entry ? entry.players - entry.newPlayers : 0,
        new: entry?.newPlayers ?? 0,
      },
    };
  });
}

/** One year of the pool difficulty chart; null where a group has too few tournaments. */
export interface PoolDifficultyRow {
  year: number;
  label: string;
  openMedian: number | null;
  openP90: number | null;
  restrictedMedian: number | null;
  restrictedP90: number | null;
  openMaps: number;
  restrictedMaps: number;
}

/**
 * Nomod star ratings per year over the trend years. A group's point needs
 * `minTournaments` tournaments that year, or it is left as a gap. Empty
 * when no year has a point.
 */
export function getPoolDifficultyRows(
  years: PoolDifficultyData['years'],
  startYear: number | null,
  minTournaments: number
): PoolDifficultyRow[] {
  const byYear = new Map(years.map((entry) => [entry.year, entry]));
  const totals = new Map(years.map((entry) => [entry.year, entry.tournaments]));
  const enough = (point: PoolDifficultyData['years'][number]['open']) =>
    point && point.tournaments >= minTournaments ? point : null;

  const rows = getTrendYears(totals, startYear).map((year) => {
    const entry = byYear.get(year);
    const open = enough(entry?.open ?? null);
    const restricted = enough(entry?.restricted ?? null);
    return {
      year,
      label: formatYear(year),
      openMedian: open?.median ?? null,
      openP90: open?.p90 ?? null,
      restrictedMedian: restricted?.median ?? null,
      restrictedP90: restricted?.p90 ?? null,
      openMaps: open?.maps ?? 0,
      restrictedMaps: restricted?.maps ?? 0,
    };
  });

  return rows.some(
    (row) => row.openMedian !== null || row.restrictedMedian !== null
  )
    ? rows
    : [];
}

/**
 * The mods picked on freemod maps per year, over the trend years, each
 * year's columns out of its freemod scores. A year without freemod games
 * draws no column.
 */
export function getFreemodModBars(
  summary: FreemodModsSummaryData,
  startYear: number | null
): StackedBarDatum[] {
  const byYear = new Map(summary.years.map((entry) => [entry.year, entry]));
  const totals = new Map(
    summary.years.map((entry) => [entry.year, entry.tournaments])
  );

  return getTrendYears(totals, startYear).map((year) => {
    const entry = byYear.get(year);
    return {
      key: String(year),
      label: formatYear(year),
      values: entry?.values ?? {},
      total: entry?.scores ?? 0,
    };
  });
}

/** The heatmap's rows: ISO weekdays, Monday first, as UTC counts them. */
export const WEEKDAYS = [
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
  { short: 'Sun', long: 'Sunday' },
] as const;

/** The heatmap's columns: the hours of a UTC day. */
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** An hour of the UTC day: `14:00–15:00 UTC`, and `23:00–00:00 UTC` at midnight. */
export function formatHourRange(hour: number): string {
  const pad = (value: number) => `${String(value % 24).padStart(2, '0')}:00`;
  return `${pad(hour)}–${pad(hour + 1)} UTC`;
}
