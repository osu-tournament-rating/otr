'use client';

import { RatingAdjustmentType } from '@otr/core/osu';
import { Calendar, ChartLine } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import TierIcon from '@/components/icons/TierIcon';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ChoiceChip } from '@/components/kit/lists/ChoiceChip';
import { ScopeSwitch } from '@/components/kit/lists/ScopeSwitch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatRating } from '@/lib/kit/format/number';
import {
  booleanParam,
  defineListParams,
  enumParam,
} from '@/lib/kit/lists/params';
import { useListState } from '@/lib/kit/lists/use-list-state';
import type { PlayerRatingAdjustment } from '@/lib/orpc/schema/playerStats';
import { sortData } from '@/lib/utils/playerRatingChart';
import { getTierFromRating } from '@/lib/utils/tierData';

import PlayerRatingChartSummaryStats from './PlayerRatingChartSummaryStats';
import PlayerRatingChartTable from './PlayerRatingChartTable';
import PlayerRatingChartView from './PlayerRatingChartView';
import type { RatingMetric } from './rating-adjustment';

type TimeRangeOption = 'all' | '1y' | '6m' | '3m' | 'custom';

/**
 * The panel's views, kept in the address so a reload or a shared link
 * shows the same one. Every adjustment is already on the client, so they
 * change the address without a server render (`shallow`).
 */
const RATING_VIEW_PARAMS = defineListParams({
  metric: enumParam<RatingMetric>(['rating', 'volatility'], {
    default: 'rating',
    role: 'scope',
  }),
  view: enumParam(['chart', 'table'] as const, {
    default: 'chart',
    role: 'scope',
  }),
  decay: booleanParam({ default: true, role: 'scope' }),
});

const TIME_RANGE_LABELS: Record<TimeRangeOption, string> = {
  all: 'All time',
  '1y': 'Last year',
  '6m': 'Last 6 months',
  '3m': 'Last 3 months',
  custom: 'Custom range',
};

// UTC calendar arithmetic, like the dates in the address, so a shared link
// reads as the same preset in every time zone.
const DATE_PRESETS: Record<
  Exclude<TimeRangeOption, 'all' | 'custom'>,
  (endDate: Date) => Date
> = {
  '1y': (endDate) => {
    const start = new Date(endDate);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return start;
  },
  '6m': (endDate) => {
    const start = new Date(endDate);
    start.setUTCMonth(start.getUTCMonth() - 6);
    return start;
  },
  '3m': (endDate) => {
    const start = new Date(endDate);
    start.setUTCMonth(start.getUTCMonth() - 3);
    return start;
  },
};

const METRIC_OPTIONS = [
  { value: 'rating', label: 'Rating' },
  { value: 'volatility', label: 'Volatility' },
] as const;

const VIEW_OPTIONS = [
  { value: 'chart', label: 'Chart' },
  { value: 'table', label: 'Table' },
] as const;

const toDateOnlyIso = (date: Date) => date.toISOString().split('T')[0];

const parseDateParam = (value: string | null): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const deriveTimeRange = (startDate?: Date, endDate?: Date): TimeRangeOption => {
  if (!startDate && !endDate) {
    return 'all';
  }

  if (!startDate || !endDate) {
    return 'custom';
  }

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'custom';
  }

  const endDateIso = toDateOnlyIso(endDate);

  for (const [range, resolver] of Object.entries(DATE_PRESETS)) {
    const expectedStart = resolver(new Date(endDate));
    if (toDateOnlyIso(expectedStart) === toDateOnlyIso(startDate)) {
      return range as TimeRangeOption;
    }
  }

  const todayIso = toDateOnlyIso(new Date());
  if (endDateIso !== todayIso) {
    for (const [range, resolver] of Object.entries(DATE_PRESETS)) {
      const expectedStart = resolver(new Date());
      if (toDateOnlyIso(expectedStart) === toDateOnlyIso(startDate)) {
        return range as TimeRangeOption;
      }
    }
  }

  return 'custom';
};

const isDecay = (point: PlayerRatingAdjustment) =>
  point.adjustmentType === RatingAdjustmentType.Decay ||
  point.adjustmentType === RatingAdjustmentType.VolatilityDecay;

/**
 * The rating history panel: rating or volatility as a line or a table,
 * with a time range (kept in the address, where the whole profile reads
 * it) and a switch for decay adjustments. The views and the decay switch
 * live in the address too, without a server render. The peak rating and
 * its tier sit in the header.
 */
