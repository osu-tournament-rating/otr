'use client';

import { ListFilter, ShieldQuestion } from 'lucide-react';
import * as React from 'react';
import { Label, Pie, PieChart, Sector } from 'recharts';
import type { PieSectorDataItem } from 'recharts/types/polar/Pie';

import { NotEnoughData } from '@/components/beatmap/BeatmapSection';
import {
  ChartTooltipBody,
  ChartTooltipCard,
} from '@/components/kit/charts/ChartTooltip';
import { SeriesMarker } from '@/components/kit/charts/SeriesMarker';
import { CalloutChip } from '@/components/kit/feedback/CalloutChip';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { Tile } from '@/components/kit/layout/Tile';
import { Eyebrow } from '@/components/kit/layout/Typography';
import { Badge } from '@/components/kit/status/Badge';
import TapTooltip from '@/components/tap-tooltip';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import type { RankRangeBucketKey } from '@/lib/beatmaps/rankRange';
import { RANK_RANGE_BUCKETS, bucketRankRanges } from '@/lib/beatmaps/rankRange';
import type {
  BeatmapFreemodPickSummary,
  BeatmapGradeCount,
  BeatmapModDistribution,
  BeatmapRankRangeModDistribution,
  BeatmapTournamentUsage,
} from '@/lib/orpc/schema/beatmapStats';
import { CATEGORICAL_OTHER } from '@/lib/kit/color/categorical';
import { GRADE_PALETTE } from '@/lib/kit/color/grades';
import { getModPaletteColor } from '@/lib/kit/color/mods';
import {
  formatCount,
  formatCountOf,
  formatPercent,
} from '@/lib/kit/format/number';
import { cn } from '@/lib/utils';
import {
  BEATMAP_MOD_OTHER_LABEL,
  calculateBeatmapModDistribution,
  collapseBeatmapModDistribution,
} from '@/lib/utils/mods';
import { ScoreGrade, VerificationStatus } from '@otr/core/osu';

export interface ModSegment {
  label: string;
  scoreCount: number;
  percentage: number;
  percentageLabel: string;
  fill: string;
}

export type RankRangeModsByBucket = Map<
  RankRangeBucketKey,
  { scoreCount: number; segments: ModSegment[] }
>;

function toModSegments(
  distribution: BeatmapFreemodPickSummary['distribution']
): ModSegment[] {
  return collapseBeatmapModDistribution(
    calculateBeatmapModDistribution(distribution)
  ).map(({ label, mods, scoreCount, percentage }) => ({
    label,
    scoreCount,
    percentage,
    percentageLabel: formatPercent(percentage / 100),
    fill:
      label === BEATMAP_MOD_OTHER_LABEL
        ? CATEGORICAL_OTHER.css
        : getModPaletteColor(mods),
  }));
}

/** Display mod segments keyed by rank-range bucket. */
export function toRankRangeModSegments(
  rankRangeMods: ReadonlyArray<BeatmapRankRangeModDistribution>
): RankRangeModsByBucket {
  const byBucket: RankRangeModsByBucket = new Map();

  for (const bucket of rankRangeMods) {
    const segments = toModSegments(bucket.distribution);
    if (segments.length === 0) continue;

    byBucket.set(bucket.rankRange, {
      scoreCount: bucket.scoreCount,
      segments,
    });
  }

  return byBucket;
}

// SSH+SS read as SS, SH+S as S; ordered best to worst.
const GRADE_GROUPS = [
  {
    label: 'SS',
    grades: [ScoreGrade.SSH, ScoreGrade.SS],
    fill: GRADE_PALETTE.SS,
  },
  {
    label: 'S',
    grades: [ScoreGrade.SH, ScoreGrade.S],
    fill: GRADE_PALETTE.S,
  },
  { label: 'A', grades: [ScoreGrade.A], fill: GRADE_PALETTE.A },
  { label: 'B', grades: [ScoreGrade.B], fill: GRADE_PALETTE.B },
  { label: 'C', grades: [ScoreGrade.C], fill: GRADE_PALETTE.C },
  { label: 'D', grades: [ScoreGrade.D], fill: GRADE_PALETTE.D },
] as const;

