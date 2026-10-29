'use client';

import { Eye, EyeOff, ListChecks, Music, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

import BeatmapListRows from '@/components/beatmaps/list/BeatmapListRows';
import BeatmapListTable, {
  type BeatmapTableSelection,
} from '@/components/beatmaps/list/BeatmapListTable';
import BeatmapSelectionBar from '@/components/beatmaps/list/BeatmapSelectionBar';
import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { IconButton } from '@/components/kit/controls/IconButton';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import { Textarea } from '@/components/ui/textarea';
import { hasAdminScope } from '@/lib/auth/roles';
import {
  sortBeatmapTableRows,
  toTournamentBeatmapTableRows,
  type BeatmapTableRow,
} from '@/lib/beatmaps/table-row';
import { useSession } from '@/lib/hooks/useSession';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import { defineListParams, sortParam } from '@/lib/kit/lists/params';
import { useListState } from '@/lib/kit/lists/use-list-state';
import { orpc } from '@/lib/orpc/orpc';
import type {
  TournamentBeatmap,
  TournamentMatchGame,
} from '@/lib/orpc/schema/tournament';
import { beatmapListSortValues } from '@/lib/validation-schema';

interface TournamentBeatmapsAdminViewProps {
  tournamentId: number;
  tournamentName: string;
  beatmaps: TournamentBeatmap[];
  tournamentGames?: TournamentMatchGame[];
}

/** The pool's sort, in the tournament page's address, like the beatmap list's. */
const POOL_PARAMS = defineListParams({
  sort: sortParam(beatmapListSortValues, {
    key: 'gameCount',
    direction: 'desc',
  }),
});

type PoolSortKey = (typeof beatmapListSortValues)[number];

/**
 * The table's sortable columns, for phones, where the rows have no headers.
 * Labelled and grouped like the beatmap list's sort.
 */
const POOL_SORT_OPTIONS: readonly SortOption<PoolSortKey>[] = [
  { value: 'gameCount', label: 'Games' },
  { value: 'sr', label: 'SR', group: 'attributes' },
  { value: 'bpm', label: 'BPM', group: 'attributes' },
  { value: 'cs', label: 'CS', group: 'attributes' },
  { value: 'ar', label: 'AR', group: 'attributes' },
  { value: 'length', label: 'Length', group: 'attributes' },
];

const MAX_BEATMAP_OSU_ID = 20_000_000;

const BEATMAP_ID_PATTERN =
  /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/b\/(\d+)|https:\/\/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|fruits|mania|taiko)\/(\d+))$/;

const splitBeatmapInput = (input: string): string[] =>
  input
    .split(/[,\n]+/)
    .map((id) => id.trim())
    .filter(Boolean);

/** The osu! beatmap ID in one entry, or 0 when the entry is not one. */
function parseBeatmapId(value: string): number {
  const match = value.match(BEATMAP_ID_PATTERN);
  const id = match
    ? Number(match[1] || match[2] || match[3])
    : parseInt(value, 10);
  return Number.isNaN(id) || id <= 0 || id > MAX_BEATMAP_OSU_ID ? 0 : id;
}

const beatmapLabel = (row: BeatmapTableRow) =>
  `${row.artist} - ${row.title} [${row.diffName}]`;

/**
 * The Beatmaps tab: the tournament's pool, sortable like the beatmap list.
 * Admins add beatmaps, show deleted ones, and select beatmaps to unlink.
 */
