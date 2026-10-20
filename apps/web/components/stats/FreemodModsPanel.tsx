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
import { CATEGORICAL_OTHER } from '@/lib/kit/color/categorical';
import { getModPaletteColor } from '@/lib/kit/color/mods';
import { formatCountOf } from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';

import { STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';
import { getFreemodModBars } from './stats-data';

/**
 * The share of each mod combination among the scores on freemod maps in
 * the page's ruleset, per year, in the mod palette's colours.
 */
export default function FreemodModsPanel() {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const { stats } = useRulesetStats();
  const data = stats?.freemodMods ?? null;
  const copy = STATS_PANELS.freemodMods;
  const bars = data ? getFreemodModBars(data) : [];
  const scores = bars.reduce((sum, bar) => sum + (bar.total ?? 0), 0);
  const games = new Map(
    (data?.years ?? []).map((entry) => [String(entry.year), entry.games])
  );
  const series = (data?.series ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    color:
      item.mods === null
        ? CATEGORICAL_OTHER.css
        : getModPaletteColor(item.mods),
  }));

  return (
    <Panel data-testid="freemod-mods">
      <SectionHeader
        {...copy}
        level={3}
        meta={scores > 0 ? formatCountOf(scores, 'score') : undefined}
      />
      {data === null ? (
        <NotCalculatedYet icon={copy.icon} />
      ) : scores === 0 ? (
        <EmptyState size="compact" icon={copy.icon} title="Not enough data" />
      ) : (
        <PanelBody>
          <StackedBarChart
            data={bars}
            series={series}
            mode="share"
            className="h-72"
            categoryTicks={getCategoryTicks(
              bars.map((bar) => Number(bar.key)),
              maxTicks
            ).map(formatYearTick)}
            footer={(bar) =>
              `${formatCountOf(bar.total ?? 0, 'score')} in ${formatCountOf(games.get(bar.key) ?? 0, 'game')}`
            }
          />
        </PanelBody>
      )}
    </Panel>
  );
}