function buildGradeSegments(gradeDistribution: BeatmapGradeCount[]) {
  const countsByGrade = new Map<ScoreGrade, number>();

  for (const { grade, scoreCount } of gradeDistribution) {
    countsByGrade.set(grade, (countsByGrade.get(grade) ?? 0) + scoreCount);
  }

  const grouped = GRADE_GROUPS.map((group) => ({
    label: group.label,
    fill: group.fill,
    scoreCount: group.grades.reduce(
      (total, grade) => total + (countsByGrade.get(grade) ?? 0),
      0
    ),
  })).filter((group) => group.scoreCount > 0);

  const totalGraded = grouped.reduce(
    (total, group) => total + group.scoreCount,
    0
  );

  return grouped.map((group) => {
    const percentage =
      totalGraded > 0 ? (group.scoreCount / totalGraded) * 100 : 0;

    return {
      ...group,
      percentage,
      percentageLabel: formatPercent(percentage / 100),
    };
  });
}

interface DisplaySegment {
  label: string;
  scoreCount: number;
  percentage: number;
  percentageLabel: string;
  fill: string;
}

// e2e legend assertions parse this shape: `29.3% · 241`
function formatSegmentValue(
  segment: Pick<DisplaySegment, 'percentageLabel' | 'scoreCount'>
): string {
  return `${segment.percentageLabel} · ${formatCount(segment.scoreCount)}`;
}

function SegmentBar({
  segments,
  testId,
  className,
}: {
  segments: DisplaySegment[];
  testId: string;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn('flex h-7 w-full gap-0.5', className)}
      aria-hidden="true"
    >
      {segments.map((segment) => (
        <div
          key={segment.label}
          className="h-full min-w-[3px] first:rounded-l-md last:rounded-r-md"
          style={{
            flex: `${segment.percentage} 1 0`,
            backgroundColor: segment.fill,
          }}
        />
      ))}
    </div>
  );
}

