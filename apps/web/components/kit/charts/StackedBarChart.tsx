'use client';

import type * as React from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { ChartLegend } from '@/components/kit/charts/ChartLegend';
import {
  ChartTooltipContent,
  type ChartTooltipPayloadItem,
} from '@/components/kit/charts/ChartTooltip';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
  CHART_BAR_RADIUS,
  CHART_CURSOR,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatCountTick, formatPercentTick } from '@/lib/kit/charts/format';
import {
  type StackedBarDatum,
  type StackedBarMode,
  type StackedBarRow,
  type StackedBarSeries,
  getStackedBarRows,
  getStackedValueTicks,
} from '@/lib/kit/charts/stacked-bars';
import { formatPercent } from '@/lib/kit/format/number';
import { cn } from '@/lib/utils';

export type { StackedBarDatum, StackedBarMode, StackedBarSeries };

function datumOf(
  payload: readonly ChartTooltipPayloadItem[]
): StackedBarDatum | undefined {
  return (payload[0]?.payload as StackedBarRow | undefined)?.datum;
}

/**
 * Several series per category, stacked in one column, such as tournaments
 * per year split by rank restriction. `count` stacks the counts; `share`
 * stacks each as a percentage of its column's total, which is how a single
 * series shows a share of every column (lazer tournaments of all of them).
 * Series take the categorical slots of their fixed index, with a legend
 * above the plot from two series on. Put it in a Panel under a
 * SectionHeader that names what is counted.
 */
export function StackedBarChart({
  data,
  series,
  mode = 'count',
  categoryTicks,
  footer,
  className,
}: {
  data: readonly StackedBarDatum[];
  /** The series, bottom of the stack first. */
  series: readonly StackedBarSeries[];
  mode?: StackedBarMode;
  /**
   * The category labels to tick, when not every label fits (years). From
   * `getCategoryTicks` with `formatYearTick`. Every label shows without it.
   */
  categoryTicks?: readonly string[];
  /** A tooltip footer for the hovered column, such as its total. */
  footer?: (datum: StackedBarDatum) => React.ReactNode;
  /** Classes for the chart box; 240px tall (`h-60`) unless you change it. */
  className?: string;
}) {
  const rows = getStackedBarRows(data, series, mode);
  const valueTicks = getStackedValueTicks(rows, series, mode);
  const labels = new Map(series.map((item) => [item.key, item.label]));
  const share = mode === 'share';

  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 ? (
        <ChartLegend
          items={series.map((item) => ({
            key: item.key,
            label: item.label,
            color: item.color,
          }))}
        />
      ) : null}
      <ChartContainer
        config={{}}
        className={cn('aspect-auto h-60 w-full', className)}
      >
        <BarChart data={rows} margin={CHART_MARGIN} barCategoryGap="16%">
          <CartesianGrid {...chartGridProps} />
          <XAxis
            {...chartAxisProps}
            dataKey="label"
            type="category"
            ticks={categoryTicks ? [...categoryTicks] : undefined}
            interval={0}
          />
          <YAxis
            {...chartValueAxisProps}
            {...niceAxisProps(valueTicks)}
            tickFormatter={share ? formatPercentTick : formatCountTick}
          />
          <ChartTooltip
            cursor={CHART_CURSOR.bar}
            content={
              <ChartTooltipContent
                reverse
                nameFormatter={(key) => labels.get(key) ?? key}
                valueFormatter={(value) =>
                  share ? formatPercent(value / 100) : formatCountTick(value)
                }
                footer={
                  footer
                    ? (payload) => {
                        const datum = datumOf(payload);
                        return datum ? footer(datum) : null;
                      }
                    : undefined
                }
              />
            }
          />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.key}
              stackId="stack"
              fill={item.color}
              // A thin line in the card colour between segments.
              stroke={series.length > 1 ? 'var(--card)' : undefined}
              strokeWidth={series.length > 1 ? 1 : 0}
              radius={index === series.length - 1 ? CHART_BAR_RADIUS : 0}
              maxBarSize={48}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  );
}
