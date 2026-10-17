'use client';

import { VerificationStatus } from '@otr/core/osu';
import { ChevronRight } from 'lucide-react';
import * as React from 'react';

import ModIconset from '@/components/icons/ModIconset';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { DateRangeText } from '@/components/kit/format/DateRangeText';
import { Tile } from '@/components/kit/layout/Tile';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { formatDateRange } from '@/lib/kit/format/date';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { getRejectionReasonTexts } from '@/lib/kit/status/reasons';
import type { BeatmapTournamentUsage } from '@/lib/orpc/schema/beatmapStats';
import { normalizeBeatmapDisplayMods } from '@/lib/utils/mods';

/** Chronological, newest first; alphabetical within a tie, undated last. */
function byMostRecent(a: BeatmapTournamentUsage, b: BeatmapTournamentUsage) {
  const left = a.endTime ?? a.startTime;
  const right = b.endTime ?? b.startTime;

  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    // Timestamps share one server format, so string order is time order.
    return left < right ? 1 : -1;
  }

  return a.tournament.name.localeCompare(b.tournament.name, 'en-US');
}

function StatusIcon({ row }: { row: BeatmapTournamentUsage }) {
  return (
    <VerificationStatusIcon
      status={row.verificationStatus}
      rejectionReasons={getRejectionReasonTexts(
        'tournament',
        row.rejectionReason
      )}
      context={row.tournament.name}
      tooltip="tap"
    />
  );
}

/** Every tournament that pooled the beatmap, behind the "Pooled in" tile. */
export default function BeatmapPoolsDialog({
  pools,
  accessibleValue,
  children,
}: {
  pools: BeatmapTournamentUsage[];
  /** Trigger's accessible name. */
  accessibleValue: string;
  children: React.ReactNode;
}) {
  // Sorts a copy: the server's most-played-first order is the public contract.
  const rows = React.useMemo(() => [...pools].sort(byMostRecent), [pools]);

  const verifiedCount = rows.filter(
    (row) => row.verificationStatus === VerificationStatus.Verified
  ).length;

  return (
    <DialogTemplate
      trigger={
        <Tile asChild interactive className="relative">
          <button
            type="button"
            data-testid="beatmap-pool-records"
            aria-label={accessibleValue}
          >
            {children}
            <ChevronRight
              className="absolute top-2.5 right-3 size-3.5 text-muted-foreground"
              aria-hidden
            />
          </button>
        </Tile>
      }
      title={`Pooled in ${formatCountOf(rows.length, 'tournament')}`}
      description={`${formatCount(verifiedCount)} verified`}
      size="lg"
      // Wider than the form dialogs: six columns of tournament data.
      className="sm:max-w-[min(64rem,calc(100%-2rem))]"
      bodyClassName="gap-0 p-0"
    >
      {/* Focusable so the list scrolls by keyboard */}
      <div
        tabIndex={0}
        aria-label="Tournaments that pooled this beatmap"
        className="min-h-0 flex-1 overflow-y-auto focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <DataTable
          fixed
          stickyHeader="scroll-area"
          phoneRows={
            <PhoneRowList aria-label="Tournaments that pooled this beatmap">
              {rows.map((row) => (
                <PhoneRow
                  key={row.tournament.id}
                  title={
                    // The name wraps, since its end ("#4", "2026") tells
                    // editions apart; the icon stays level with its first line.
                    <span className="flex min-w-0 items-start gap-1.5">
                      <span className="flex h-5 shrink-0 items-center">
                        <StatusIcon row={row} />
                      </span>
                      <EntityLink
                        href={`/tournaments/${row.tournament.id}`}
                        wrap
                      >
                        {row.tournament.name}
                      </EntityLink>
                    </span>
                  }
                  description={[
                    formatRankRange(row.rankRangeLowerBound),
                    formatLobbySize(row.lobbySize),
                    formatDateRange(row.startTime, row.endTime, {
                      empty: '',
                    }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={
                    row.gameCount > 0
                      ? formatCountOf(row.gameCount, 'game')
                      : undefined
                  }
                >
                  {row.mostCommonMods !== null ? (
                    <PoolMods
                      mods={row.mostCommonMods}
                      freemod={row.mostCommonModsFreemod}
                      className="mt-1 h-4"
                      iconClassName="h-4"
                    />
                  ) : null}
                </PhoneRow>
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Tournament</DataTableHead>
              <DataTableHead className="w-48">Dates</DataTableHead>
              <DataTableHead className="w-32">Rank restriction</DataTableHead>
              <DataTableHead className="w-22">Lobby size</DataTableHead>
              <DataTableHead className="w-20">Mods</DataTableHead>
              <DataTableHead numeric className="w-18">
                Games
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {rows.map((row) => (
              <DataTableRow key={row.tournament.id}>
                <DataTableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusIcon row={row} />
                    <EntityLink
                      href={`/tournaments/${row.tournament.id}`}
                      title={row.tournament.name}
                    >
                      {row.tournament.name}
                    </EntityLink>
                  </div>
                </DataTableCell>
                <DataTableCell muted>
                  <DateRangeText start={row.startTime} end={row.endTime} />
                </DataTableCell>
                <DataTableCell muted>
                  {formatRankRange(row.rankRangeLowerBound)}
                </DataTableCell>
                <DataTableCell muted>
                  {formatLobbySize(row.lobbySize)}
                </DataTableCell>
                <DataTableCell empty={false}>
                  <PoolMods
                    mods={row.mostCommonMods}
                    freemod={row.mostCommonModsFreemod}
                    className="h-5"
                    iconClassName="h-5"
                  />
                </DataTableCell>
                <DataTableCell numeric muted>
                  {row.gameCount > 0 ? formatCount(row.gameCount) : null}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </div>
    </DialogTemplate>
  );
}

/** Null mods means the pool was never played. */
function PoolMods({
  mods,
  freemod,
  className,
  iconClassName,
}: {
  mods: number | null;
  freemod: boolean;
  className: string;
  iconClassName: string;
}) {
  if (mods === null) return <MissingValue label="Never played" />;

  return (
    <ModIconset
      mods={normalizeBeatmapDisplayMods(mods)}
      freemod={freemod}
      className={`flex shrink-0 items-center ${className}`}
      iconClassName={iconClassName}
    />
  );
}
