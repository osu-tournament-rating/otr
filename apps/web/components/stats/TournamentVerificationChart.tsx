'use client';

import { CountBarChart } from '@/components/kit/charts/CountBarChart';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { formatCount, formatPercent } from '@/lib/kit/format/number';
import type { VerificationStatusKey } from '@/lib/orpc/schema/stats';
import type { VerificationSummaryData } from '@/lib/orpc/schema/statsPage';

import { STATS_PANELS, VERIFICATION_TILE_LABELS } from './chart-panels';
import {
  formatDaysToVerify,
  getVerificationBars,
  sumCounts,
} from './stats-data';

/**
 * Every tournament by verification status. Pending, Pre-verified and
 * Pre-rejected share one "Not in ratings yet" bar, as everywhere else.
 * Above the chart, how fast tournaments were verified lately.
 */
export default function TournamentVerificationChart({
  verificationCounts,
  summary,
}: {
  verificationCounts: Partial<Record<VerificationStatusKey, number>>;
  summary: VerificationSummaryData;
}) {
  const bars = getVerificationBars(verificationCounts);
  const total = sumCounts(bars);
  const windowLabel = `Last ${summary.windowDays} days`;

  return (
    <Panel data-testid="chart-tournament-verification">
      <SectionHeader
        {...STATS_PANELS.verification}
        meta={total > 0 ? `${formatCount(total)} tournaments` : undefined}
      />
      {total === 0 ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.verification.icon}
          title="No verification data"
        />
      ) : (
        <PanelBody className="flex flex-col gap-3">
          <StatTileGrid columns={2}>
            <StatTile
              label={VERIFICATION_TILE_LABELS[0]}
              value={formatDaysToVerify(summary.medianDays)}
              sub={`Median, ${windowLabel.toLowerCase()}`}
              infoText="From a tournament's end to its first verification"
            />
            <StatTile
              label={VERIFICATION_TILE_LABELS[1]}
              value={formatCount(summary.tournaments)}
              sub={windowLabel}
            />
          </StatTileGrid>
          <CountBarChart
            data={bars}
            layout="rows"
            valueName="Tournaments"
            className="h-48"
            footer={(bar) =>
              `${formatPercent(bar.count / total)} of all tournaments`
            }
          />
        </PanelBody>
      )}
    </Panel>
  );
}
