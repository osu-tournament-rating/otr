'use client';

import type { Ruleset } from '@otr/core/osu';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { formatCount } from '@/lib/kit/format/number';
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import { useSession } from '@/lib/hooks/useSession';
import { orpc } from '@/lib/orpc/orpc';
import type { PlatformStats } from '@/lib/orpc/schema/stats';

import { RATING_BUCKET_SIZE, STATS_PANELS } from './chart-panels';
import RatingDistributionChart from './RatingDistributionChart';
import { useStatsRuleset } from './ruleset-stats';
import { getRatingDistribution } from './stats-data';

/** The signed-in player's rating in each rated ruleset they have one in. */
function useOwnRatings(): Partial<Record<Ruleset, number>> {
  const session = useSession();
  const playerId = session?.player.id;
  const [ratings, setRatings] = useState<Partial<Record<Ruleset, number>>>({});

  useEffect(() => {
    if (playerId === undefined) {
      setRatings({});
      return;
    }

    let cancelled = false;
    // One failed ruleset should not drop the markers for the others.
    Promise.allSettled(
      RATED_RULESETS.map((ruleset) =>
        orpc.players.stats({ id: playerId, keyType: 'otr', ruleset })
      )
    ).then((results) => {
      if (cancelled) return;
      const next: Partial<Record<Ruleset, number>> = {};
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.rating) {
          next[result.value.ruleset] = result.value.rating.rating;
        }
      }
      setRatings(next);
    });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return ratings;
}

/** The page's ruleset's rating distribution; the page's switch picks it. */
export default function RatingDistributionPanel({
  ratingsByRuleset,
}: {
  ratingsByRuleset: PlatformStats['ratingStats']['ratingsByRuleset'];
}) {
  const ruleset = useStatsRuleset();
  const ownRatings = useOwnRatings();
  const ratings = ratingsByRuleset[`${ruleset}`];
  const distribution = useMemo(
    () => getRatingDistribution(ratings ?? {}, RATING_BUCKET_SIZE),
    [ratings]
  );

  return (
    <Panel data-testid="rating-distribution">
      <SectionHeader
        {...STATS_PANELS.ratingDistribution}
        level={3}
        meta={
          distribution.totalPlayers > 0
            ? `${formatCount(distribution.totalPlayers)} players`
            : undefined
        }
      />
      {distribution.buckets.length === 0 ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.ratingDistribution.icon}
          title="No ratings in this ruleset"
          data-testid={`chart-rating-distribution-${ruleset}`}
        />
      ) : (
        <PanelBody>
          <RatingDistributionChart
            ruleset={ruleset}
            distribution={distribution}
            bucketSize={RATING_BUCKET_SIZE}
            userRating={ownRatings[ruleset]}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
