'use client';

import { Mods } from '@otr/core/osu';
import { ChartBarBig } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';

import { ChartTooltipContent } from '@/components/kit/charts/ChartTooltip';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import {
  CHART_CURSOR,
  CHART_ROW_BAR_RADIUS,
  CHART_ROW_MARGIN,
  chartAxisProps,
  chartRowGridProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatCompactTick, formatCountTick } from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getNiceTicks,
} from '@/lib/kit/charts/ticks';
import type { PlayerModStats } from '@/lib/orpc/schema/playerStats';
import { cn } from '@/lib/utils';

import { groupModStats, type ModGroup } from './mod-stats';
import {
  MOD_PERFORMANCE_EASY_NOTE,
  MOD_PERFORMANCE_INFO,
} from './section-info';

const BAR_SIZE = 24;
const ROW_HEIGHT = 36;
const AXIS_HEIGHT = 32;

/**
 * Average score per mod, with the mod multipliers removed, as horizontal
 * bars in the mod palette.
 */
export default function PlayerModStatsChart({
  className,
  modStats,
}: {
  className?: string;
  modStats: PlayerModStats[];
}) {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const chartData = useMemo(
    () => groupModStats(modStats, 'averageScore'),
    [modStats]
  );
  if (chartData.length === 0) {
    return (
      <Panel className={className}>
        <SectionHeader
          icon={ChartBarBig}
          title="Mod performance"
          infoText={MOD_PERFORMANCE_INFO}
        />
        <EmptyState
          size="compact"
          icon={ChartBarBig}
          title="No mod performance data"
        />
      </Panel>
    );
  }

  const xTicks = getNiceTicks(
    0,
    Math.max(...chartData.map((entry) => entry.averageScore)),
    { integer: true, maxTicks }
  );

  return (
    <Panel className={cn('flex flex-col', className)}>
      <SectionHeader
        icon={ChartBarBig}
        title="Mod performance"
        infoText={MOD_PERFORMANCE_INFO}
      />
      <PanelBody className="flex flex-1 flex-col justify-center">
        <ChartContainer
          config={{}}
          className="aspect-auto w-full"
          style={{ height: chartData.length * ROW_HEIGHT + AXIS_HEIGHT }}
        >
          <BarChart
            data={chartData}
            layout="vertical"
            margin={CHART_ROW_MARGIN}
          >
            <CartesianGrid {...chartRowGridProps} />
            <XAxis
              {...chartAxisProps}
              {...niceAxisProps(xTicks)}
              tickFormatter={formatCompactTick}
            />
            <YAxis
              {...chartAxisProps}
              dataKey="label"
              type="category"
              width="auto"
              interval={0}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.bar}
              content={
                <ChartTooltipContent
                  nameFormatter={() => 'Average score'}
                  valueFormatter={formatCountTick}
                  footer={(payload) => {
                    const entry = payload[0]?.payload as ModGroup | undefined;
                    return entry && entry.mods & Mods.Easy
                      ? MOD_PERFORMANCE_EASY_NOTE
                      : null;
                  }}
                />
              }
            />
            <Bar
              dataKey="averageScore"
              name="Average score"
              barSize={BAR_SIZE}
              radius={CHART_ROW_BAR_RADIUS}
              isAnimationActive={false}
            >
              {chartData.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}