function SegmentLegend({
  segments,
  ariaLabel,
  className,
}: {
  segments: DisplaySegment[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={ariaLabel}
      className={cn('flex flex-wrap gap-x-4 gap-y-1.5 text-xs', className)}
    >
      {segments.map((segment) => (
        <li key={segment.label} className="flex items-center gap-1.5">
          <SeriesMarker color={segment.fill} />
          <span className="text-muted-foreground">{segment.label}</span>
          <span className="font-medium whitespace-nowrap text-foreground tabular-nums">
            {formatSegmentValue(segment)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FreemodPickRows({ segments }: { segments: ModSegment[] }) {
  const maxPercentage = Math.max(...segments.map((s) => s.percentage));

  return (
    <ul aria-label="Freemod mod picks" className="space-y-1.5">
      {segments.map((segment) => (
        <li key={segment.label} className="flex min-h-5 items-center gap-2">
          <span className="flex w-16 shrink-0 items-center gap-1.5">
            <SeriesMarker color={segment.fill} />
            <span className="truncate text-xs text-muted-foreground">
              {segment.label}
            </span>
          </span>
          <span
            className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${maxPercentage > 0 ? (segment.percentage / maxPercentage) * 100 : 0}%`,
                minWidth: segment.percentage > 0 ? 2 : 0,
                backgroundColor: segment.fill,
              }}
            />
          </span>
          <span className="w-24 shrink-0 text-right text-xs font-medium text-foreground tabular-nums">
            {formatSegmentValue(segment)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FreemodPickChips({ segments }: { segments: ModSegment[] }) {
  return (
    <ul aria-label="Freemod mod picks" className="flex flex-wrap gap-1.5">
      {segments.map((segment) => (
        <li key={segment.label}>
          <Badge
            variant="outline"
            swatch={segment.fill}
            className="tabular-nums"
          >
            {`${segment.label} ${formatCount(segment.scoreCount)}`}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

interface RankRangeSlice {
  key: RankRangeBucketKey;
  label: string;
  count: number;
  fill: string;
}

/**
 * The readout for one rank restriction bucket: its pools, then its mods. The
 * mods are at most the five chart mods and "Other", so every one gets a row.
 */
function rankBucketReadout(
  slice: RankRangeSlice,
  bucketMods?: { scoreCount: number; segments: ModSegment[] }
): React.ComponentProps<typeof ChartTooltipBody> {
  return {
    className: 'min-w-44',
    title: (
      <span className="flex items-center gap-1.5">
        <SeriesMarker color={slice.fill} />
        {`${slice.label} · ${formatCountOf(slice.count, 'pool')}`}
      </span>
    ),
    rows: (bucketMods?.segments ?? []).map((segment) => ({
      key: segment.label,
      label: segment.label,
      value: formatSegmentValue(segment),
      color: segment.fill,
    })),
    footer: bucketMods
      ? `Mods in ${formatCountOf(bucketMods.scoreCount, 'verified score')}`
      : 'No verified scores in this bracket',
  };
}

function RankRangePie({
  slices,
  totalPools,
  modsByBucket,
}: {
  slices: RankRangeSlice[];
  totalPools: number;
  modsByBucket: RankRangeModsByBucket;
}) {
  const renderCenterLabel = React.useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => {
      const { viewBox } = props;
      if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
        return (
          <text
            x={viewBox.cx}
            y={viewBox.cy}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            <tspan
              x={viewBox.cx}
              y={viewBox.cy}
              className="fill-foreground text-2xl font-bold tabular-nums"
            >
              {formatCount(totalPools)}
            </tspan>
            <tspan
              x={viewBox.cx}
              y={(viewBox.cy || 0) + 20}
              className="fill-muted-foreground text-xs"
            >
              pools
            </tspan>
          </text>
        );
      }
      return null;
    },
    [totalPools]
  );

  const renderActiveSlice = React.useCallback((props: PieSectorDataItem) => {
    const {
      cx,
      cy,
      innerRadius,
      outerRadius = 0,
      startAngle,
      endAngle,
      fill,
    } = props;

    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 4}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    );
  }, []);

  return (
    <ChartContainer
      config={{}}
      className="mx-auto aspect-square h-[200px] w-full max-w-[240px]"
    >
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie
          data={slices}
          dataKey="count"
          nameKey="label"
          innerRadius="55%"
          outerRadius="78%"
          paddingAngle={3}
          activeShape={renderActiveSlice}
          isAnimationActive={false}
        >
          <Label content={renderCenterLabel} />
        </Pie>
        <ChartTooltip
          // Parked, not cursor-tracking: it would cover the center label
          position={{ x: 4, y: 136 }}
          wrapperStyle={{ zIndex: 30 }}
          content={({ active, payload }) => {
            const slice = payload?.[0]?.payload as RankRangeSlice | undefined;
            if (!active || !slice) return null;

            return (
              <ChartTooltipCard
                {...rankBucketReadout(slice, modsByBucket.get(slice.key))}
              />
            );
          }}
        />
      </PieChart>
    </ChartContainer>
  );
}

interface BeatmapDistributionsCardProps {
  modStats: BeatmapModDistribution[];
  pools: BeatmapTournamentUsage[];
  freemodPicks: BeatmapFreemodPickSummary;
  rankRangeMods: BeatmapRankRangeModDistribution[];
  gradeDistribution: BeatmapGradeCount[];
  className?: string;
}

export default function BeatmapDistributionsCard({
  modStats,
  pools,
  freemodPicks,
  rankRangeMods,
  gradeDistribution,
  className,
}: BeatmapDistributionsCardProps) {
  const modSegments = React.useMemo(() => toModSegments(modStats), [modStats]);

  const totalScoreCount = React.useMemo(
    () => modSegments.reduce((total, segment) => total + segment.scoreCount, 0),
    [modSegments]
  );

  const gradeSegments = React.useMemo(
    () => buildGradeSegments(gradeDistribution),
    [gradeDistribution]
  );

  const freemodSegments = React.useMemo(
    () => toModSegments(freemodPicks.distribution),
    [freemodPicks.distribution]
  );

  const modsByBucket = React.useMemo(
    () => toRankRangeModSegments(rankRangeMods),
    [rankRangeMods]
  );

  const hasUnverifiedPools = pools.some(
    (pool) => pool.verificationStatus !== VerificationStatus.Verified
  );

  const rankSlices = React.useMemo<RankRangeSlice[]>(() => {
    const colorByKey = new Map(
      RANK_RANGE_BUCKETS.map((bucket) => [bucket.key, bucket.color])
    );

    return bucketRankRanges(pools)
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => ({
        ...bucket,
        fill: colorByKey.get(bucket.key)!,
      }));
  }, [pools]);

  return (
    <Panel
      data-testid="beatmap-mod-distribution-chart"
      // overflow-visible: the rank restriction tooltip runs past the panel edge
      className={cn('flex flex-col overflow-visible', className)}
    >
      <SectionHeader icon={ListFilter} title="Distributions" />

      {modSegments.length === 0 ? (
        <NotEnoughData />
      ) : (
        <div className="flex flex-1 flex-col divide-y">
          <div className="space-y-3 px-4 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <Eyebrow>Mod distribution</Eyebrow>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatCountOf(totalScoreCount, 'score')}
              </span>
            </div>
            <SegmentBar
              segments={modSegments}
              testId="beatmap-mod-distribution-bar"
            />
            <SegmentLegend
              segments={modSegments}
              ariaLabel="Mod distribution"
            />
          </div>

          <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_18rem] lg:divide-x">
            <div className="flex flex-col divide-y">
              <div className="space-y-3 px-4 py-4">
                <div className="flex items-baseline">
                  <Eyebrow>Grades</Eyebrow>
                </div>
                {gradeSegments.length === 0 ? (
                  <NotEnoughData className="py-4" />
                ) : (
                  <>
                    <SegmentBar
                      segments={gradeSegments}
                      testId="beatmap-grade-distribution-bar"
                    />
                    <SegmentLegend
                      segments={gradeSegments}
                      ariaLabel="Grade distribution"
                      className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]"
                    />
                  </>
                )}
              </div>

              <div className="flex flex-1 flex-col space-y-3 px-4 py-4">
                <div className="flex items-baseline justify-between gap-2">
                  <Eyebrow>Freemod picks</Eyebrow>
                  {freemodPicks.freemodGameCount > 0 ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {`${formatCountOf(freemodPicks.freemodScoreCount, 'score')} · ${formatCountOf(freemodPicks.freemodGameCount, 'game')}`}
                    </span>
                  ) : null}
                </div>

                <div
                  className={cn(
                    'flex flex-1 flex-col',
                    freemodSegments.length > 0 && 'justify-center'
                  )}
                >
                  {freemodSegments.length === 0 ? (
                    <NotEnoughData className="py-4" />
                  ) : freemodPicks.freemodScoreCount < 5 ? (
                    <FreemodPickChips segments={freemodSegments} />
                  ) : (
                    <FreemodPickRows segments={freemodSegments} />
                  )}
                </div>
              </div>
            </div>

            <div
              className="flex flex-col border-t px-4 py-4 lg:border-t-0"
              data-testid="beatmap-rank-range"
            >
              <div className="flex flex-1 flex-col space-y-3">
                <div className="flex flex-col items-start gap-2">
                  <Eyebrow>Tournament rank restrictions</Eyebrow>
                  {hasUnverifiedPools && rankSlices.length > 0 ? (
                    <CalloutChip icon={ShieldQuestion}>
                      Includes unverified
                    </CalloutChip>
                  ) : null}
                </div>

                <div
                  className={cn(
                    'flex flex-1 flex-col space-y-3',
                    rankSlices.length > 0 && 'justify-center'
                  )}
                >
                  {rankSlices.length === 0 ? (
                    <NotEnoughData className="py-4" />
                  ) : rankSlices.length === 1 ? (
                    <Tile
                      data-testid="beatmap-rank-range-summary"
                      className="py-6"
                    >
                      <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium">
                        <SeriesMarker color={rankSlices[0].fill} />
                        {rankSlices[0].count === 1
                          ? `1 pool · ${rankSlices[0].label}`
                          : `All ${formatCountOf(rankSlices[0].count, 'pool')} · ${rankSlices[0].label}`}
                      </p>
                    </Tile>
                  ) : (
                    <>
                      <RankRangePie
                        slices={rankSlices}
                        totalPools={pools.length}
                        modsByBucket={modsByBucket}
                      />
                      <ul
                        aria-label="Tournaments by rank restriction"
                        className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs"
                      >
                        {rankSlices.map((slice) => (
                          <li key={slice.key}>
                            <TapTooltip
                              side="top"
                              content={
                                <ChartTooltipBody
                                  {...rankBucketReadout(
                                    slice,
                                    modsByBucket.get(slice.key)
                                  )}
                                />
                              }
                              triggerClassName="flex w-auto items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-accent"
                            >
                              <SeriesMarker color={slice.fill} />
                              <span className="text-muted-foreground">
                                {slice.label}
                              </span>
                              <span className="font-medium text-foreground tabular-nums">
                                {formatCount(slice.count)}
                              </span>
                            </TapTooltip>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