export default function PlayerRatingChart({
  adjustments,
  highestRating,
}: {
  adjustments: PlayerRatingAdjustment[];
  highestRating: number | undefined;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dateMinParam = searchParams.get('dateMin');
  const dateMaxParam = searchParams.get('dateMax');

  const [timeRange, setTimeRange] = useState<TimeRangeOption>(() =>
    deriveTimeRange(parseDateParam(dateMinParam), parseDateParam(dateMaxParam))
  );
  const { state: views, setState: setViews } = useListState(
    RATING_VIEW_PARAMS,
    { shallow: true }
  );
  const { metric, view: viewMode, decay: showDecay } = views;

  useEffect(() => {
    const derivedRange = deriveTimeRange(
      parseDateParam(dateMinParam),
      parseDateParam(dateMaxParam)
    );

    setTimeRange((prev) => (prev === derivedRange ? prev : derivedRange));
  }, [dateMinParam, dateMaxParam]);

  const filteredData = useMemo(
    () =>
      adjustments.filter((point) => {
        // Volatility decay never moves the rating line.
        if (
          metric === 'rating' &&
          point.adjustmentType === RatingAdjustmentType.VolatilityDecay
        ) {
          return false;
        }
        return showDecay || !isDecay(point);
      }),
    [adjustments, showDecay, metric]
  );

  // The volatility line plots one point per day.
  const dailyData = useMemo(() => {
    const dailyMap = new Map<string, PlayerRatingAdjustment>();

    sortData(filteredData, true).forEach((point) => {
      const dateKey = new Date(point.timestamp).toISOString().split('T')[0];
      dailyMap.set(dateKey, point);
    });

    return Array.from(dailyMap.values());
  }, [filteredData]);

  const handleTimeRangeChange = (value: string) => {
    const nextRange = value as TimeRangeOption;
    setTimeRange(nextRange);

    if (nextRange === 'custom') return;

    const params = new URLSearchParams(searchParams.toString());

    if (nextRange === 'all') {
      params.delete('dateMin');
      params.delete('dateMax');
    } else {
      const now = new Date();
      params.set('dateMin', toDateOnlyIso(DATE_PRESETS[nextRange](now)));
      params.set('dateMax', toDateOnlyIso(now));
    }

    const query = params.toString();
    router.push(query ? `?${query}` : '?', { scroll: false });
  };

  const peak =
    highestRating !== undefined ? getTierFromRating(highestRating) : null;

  return (
    <Panel data-testid="player-rating-chart">
      <SectionHeader
        icon={ChartLine}
        title="Rating history"
        meta={
          peak && highestRating !== undefined ? (
            <span
              data-testid="rating-chart-peak"
              className="flex items-center gap-1.5"
            >
              <TierIcon
                tier={peak.tier}
                subTier={peak.subTier}
                tooltip
                width={16}
                height={16}
              />
              <span>
                Peak rating{' '}
                <span className="font-medium text-foreground">
                  {formatRating(highestRating)}
                </span>
              </span>
            </span>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSwitch
            label="Rating or volatility"
            value={metric}
            onValueChange={(next) => setViews({ metric: next })}
            options={METRIC_OPTIONS}
          />
          <ScopeSwitch
            data-testid="rating-chart-toggle"
            label="View"
            value={viewMode}
            onValueChange={(next) => setViews({ view: next })}
            options={VIEW_OPTIONS}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceChip
            selected={showDecay}
            onClick={() => setViews({ decay: !showDecay })}
          >
            Display decay
          </ChoiceChip>
          <Select value={timeRange} onValueChange={handleTimeRangeChange}>
            <SelectTrigger
              aria-label="Time range"
              className="h-8 bg-background dark:bg-input/50 dark:shadow-none"
            >
              <Calendar aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['all', '1y', '6m', '3m'] as const).map((range) => (
                <SelectItem key={range} value={range}>
                  {TIME_RANGE_LABELS[range]}
                </SelectItem>
              ))}
              {timeRange === 'custom' ? (
                <SelectItem value="custom">
                  {TIME_RANGE_LABELS.custom}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="px-4 pt-3">
        <PlayerRatingChartSummaryStats
          data={filteredData}
          metric={metric}
          rangeLabel={timeRange === 'all' ? undefined : 'in range'}
        />
      </div>

      {viewMode === 'chart' ? (
        <PanelBody>
          <PlayerRatingChartView
            data={metric === 'rating' ? filteredData : dailyData}
            metric={metric}
            highestRating={highestRating}
          />
        </PanelBody>
      ) : (
        <div className="mt-3">
          <PlayerRatingChartTable data={filteredData} metric={metric} />
        </div>
      )}
    </Panel>
  );
}
