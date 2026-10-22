'use client';

import { POOL_DIFFICULTY_MIN_TOURNAMENTS } from '@otr/core/platform-stats/constants';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ChartLegend } from '@/components/kit/charts/ChartLegend';
import {
  ChartTooltipCard,
  type ChartTooltipPayloadItem,
} from '@/components/kit/charts/ChartTooltip';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
  CHART_CURSOR,
  CHART_LINE_WIDTH,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatNumberTick, formatYearTick } from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
  getNiceTicks,
} from '@/lib/kit/charts/ticks';
import { seriesColor } from '@/lib/kit/color/categorical';
import { formatCountOf, formatNumber } from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';

import { POOL_DIFFICULTY_LABELS, STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';
import { getPoolDifficultyRows, type PoolDifficultyRow } from './stats-data';

/** The p90 lines' dash, the same one the legend's dashed marker draws. */
const P90_DASH = '4 2';

/** Each line: the kind of tournament gives the colour, the measure the dash. */
const LINES = [
  { key: 'openMedian', group: 'open', measure: 'median' },
  { key: 'openP90', group: 'open', measure: 'p90' },
  { key: 'restrictedMedian', group: 'restricted', measure: 'median' },
  { key: 'restrictedP90', group: 'restricted', measure: 'p90' },
] as const;

const GROUP_COLORS = {
  open: seriesColor(0),
  restricted: seriesColor(1),
} as const;

const LEGEND = [
  {
    key: 'open',
    label: POOL_DIFFICULTY_LABELS.open,
    color: GROUP_COLORS.open,
  },
  {
    key: 'restricted',
    label: POOL_DIFFICULTY_LABELS.restricted,
    color: GROUP_COLORS.restricted,
  },
  {
    key: 'median',
    label: POOL_DIFFICULTY_LABELS.median,
    color: 'var(--muted-foreground)',
    marker: 'line' as const,
  },
  {
    key: 'p90',
    label: POOL_DIFFICULTY_LABELS.p90,
    color: 'var(--muted-foreground)',
    marker: 'dashed' as const,
  },
];

const formatStars = (value: number) => formatNumber(value, { decimals: 2 });

function PoolDifficultyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly ChartTooltipPayloadItem[];
}) {
  const row = payload?.[0]?.payload as PoolDifficultyRow | undefined;
  if (!active || !row) return null;

  const rows = LINES.flatMap((line) => {
    const value = row[line.key];
    if (value === null) return [];
    return [
      {
        key: line.key,
        label: `${POOL_DIFFICULTY_LABELS[line.group]}, ${POOL_DIFFICULTY_LABELS[line.measure].toLowerCase()}`,
        value: formatStars(value),
        color: GROUP_COLORS[line.group],
        marker:
          line.measure === 'p90' ? ('dashed' as const) : ('line' as const),
      },
    ];
  });
  const maps = [
    row.openMaps > 0
      ? `${formatCountOf(row.openMaps, 'beatmap')} open rank`
      : null,
    row.restrictedMaps > 0
      ? `${formatCountOf(row.restrictedMaps, 'beatmap')} rank-restricted`
      : null,
  ].filter(Boolean);

  return (
    <ChartTooltipCard
      title={row.label}
      rows={rows}
      footer={maps.length > 0 ? maps.join(', ') : null}
    />
  );
}

/**
 * The median and 90th percentile star rating of the nomod beatmaps the
 * page's ruleset's open rank and rank-restricted tournaments played each
 * year.
 */
export default function PoolDifficultyPanel() {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const { stats, trendStartYear } = useRulesetStats();
  const data = stats?.poolDifficulty ?? null;
  const copy = STATS_PANELS.poolDifficulty;
  const rows = getPoolDifficultyRows(
    data?.years ?? [],
    trendStartYear,
    POOL_DIFFICULTY_MIN_TOURNAMENTS
  );
  const values = rows.flatMap((row) =>
    LINES.map((line) => row[line.key]).filter(
      (value): value is number => value !== null
    )
  );
  const yTicks = getNiceTicks(Math.min(...values), Math.max(...values));
  const maps = rows.reduce(
    (sum, row) => sum + row.openMaps + row.restrictedMaps,
    0
  );

  return (
    <Panel data-testid="pool-difficulty">
      <SectionHeader
        {...copy}
        level={3}
        meta={maps > 0 ? formatCountOf(maps, 'beatmap') : undefined}
      />
      {data === null ? (
        <NotCalculatedYet icon={copy.icon} />
      ) : rows.length === 0 ? (
        <EmptyState size="compact" icon={copy.icon} title="Not enough data" />
      ) : (
        <PanelBody className="flex flex-col gap-3">
          <ChartLegend items={LEGEND} marker="line" />
          <ChartContainer config={{}} className="aspect-auto h-72 w-full">
            <LineChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid {...chartGridProps} />
              <XAxis
                {...chartAxisProps}
                dataKey="label"
                type="category"
                // Room for the first and last year's label, which centre on the plot's edges.
                padding={{ left: 16, right: 16 }}
                ticks={getCategoryTicks(
                  rows.map((row) => row.year),
                  maxTicks
                ).map(formatYearTick)}
                interval={0}
              />
              <YAxis
                {...chartValueAxisProps}
                {...niceAxisProps(yTicks)}
                tickFormatter={formatNumberTick}
              />
              <ChartTooltip
                cursor={CHART_CURSOR.line}
                content={<PoolDifficultyTooltip />}
              />
              {LINES.map((line) => (
                <Line
                  key={line.key}
                  dataKey={line.key}
                  type="monotone"
                  stroke={GROUP_COLORS[line.group]}
                  strokeWidth={CHART_LINE_WIDTH}
                  strokeDasharray={
                    line.measure === 'p90' ? P90_DASH : undefined
                  }
                  // A year between two gaps has no segment, so it gets a dot.
                  dot={(props: {
                    cx?: number;
                    cy?: number;
                    index?: number;
                  }) => {
                    const index = props.index ?? -1;
                    const isolated =
                      rows[index]?.[line.key] != null &&
                      rows[index - 1]?.[line.key] == null &&
                      rows[index + 1]?.[line.key] == null;
                    return isolated && props.cx != null && props.cy != null ? (
                      <circle
                        key={`${line.key}-${index}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={3}
                        fill={GROUP_COLORS[line.group]}
                      />
                    ) : (
                      <g key={`${line.key}-${index}`} />
                    );
                  }}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                    stroke: 'var(--background)',
                  }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        </PanelBody>
      )}
    </Panel>
  );
}
