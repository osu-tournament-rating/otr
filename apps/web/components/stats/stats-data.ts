/**
 * Shapes the platform stats response into chart rows. Pure, so the server
 * and client agree and the rules are unit-tested.
 */
import { Ruleset, type VerificationStatus } from '@otr/core/osu';

import type { CountBarDatum } from '@/lib/kit/charts/count-bars';
import { getNiceTicks, type NiceTicks } from '@/lib/kit/charts/ticks';
import { getStatusHueColor } from '@/lib/kit/color/verification';
import { getTierColor } from '@/lib/kit/color/tiers';
import { EMPTY_VALUE } from '@/lib/kit/format/empty';
import { formatLobbySize } from '@/lib/kit/format/fields';
import { formatCountOf, formatYear } from '@/lib/kit/format/number';
import { RATED_RULESETS, getRulesetLabel } from '@/lib/kit/format/ruleset';
import { RATINGS_GROUPS } from '@/lib/kit/status/verification';
import type { VerificationStatusKey } from '@/lib/orpc/schema/stats';
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

/** A median time to verify: `4 days`, `1 day`, or `Under a day`. */
export function formatDaysToVerify(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return EMPTY_VALUE;
  if (days < 1) return 'Under a day';
  return formatCountOf(Math.round(days), 'day');
}
