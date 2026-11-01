'use client';

import { ChartCandlestick } from 'lucide-react';
import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  BoxPlotTooltipContent,
  BoxPlotTrack,
  FullRangeToggle,
  NotEnoughData,
  ScaleAxis,
} from '@/components/beatmap/BeatmapSection';
import { SCORE_DISTRIBUTION_INFO } from '@/components/beatmap/section-info';
import { ChartTooltipContent } from '@/components/kit/charts/ChartTooltip';
import { SeriesMarker } from '@/components/kit/charts/SeriesMarker';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { Eyebrow } from '@/components/kit/layout/Typography';
import TapTooltip from '@/components/tap-tooltip';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
  formatScoreTick,
  getBoxPlotView,
  toBoxPlotMarks,
  type BoxPlotQuartiles,
  type NiceAxis,
} from '@/lib/beatmaps/chart-axis';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import type {
  BeatmapModScoreDistribution,
  BeatmapScorePercentilePoint,
} from '@/lib/orpc/schema/beatmapStats';
import { seriesColor } from '@/lib/kit/color/categorical';
import { getModPaletteColor } from '@/lib/kit/color/mods';
import {
  CHART_CURSOR,
  CHART_LINE_WIDTH,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatPercentTick } from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getNiceTicks,
} from '@/lib/kit/charts/ticks';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { cn } from '@/lib/utils';
import { getBeatmapModLabel, isChartMods } from '@/lib/utils/mods';

interface BeatmapScoreDistributionCardProps {
  distribution: BeatmapModScoreDistribution[];
  percentiles: BeatmapScorePercentilePoint[];
  /** Every verified score on the map, not just the ones the rows are drawn from. */
  totalScoreCount: number;
  className?: string;
}

const PERCENTILE_CHART_CONFIG = {
  percentile: { label: 'Percentile' },
};

function toScoreQuartiles(
  group: BeatmapModScoreDistribution
): BoxPlotQuartiles {
  return {
    min: group.minScore,
    p20: group.p20Score,
    p25: group.p25Score,
    median: group.medianScore,
    p75: group.p75Score,
    max: group.maxScore,
  };
}

function BoxPlotRow({
  group,
  axis,
  gridPercents,
}: {
  group: BeatmapModScoreDistribution;
  axis: NiceAxis;
  /** Interior axis tick positions, drawn through the track. */
  gridPercents: number[];
}) {
  const label = getBeatmapModLabel(group.mods);
  const color = getModPaletteColor(group.mods);
  const quartiles = toScoreQuartiles(group);

  return (
    <TapTooltip
      triggerAriaLabel={`${label}: ${formatCountOf(group.scoreCount, 'score')}`}
      content={
        <BoxPlotTooltipContent
          labelIcon={<SeriesMarker color={color} />}
          label={label}
          scoreCount={group.scoreCount}
          measureLabel="Median"
          quartiles={quartiles}
          format={formatCount}
        />
      }
    >
      <div className="flex min-h-7 items-center gap-2">
        <span className="flex w-16 shrink-0 items-center gap-1.5">
          <SeriesMarker color={color} />
          <span className="truncate text-xs">{label}</span>
        </span>

        <BoxPlotTrack
          color={color}
          marks={toBoxPlotMarks(quartiles, axis)}
          gridPercents={gridPercents}
        />
      </div>
    </TapTooltip>
  );
}

