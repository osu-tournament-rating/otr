'use client';

import { StackedBarChart } from '@/components/kit/charts/StackedBarChart';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { formatYearTick } from '@/lib/kit/charts/format';
import { getStackedTotal } from '@/lib/kit/charts/stacked-bars';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
} from '@/lib/kit/charts/ticks';
import { seriesColor } from '@/lib/kit/color/categorical';
import {
  formatCount,
  formatCountOf,
  formatPercent,
  formatYear,
} from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';

import { STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';
import { getActivePlayerBars } from './stats-data';

/** Returning players at the bottom in slot 1, new ones on top in slot 2. */
const SERIES = [
  { key: 'returning', label: 'Returning', color: seriesColor(0) },
  { key: 'new', label: 'New', color: seriesColor(1) },
];

/**
 * Players of each year's verified matches in the page's ruleset, split
 * into those new to it and those back from an earlier year. The tooltip
 * adds how many of a year's new players came back the next.
 */
export default function ActivePlayersPanel({
  currentYear,
}: {
  /** The UTC year now, whose players are "so far". */
  currentYear: number;
}) {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const { stats } = useRulesetStats();
  const data = stats?.activePlayers ?? null;
  const copy = STATS_PANELS.activePlayers;
  const bars = getActivePlayerBars(data?.years ?? []);
  const byYear = new Map(
    (data?.years ?? []).map((entry) => [entry.year, entry])
  );
  const peak = bars.reduce<{ year: number; players: number } | null>(
    (best, bar) => {
      const players = getStackedTotal(bar, SERIES);
      return !best || players > best.players
        ? { year: Number(bar.key), players }
        : best;
    },
    null
  );
  const soFar = (year: number) => (year === currentYear ? ' so far' : '');

  return (
    <Panel data-testid="active-players">
      <SectionHeader
        {...copy}
        level={3}
        meta={
          peak && peak.players > 0
            ? `Peak ${formatCount(peak.players)} in ${formatYear(peak.year)}`
            : undefined
        }
      />
      {data === null ? (
        <NotCalculatedYet icon={copy.icon} />
      ) : bars.length === 0 ? (
        <EmptyState size="compact" icon={copy.icon} title="Not enough data" />
      ) : (
        <PanelBody>
          <StackedBarChart
            data={bars}
            series={SERIES}
            className="h-72"
            categoryTicks={getCategoryTicks(
              bars.map((bar) => Number(bar.key)),
              maxTicks
            ).map(formatYearTick)}
            footer={(bar) => {
              const year = Number(bar.key);
              const entry = byYear.get(year);
              const next = year + 1;
              const returned =
                entry && entry.newPlayers > 0 && byYear.has(next)
                  ? `${formatPercent(entry.newPlayersReturned / entry.newPlayers, { decimals: 0 })} of new players came back in ${formatYear(next)}${soFar(next)}`
                  : null;
              return (
                <div className="grid gap-0.5">
                  <span>
                    {formatCountOf(getStackedTotal(bar, SERIES), 'player')}
                    {soFar(year)}
                  </span>
                  {returned ? <span>{returned}</span> : null}
                </div>
              );
            }}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