export default function TournamentBeatmapsAdminView({
  tournamentId,
  tournamentName,
  beatmaps,
  tournamentGames = [],
}: TournamentBeatmapsAdminViewProps) {
  const session = useSession();
  const router = useRouter();
  const isAdmin = hasAdminScope(session?.scopes);
  // The whole pool is on the client already: a sort only rewrites the address.
  const { state, setState } = useListState(POOL_PARAMS, { shallow: true });
  const textareaId = useId();

  const [selectedBeatmapIds, setSelectedBeatmapIds] = useState<Set<number>>(
    new Set()
  );
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [beatmapIdsToAdd, setBeatmapIdsToAdd] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  const rows = useMemo(
    () => toTournamentBeatmapTableRows(beatmaps, tournamentGames),
    [beatmaps, tournamentGames]
  );
  const deletedCount = rows.filter((row) => row.isDeleted).length;
  const visibleCount = rows.length - deletedCount;

  const visibleRows = useMemo(() => {
    const shown = showDeleted ? rows : rows.filter((row) => !row.isDeleted);
    return sortBeatmapTableRows(
      shown,
      state.sort.key,
      state.sort.direction === 'desc'
    );
  }, [rows, showDeleted, state.sort]);

  // Hidden rows drop out of the pending selection.
  const selectedRows = useMemo(
    () => visibleRows.filter((row) => selectedBeatmapIds.has(row.id)),
    [visibleRows, selectedBeatmapIds]
  );

  const toggleSelecting = useCallback(() => {
    setIsSelecting((previous) => {
      if (previous) setSelectedBeatmapIds(new Set());
      return !previous;
    });
  }, []);

  const selection = useMemo<BeatmapTableSelection>(
    () => ({
      isSelected: (row) => selectedBeatmapIds.has(row.id),
      onSelect: (row, checked) =>
        setSelectedBeatmapIds((previous) => {
          const next = new Set(previous);
          if (checked) next.add(row.id);
          else next.delete(row.id);
          return next;
        }),
      allSelected:
        visibleRows.length > 0 && selectedRows.length === visibleRows.length,
      onSelectAll: (checked) =>
        setSelectedBeatmapIds(
          checked ? new Set(visibleRows.map((row) => row.id)) : new Set()
        ),
      getRowLabel: (row: BeatmapTableRow) => row.title,
    }),
    [selectedBeatmapIds, selectedRows, visibleRows]
  );

  const removeSelected = async () => {
    const result = await orpc.tournaments.admin.manageBeatmaps({
      tournamentId,
      addBeatmapOsuIds: [],
      removeBeatmapIds: selectedRows.map((row) => row.id),
    });

    result.warnings?.forEach((warning) => toast.warning(warning));
    toast.success(
      `Successfully removed ${formatCountOf(selectedRows.length, 'beatmap')}`
    );
    setSelectedBeatmapIds(new Set());
    router.refresh();
  };

  const addBeatmaps = async () => {
    const entries = splitBeatmapInput(beatmapIdsToAdd);

    if (entries.length === 0) {
      toast.error('Please enter beatmap IDs or URLs');
      return;
    }

    const invalid = entries.filter((entry) => parseBeatmapId(entry) === 0);
    if (invalid.length > 0) {
      const listed = invalid
        .slice(0, 3)
        .map((entry) => `"${entry}"`)
        .join(', ');
      toast.error(
        invalid.length === 1
          ? `Invalid beatmap ID: ${listed}. IDs must be positive integers not exceeding ${formatCount(MAX_BEATMAP_OSU_ID)}.`
          : `Invalid beatmap IDs found: ${listed}${invalid.length > 3 ? ` and ${formatCount(invalid.length - 3)} more` : ''}. IDs must be positive integers not exceeding ${formatCount(MAX_BEATMAP_OSU_ID)}.`
      );
      return;
    }

    const uniqueIds = Array.from(new Set(entries.map(parseBeatmapId)));

    setIsAdding(true);
    try {
      const result = await orpc.tournaments.admin.manageBeatmaps({
        tournamentId,
        addBeatmapOsuIds: uniqueIds,
        removeBeatmapIds: [],
      });

      result.warnings?.forEach((warning) => toast.warning(warning));

      const { addedCount, skippedCount } = result;
      if (addedCount === 0 && skippedCount > 0) {
        toast.success(
          `No new beatmaps were added. Skipped ${formatCountOf(skippedCount, 'already pooled beatmap')}.`
        );
      } else {
        toast.success(
          [
            `Added ${formatCountOf(addedCount, 'beatmap')}.`,
            skippedCount > 0
              ? `Skipped ${formatCountOf(skippedCount, 'beatmap')} already pooled.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')
        );
      }
      setBeatmapIdsToAdd('');
      setIsAddDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error('Failed to add beatmaps');
      console.error('Error adding beatmaps:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const selecting = isAdmin && isSelecting;
  const meta = `${formatCountOf(visibleCount, 'beatmap')}${
    deletedCount > 0 ? ` · ${formatCount(deletedCount)} deleted` : ''
  }`;

  return (
    <Panel>
      <SectionHeader
        icon={Music}
        title="Pooled beatmaps"
        meta={meta}
        actions={
          isAdmin ? (
            <>
              <IconButton
                data-testid="tournament-beatmaps-select-mode"
                label={isSelecting ? 'Done selecting' : 'Select beatmaps'}
                icon={ListChecks}
                aria-pressed={isSelecting}
                onClick={toggleSelecting}
                className={isSelecting ? 'bg-accent' : undefined}
              />
              {deletedCount > 0 && (
                <IconButton
                  data-testid="tournament-beatmaps-toggle-deleted"
                  label={
                    showDeleted
                      ? 'Hide deleted beatmaps'
                      : 'Show deleted beatmaps'
                  }
                  tooltip={
                    showDeleted
                      ? 'Hide deleted beatmaps'
                      : `Show ${formatCountOf(deletedCount, 'deleted beatmap')}`
                  }
                  icon={showDeleted ? EyeOff : Eye}
                  aria-pressed={showDeleted}
                  onClick={() => setShowDeleted(!showDeleted)}
                />
              )}
              {/* Labelled from sm; phones keep the icon, the strip is tight. */}
              <IconButton
                label="Add beatmaps"
                icon={Plus}
                onClick={() => setIsAddDialogOpen(true)}
                className="sm:hidden"
              />
              <Button
                data-testid="tournament-beatmaps-add"
                variant="outline"
                size="sm"
                icon={Plus}
                onClick={() => setIsAddDialogOpen(true)}
                className="max-sm:hidden"
              >
                Add beatmaps
              </Button>
            </>
          ) : undefined
        }
      />

      {visibleRows.length === 0 ? (
        <EmptyState
          data-testid="tournament-beatmaps-empty"
          icon={Music}
          title="No beatmaps pooled"
          description="This tournament has no pooled beatmaps."
        />
      ) : (
        <BeatmapListTable
          beatmaps={visibleRows}
          sort={state.sort.key}
          descending={state.sort.direction === 'desc'}
          onSortChange={(key, descending) =>
            setState({
              sort: { key, direction: descending ? 'desc' : 'asc' },
            })
          }
          showTournamentCount={false}
          // A pool runs to a hundred rows or more: keep the headers in view.
          stickyHeader
          selection={selecting ? selection : undefined}
          // Selecting keeps the table on phones, wide enough for its checkboxes.
          minWidthClassName={selecting ? 'min-w-[44rem]' : undefined}
          // The beatmap list's phone rows: cover with its preview, mapper,
          // star rating and mods, each row one link.
          phoneRows={
            selecting ? undefined : (
              <BeatmapListRows
                beatmaps={visibleRows}
                pool
                aria-label="Pooled beatmaps"
              />
            )
          }
          phoneSort={
            <SortControl
              size="sm"
              label="Sort pooled beatmaps by"
              options={POOL_SORT_OPTIONS}
              value={state.sort}
              onValueChange={(sort) => setState({ sort })}
            />
          }
        />
      )}

      {selecting && selectedRows.length > 0 && (
        <BeatmapSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedBeatmapIds(new Set())}
        >
          <Button
            data-testid="tournament-beatmaps-remove"
            variant="destructive"
            size="sm"
            icon={Trash2}
            className="rounded-full"
            onClick={() => setIsRemoveDialogOpen(true)}
          >
            Remove
          </Button>
        </BeatmapSelectionBar>
      )}

      {isAdmin && (
        <>
          <DialogTemplate
            open={isAddDialogOpen}
            onOpenChange={(open) => {
              if (isAdding) return;
              setIsAddDialogOpen(open);
              if (!open) setBeatmapIdsToAdd('');
            }}
            title="Add beatmaps"
            description="Enter osu! beatmap IDs or URLs to add to the tournament pool. Beatmaps already in the pool are skipped."
            onSubmit={(event) => {
              event.preventDefault();
              void addBeatmaps();
            }}
            footer={
              <>
                <Button
                  variant="outline"
                  disabled={isAdding}
                  onClick={() => {
                    setIsAddDialogOpen(false);
                    setBeatmapIdsToAdd('');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" icon={Plus} pending={isAdding}>
                  {isAdding ? 'Adding…' : 'Add beatmaps'}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <FormFieldLabel
                htmlFor={textareaId}
                hint="Separate with commas or new lines"
              >
                Beatmaps
              </FormFieldLabel>
              <Textarea
                id={textareaId}
                placeholder="Enter beatmap IDs or URLs"
                value={beatmapIdsToAdd}
                onChange={(event) => setBeatmapIdsToAdd(event.target.value)}
                className="field-sizing-fixed"
                rows={5}
              />
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                <li>Direct beatmap ID (e.g., 1234567)</li>
                <li>Beatmap URL (e.g., https://osu.ppy.sh/b/1234567)</li>
                <li>
                  Beatmapset URL (e.g.,
                  https://osu.ppy.sh/beatmapsets/123#osu/456)
                </li>
              </ul>
            </div>
          </DialogTemplate>

          <ConfirmDialog
            open={isRemoveDialogOpen}
            onOpenChange={setIsRemoveDialogOpen}
            title={`Remove ${formatCountOf(selectedRows.length, 'beatmap')}?`}
            description={
              <>
                <p>
                  This will unlink the selected beatmaps from {tournamentName}.
                  The beatmaps themselves will not be deleted from the system.
                </p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Remove beatmaps"
            pendingLabel="Removing…"
            errorText="Failed to remove beatmaps"
            onConfirm={removeSelected}
          >
            <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-sm">
              {selectedRows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline gap-2 px-3 py-1.5"
                >
                  <Link
                    href={`/beatmaps/${row.osuId}`}
                    prefetch={false}
                    className="shrink-0 text-muted-foreground tabular-nums underline decoration-dotted underline-offset-2 transition-colors hover:text-link"
                  >
                    {formatId(row.osuId || row.id)}
                  </Link>
                  <span
                    className={
                      row.isDeleted
                        ? 'min-w-0 truncate text-muted-foreground line-through'
                        : 'min-w-0 truncate'
                    }
                  >
                    {beatmapLabel(row)}
                  </span>
                  {row.isDeleted && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Deleted from osu!
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </ConfirmDialog>
        </>
      )}
    </Panel>
  );
}