function PercentileCurve({
  percentiles,
}: {
  percentiles: BeatmapScorePercentilePoint[];
}) {
  const isNarrow = useIsNarrowChart();
  const scoreTicks = React.useMemo(() => {
    const scores = percentiles.map((point) => point.score);
    return getNiceTicks(Math.min(...scores), Math.max(...scores), {
      within: true,
      maxTicks: isNarrow ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS,
    });
  }, [percentiles, isNarrow]);

  return (
    <ChartContainer
      config={PERCENTILE_CHART_CONFIG}
      className="h-[240px] w-full"
    >
      <AreaChart data={percentiles} margin={CHART_MARGIN}>
        <CartesianGrid {...chartGridProps} />
        <XAxis
          {...chartAxisProps}
          dataKey="score"
          {...niceAxisProps(scoreTicks)}
          tickFormatter={(value: number) => formatScoreTick(value)}
        />
        <YAxis
          {...chartValueAxisProps}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={formatPercentTick}
        />
        <ChartTooltip
          cursor={CHART_CURSOR.line}
          content={
            <ChartTooltipContent
              marker="line"
              labelFormatter={(_label, payload) => {
                const point = payload[0]?.payload as
                  BeatmapScorePercentilePoint | undefined;
                return point ? `A score of ${formatCount(point.score)}` : null;
              }}
              nameFormatter={() => 'Beats'}
              valueFormatter={(value) =>
                `${formatPercentTick(Math.round(value))} of tournament plays`
              }
            />
          }
        />
        <Area
          type="monotone"
          dataKey="percentile"
          name="Beats"
          stroke={seriesColor(0)}
          fill={seriesColor(0)}
          fillOpacity={0.15}
          strokeWidth={CHART_LINE_WIDTH}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export default function BeatmapScoreDistributionCard({
  distribution: allGroups,
  percentiles,
  totalScoreCount,
  className,
}: BeatmapScoreDistributionCardProps) {
  // Only the chart mods get a box. Quartiles can't be pooled from the
  // groups' own quartiles, and a box over EZ, HDHR and the rest together
  // would mix scores on different scales.
  const distribution = React.useMemo(
    () => allGroups.filter((group) => isChartMods(group.mods)),
    [allGroups]
  );
  const hasBoxData = distribution.length > 0;
  const hasCurveData = percentiles.length > 0;
  const hasData = hasBoxData || hasCurveData;

  const isNarrow = useIsNarrowChart();

  const quartiles = React.useMemo(
    () => distribution.map(toScoreQuartiles),
    [distribution]
  );

  const [expanded, setExpanded] = React.useState(false);

  const view = React.useMemo(
    () =>
      getBoxPlotView(quartiles, formatScoreTick, isNarrow ? 4 : 6, expanded),
    [quartiles, isNarrow, expanded]
  );

  return (
    <Panel data-testid="beatmap-score-distribution" className={className}>
      <SectionHeader
        icon={ChartCandlestick}
        title="Score distribution"
        infoText={SCORE_DISTRIBUTION_INFO}
        meta={hasBoxData ? formatCountOf(totalScoreCount, 'score') : undefined}
      />

      {!hasData ? (
        <NotEnoughData />
      ) : (
        <div className="xl:grid xl:grid-cols-2 xl:divide-x">
          <div className="flex h-full flex-col px-4 py-4">
            <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <Eyebrow>Mod</Eyebrow>
              {view.canExpand ? (
                <FullRangeToggle
                  pressed={expanded}
                  onPressedChange={setExpanded}
                  label="Full range: score by mod"
                />
              ) : null}
            </div>
            <div className={cn(distribution.length < 3 && 'xl:my-auto')}>
              {hasBoxData ? (
                <div
                  className={cn(
                    'mt-3 flex flex-col max-xl:h-auto max-xl:justify-start max-xl:gap-2',
                    distribution.length >= 3
                      ? 'h-[240px] justify-evenly'
                      : 'gap-2'
                  )}
                >
                  {distribution.map((group) => (
                    <BoxPlotRow
                      key={group.mods}
                      group={group}
                      axis={view.axis}
                      gridPercents={view.gridPercents}
                    />
                  ))}
                </div>
              ) : (
                <NotEnoughData />
              )}
              {hasBoxData ? (
                <ScaleAxis leftSpacerClassName="w-16" ticks={view.ticks} />
              ) : null}
            </div>
          </div>

          <div className="border-t px-4 py-4 xl:border-t-0">
            {/* min-h-6 mirrors the toggle row across the divider */}
            <div className="flex min-h-6 items-center">
              <Eyebrow>Percentiles</Eyebrow>
            </div>
            {hasCurveData ? (
              <div className="mt-3">
                <PercentileCurve percentiles={percentiles} />
              </div>
            ) : (
              <NotEnoughData />
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
