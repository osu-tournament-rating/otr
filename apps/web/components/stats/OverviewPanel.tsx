import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import type { HeadlineTotalsData } from '@/lib/orpc/schema/statsPage';

import { OVERVIEW_LABELS, STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';

/** Totals over every ruleset, from the stored headline totals. */
export default function OverviewPanel({
  totals,
}: {
  totals: HeadlineTotalsData | null;
}) {
  return (
    <Panel data-testid="stats-overview">
      <SectionHeader {...STATS_PANELS.overview} />
      {totals === null ? (
        <NotCalculatedYet icon={STATS_PANELS.overview.icon} />
      ) : totals.tournaments === 0 ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.overview.icon}
          title="No verified tournaments yet"
        />
      ) : (
        <PanelBody>
          <StatTileGrid columns={4}>
            <StatTile
              label={OVERVIEW_LABELS[0]}
              value={formatCount(totals.tournaments)}
            />
            <StatTile
              label={OVERVIEW_LABELS[1]}
              value={formatCount(totals.matches)}
              sub={formatCountOf(totals.games, 'game')}
            />
            <StatTile
              label={OVERVIEW_LABELS[2]}
              value={formatCount(totals.scores)}
            />
            <StatTile
              label={OVERVIEW_LABELS[3]}
              value={formatCount(totals.ratedPlayers)}
            />
          </StatTileGrid>
        </PanelBody>
      )}
    </Panel>
  );
}
