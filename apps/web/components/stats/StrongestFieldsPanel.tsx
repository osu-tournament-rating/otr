'use client';

import { FIELD_SIZE, RECENT_MONTHS } from '@otr/core/platform-stats/constants';

import TierIcon from '@/components/icons/TierIcon';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { formatDateRange } from '@/lib/kit/format/date';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCountOf, formatRating } from '@/lib/kit/format/number';
import type { StrongestFieldData } from '@/lib/orpc/schema/statsPage';
import { getTierFromRating } from '@/lib/utils/tierData';

import { STATS_PANELS } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';

const IN_WINDOW = `in the last ${RECENT_MONTHS} months`;

function StrongestFieldRow({ field }: { field: StrongestFieldData }) {
  const { tier, subTier } = getTierFromRating(field.rating);

  return (
    <RowListItem
      title={
        <EntityLink
          href={`/tournaments/${field.tournamentId}`}
          title={field.name}
        >
          {field.name}
        </EntityLink>
      }
      description={[
        formatDateRange(field.startTime, field.endTime),
        formatLobbySize(field.lobbySize),
        formatRankRange(field.rankRangeLowerBound),
      ].join(' · ')}
      trailing={
        <span className="flex flex-col items-end">
          <span className="flex items-center gap-1 font-semibold tabular-nums">
            <TierIcon
              tier={tier}
              subTier={subTier}
              tooltip
              width={20}
              height={20}
            />
            {formatRating(field.rating)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCountOf(field.players, 'player')}
          </span>
        </span>
      }
    />
  );
}

/**
 * Tournaments of the last 12 months in the page's ruleset whose 16
 * highest-rated players came in with the highest average rating.
 */
export default function StrongestFieldsPanel() {
  const { stats } = useRulesetStats();
  const data = stats?.strongestFields ?? null;
  const copy = STATS_PANELS.strongestFields;

  return (
    <Panel data-testid="strongest-fields">
      <SectionHeader
        {...copy}
        level={3}
        meta={
          data && data.total > 0
            ? `${formatCountOf(data.total, 'tournament')} ${IN_WINDOW}`
            : undefined
        }
      />
      {data === null ? (
        <NotCalculatedYet icon={copy.icon} />
      ) : data.tournaments.length === 0 ? (
        <EmptyState
          size="compact"
          icon={copy.icon}
          title={`No tournaments with ${FIELD_SIZE} rated players ${IN_WINDOW}`}
        />
      ) : (
        <RowList aria-label={copy.title}>
          {data.tournaments.map((field) => (
            <StrongestFieldRow key={field.tournamentId} field={field} />
          ))}
        </RowList>
      )}
    </Panel>
  );
}
