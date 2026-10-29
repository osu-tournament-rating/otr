import TierIcon from '@/components/icons/TierIcon';
import TRText from '@/components/rating/TRText';
import { formatRating } from '@/lib/kit/format/number';
import type { PlayerRatingStats } from '@/lib/orpc/schema/playerStats';
import { formatTierName, type TierName } from '@/lib/kit/format/tier';

// Sub-tiers in the order a player climbs them.
const SUB_TIERS = [3, 2, 1] as const;

const SUB_TIER_NUMERALS: Record<(typeof SUB_TIERS)[number], string> = {
  3: 'III',
  2: 'II',
  1: 'I',
};

/**
 * The slim strip under the profile's stat tiles: how far the player is
 * through the current major tier, one segment per sub-tier, and how much
 * rating the next major tier needs. Nothing shows at the top tier.
 */
export default function PlayerTierProgress({
  rating,
}: {
  rating: PlayerRatingStats;
}) {
  const { tierProgress } = rating;

  if (!tierProgress.nextMajorTier) return null;

  const currentTier = tierProgress.currentTier as TierName;
  const nextTier = tierProgress.nextMajorTier as TierName;
  const nextTierName = formatTierName(nextTier, 3);
  const fill = tierProgress.majorTierFillPercentage ?? 0;
  const ratingNeeded = Math.max(
    0,
    tierProgress.ratingForNextMajorTier - rating.rating
  );

  return (
    <div data-testid="tier-progress" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-medium">Tier progress</span>
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {formatRating(ratingNeeded)}
          </span>{' '}
          <TRText /> until {nextTierName}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <TierIcon
            tier={currentTier}
            subTier={3}
            tooltip
            width={20}
            height={20}
          />
          <div
            role="progressbar"
            aria-label={`Progress to ${nextTierName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fill * 100)}
            className="flex flex-1 items-center gap-1"
          >
            {SUB_TIERS.map((subTier, index) => {
              // Each segment holds a third of the major tier.
              const segment = Math.min(Math.max(fill * 3 - index, 0), 1);

              return (
                <span
                  key={subTier}
                  aria-hidden
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10"
                >
                  <span
                    className="block h-full rounded-full bg-chart-1"
                    style={{ width: `${segment * 100}%` }}
                  />
                </span>
              );
            })}
          </div>
          <TierIcon
            tier={nextTier}
            subTier={3}
            tooltip
            width={20}
            height={20}
          />
        </div>
        {/* The sub-tier under each segment, lined up with the bars above:
            the 20px icons and the 8px gaps on both ends. */}
        <div
          aria-hidden
          className="flex gap-1 px-7 text-xs leading-none text-muted-foreground"
        >
          {SUB_TIERS.map((subTier) => (
            <span key={subTier} className="flex-1 text-center">
              {SUB_TIER_NUMERALS[subTier]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
