import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import type { HeadlineTotalsData } from '@/lib/orpc/schema/statsPage';

import { OVERVIEW_LABELS, STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';

/**
 * Totals over every ruleset: the live count of verified tournaments, then
 * the stored headline totals.
 */
export default function OverviewPanel({
  tournaments,
  totals,
}: {
  /** Verified tournaments now, the count the verification chart shows. */
  tournaments: number;
  totals: HeadlineTotalsData | null;
}) {
  return (
    <Panel data-testid="stats-overview">
      <SectionHeader {...STATS_PANELS.overview} />
      {tournaments === 0 ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.overview.icon}
          title="No verified tournaments yet"
        />
      ) : totals === null ? (
        <NotCalculatedYet icon={STATS_PANELS.overview.icon} />
      ) : (
        <PanelBody>
          <StatTileGrid columns={4}>
            <StatTile
              label={OVERVIEW_LABELS[0]}
              value={formatCount(tournaments)}
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
