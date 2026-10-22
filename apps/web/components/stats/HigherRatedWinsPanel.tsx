'use client';

import { StackedBarChart } from '@/components/kit/charts/StackedBarChart';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
} from '@/lib/kit/charts/ticks';
import { seriesColor } from '@/lib/kit/color/categorical';
import {
  formatCountOf,
  formatPercent,
  formatRating,
} from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';

import { RATING_GAP_TILE_LABELS, STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';
import { getRatingGapBars } from './stats-data';

const SERIES = [
  { key: 'higherRated', label: 'Higher-rated side', color: seriesColor(0) },
];

/**
 * How often the higher-rated side won the page's ruleset's matches, over
 * all of them and by the rating gap between the sides.
 */
export default function HigherRatedWinsPanel() {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const { stats } = useRulesetStats();
  const data = stats?.higherRatedWins ?? null;
  const copy = STATS_PANELS.higherRatedWins;
  const bars = getRatingGapBars(data?.buckets ?? []);
  // Every bucket's label fits from `sm`; phones label every other one.
  const ticked = new Set(
    getCategoryTicks(
      bars.map((bar) => Number(bar.key)),
      maxTicks
    )
  );

  const matches =
    data?.buckets.reduce((sum, bucket) => sum + bucket.matches, 0) ?? 0;
  const wins =
    data?.buckets.reduce((sum, bucket) => sum + bucket.higherRatedWins, 0) ?? 0;

  return (
    <Panel data-testid="higher-rated-wins">
      <SectionHeader
        {...copy}
        level={3}
        meta={
          matches > 0 ? formatCountOf(matches, 'match', 'matches') : undefined
        }
      />
      {data === null ? (
        <NotCalculatedYet icon={copy.icon} />
      ) : matches === 0 ? (
        <EmptyState
          size="compact"
          icon={copy.icon}
          title="No rated matches in this ruleset"
        />
      ) : (
        <PanelBody className="flex flex-col gap-3">
          <StatTileGrid columns={2}>
            <StatTile
              label={RATING_GAP_TILE_LABELS[0]}
              value={formatPercent(wins / matches)}
            />
            <StatTile
              label={RATING_GAP_TILE_LABELS[1]}
              value={formatRating(data.medianGap)}
            />
          </StatTileGrid>
          <StackedBarChart
            data={bars}
            series={SERIES}
            mode="share"
            categoryTicks={bars
              .filter((bar) => ticked.has(Number(bar.key)))
              .map((bar) => bar.label)}
            footer={(bar) => formatCountOf(bar.total ?? 0, 'match', 'matches')}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
