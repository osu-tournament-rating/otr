'use client';

import { StackedBarChart } from '@/components/kit/charts/StackedBarChart';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { RANK_RANGE_BUCKETS } from '@/lib/beatmaps/rankRange';
import { formatYearTick } from '@/lib/kit/charts/format';
import { getStackedTotal } from '@/lib/kit/charts/stacked-bars';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
} from '@/lib/kit/charts/ticks';
import { formatCountOf } from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import { STATS_PANELS } from './chart-panels';
import { useRulesetStats } from './ruleset-stats';
import { getRankRestrictionBars } from './stats-data';

/** The site's rank restriction bands, in their categorical slots 1–5. */
const SERIES = RANK_RANGE_BUCKETS.map((bucket) => ({
  key: bucket.key,
  label: bucket.label,
  color: bucket.color,
}));

/**
 * Each year's verified tournaments in the page's ruleset, split by rank
 * restriction band, as shares of the year.
 */
export default function RankRestrictionsPanel({
  currentYear,
}: {
  /** The UTC year now, whose tournaments are "so far". */
  currentYear: number;
}) {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const { stats } = useRulesetStats();
  const bars = getRankRestrictionBars(stats?.rankRestrictionsByYear ?? []);
  const counted = bars.reduce(
    (sum, bar) => sum + getStackedTotal(bar, SERIES),
    0
  );

  return (
    <Panel data-testid="rank-restrictions">
      <SectionHeader
        {...STATS_PANELS.rankRestrictions}
        level={3}
        meta={counted > 0 ? formatCountOf(counted, 'tournament') : undefined}
      />
      {bars.length === 0 ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.rankRestrictions.icon}
          title="Not enough data"
        />
      ) : (
        <PanelBody>
          <StackedBarChart
            data={bars}
            series={SERIES}
            mode="share"
            className="h-72"
            categoryTicks={getCategoryTicks(
              bars.map((bar) => Number(bar.key)),
              maxTicks
            ).map(formatYearTick)}
            footer={(bar) =>
              `${formatCountOf(getStackedTotal(bar, SERIES), 'tournament')}${
                Number(bar.key) === currentYear ? ' so far' : ''
              }`
            }
          />
        </PanelBody>
      )}
    </Panel>
  );
}
