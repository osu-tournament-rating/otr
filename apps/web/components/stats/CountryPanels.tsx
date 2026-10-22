'use client';

import { CountBarChart } from '@/components/kit/charts/CountBarChart';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { formatCountOf, formatPercent } from '@/lib/kit/format/number';
import type { CountrySummaryData } from '@/lib/orpc/schema/statsPage';

import { STATS_PANELS, type StatsPanelCopy } from './chart-panels';
import { useRulesetStats } from './ruleset-stats';
import { getCountryBars } from './stats-data';

/** `Top 10 of 150 countries`, or `7 countries` when all of them show. */
function countryMeta(shown: number, countries: number): string | undefined {
  if (countries === 0) return undefined;
  const all = formatCountOf(countries, 'country', 'countries');
  return shown < countries ? `Top ${shown} of ${all}` : all;
}

function CountryPanel({
  copy,
  summary,
  footer,
  testId,
}: {
  copy: StatsPanelCopy;
  summary: CountrySummaryData | undefined;
  /** A tooltip footer for a country, from its players and the total. */
  footer?: (players: number, total: number) => string;
  testId: string;
}) {
  const { countryNames } = useRulesetStats();
  const bars = getCountryBars(summary?.countries ?? [], countryNames);
  const total = summary?.players ?? 0;

  return (
    <Panel data-testid={testId}>
      <SectionHeader
        {...copy}
        level={3}
        meta={countryMeta(bars.length, summary?.countryCount ?? 0)}
      />
      {bars.length === 0 ? (
        <EmptyState
          size="compact"
          icon={copy.icon}
          title="No ratings in this ruleset"
        />
      ) : (
        <PanelBody>
          <CountBarChart
            data={bars}
            layout="rows"
            valueName="Players"
            className="h-72"
            footer={footer ? (bar) => footer(bar.count, total) : undefined}
          />
        </PanelBody>
      )}
    </Panel>
  );
}

/** Rated players in the page's ruleset, by country. */
export function PlayersByCountryPanel() {
  const { stats } = useRulesetStats();

  return (
    <CountryPanel
      copy={STATS_PANELS.playersByCountry}
      summary={stats?.playersByCountry}
      testId="players-by-country"
      footer={(players, total) =>
        `${formatPercent(players / total)} of rated players`
      }
    />
  );
}

/**
 * The leaderboard's top 100 in the page's ruleset, by country. A count is
 * already its share of 100, so the tooltip adds none.
 */
export function TopPlayersByCountryPanel() {
  const { stats } = useRulesetStats();

  return (
    <CountryPanel
      copy={STATS_PANELS.topPlayersByCountry}
      summary={stats?.topPlayersByCountry}
      testId="top-players-by-country"
    />
  );
}
