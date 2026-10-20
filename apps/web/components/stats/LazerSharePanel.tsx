'use client';

import { StackedBarChart } from '@/components/kit/charts/StackedBarChart';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { formatYearTick } from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
} from '@/lib/kit/charts/ticks';
import { seriesColor } from '@/lib/kit/color/categorical';
import { formatCount, formatPercent } from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import type { LazerYearData } from '@/lib/orpc/schema/statsPage';

import { STATS_PANELS } from './chart-panels';
import { getLazerShareBars } from './stats-data';

const SERIES = [{ key: 'lazer', label: 'Lazer', color: seriesColor(0) }];

/**
 * The share of each year's verified tournaments, every ruleset, played on
 * osu!lazer. Until one is verified it says so instead of drawing 0%.
 */
export default function LazerSharePanel({
  rows,
  currentYear,
}: {
  rows: readonly LazerYearData[];
  /** The UTC year now, whose tournaments are "so far". */
  currentYear: number;
}) {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const bars = getLazerShareBars(rows);
  const latest = bars?.at(-1);

  return (
    <Panel data-testid="lazer-share">
      <SectionHeader
        {...STATS_PANELS.lazerShare}
        meta={
          latest && latest.total
            ? `${formatPercent((latest.values.lazer ?? 0) / latest.total)} in ${latest.label}`
            : undefined
        }
      />
      {bars === null ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.lazerShare.icon}
          title="No lazer tournaments yet"
        />
      ) : (
        <PanelBody>
          <StackedBarChart
            data={bars}
            series={SERIES}
            mode="share"
            categoryTicks={getCategoryTicks(
              bars.map((bar) => Number(bar.key)),
              maxTicks
            ).map(formatYearTick)}
            footer={(bar) =>
              `${formatCount(bar.values.lazer ?? 0)} of ${formatCount(bar.total ?? 0)} tournaments${
                Number(bar.key) === currentYear ? ' so far' : ''
              }`
            }
          />
        </PanelBody>
      )}
    </Panel>
  );
}
