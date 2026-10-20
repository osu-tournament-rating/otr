'use client';

import { Heatmap, type HeatmapAxisItem } from '@/components/kit/charts/Heatmap';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
} from '@/lib/kit/charts/ticks';
import { formatCountOf, formatPercent } from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';

import { STATS_PANELS } from './chart-panels';
import { useRulesetStats } from './ruleset-stats';
import { HOURS, WEEKDAYS, formatHourRange } from './stats-data';

const ROWS: HeatmapAxisItem[] = WEEKDAYS.map((day) => ({
  key: day.short,
  label: day.short,
}));

const COLUMNS: HeatmapAxisItem[] = HOURS.map((hour) => ({
  key: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

/**
 * When the page's ruleset's verified matches started, by UTC weekday and
 * hour, as a heatmap.
 */
export default function MatchTimesPanel() {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const { stats } = useRulesetStats();
  const data = stats?.matchStartTimes;
  const copy = STATS_PANELS.matchTimes;
  const total = data?.matches ?? 0;

  return (
    <Panel data-testid="match-times">
      <SectionHeader
        {...copy}
        level={3}
        meta={total > 0 ? formatCountOf(total, 'match', 'matches') : undefined}
      />
      {!data || total === 0 ? (
        <EmptyState
          size="compact"
          icon={copy.icon}
          title="No verified matches in this ruleset"
        />
      ) : (
        <PanelBody>
          <Heatmap
            aria-label={copy.title}
            rows={ROWS}
            columns={COLUMNS}
            values={data.weekdays}
            columnTicks={getCategoryTicks([...HOURS], maxTicks).map(String)}
            valueName="Matches"
            cellTitle={(row, column) => {
              const day = WEEKDAYS.find((item) => item.short === row.key);
              return `${day?.long ?? row.label}, ${formatHourRange(Number(column.key))}`;
            }}
            footer={(value) => `${formatPercent(value / total)} of matches`}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
