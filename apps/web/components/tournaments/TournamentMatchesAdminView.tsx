'use client';

import { Plus, Swords, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { IconButton } from '@/components/kit/controls/IconButton';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { SortControl } from '@/components/kit/lists/SortControl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import { useListState } from '@/lib/kit/lists/use-list-state';
import { orpc } from '@/lib/orpc/orpc';
import { cn } from '@/lib/utils';

import TournamentMatchesLedger from './TournamentMatchesLedger';
import {
  MATCH_SORT_OPTIONS,
  TOURNAMENT_MATCH_PARAMS,
  type MatchRow,
} from './matchRow';

interface TournamentMatchesAdminViewProps {
  tournamentId: number;
  tournamentName: string;
  matches: MatchRow[];
  isLazer: boolean;
}

const MATCH_LINK_PATTERN =
  /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/(?:community\/matches|mp)\/(\d+))$/;
const MAX_MATCH_ID = 2_000_000_000;

/** The osu! match ID in one entry, or 0 when the entry is not one. */
function parseMatchId(value: string): number {
  const match = value.trim().match(MATCH_LINK_PATTERN);
  const id = match ? Number(match[1] || match[2]) : parseInt(value, 10);
  return Number.isNaN(id) || id <= 0 || id > MAX_MATCH_ID ? 0 : id;
}

const splitEntries = (input: string) =>
  input
    .split(/[,\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);

/**
 * The Matches tab: the tournament's matches, sorted by the toolbar (kept in
 * the address). Admins also add matches and remove a selection of them.
 */
export default function TournamentMatchesAdminView({
  tournamentId,
  tournamentName,
  matches,
  isLazer,
}: TournamentMatchesAdminViewProps) {
  const session = useSession();
  const router = useRouter();
  const isAdmin = hasAdminScope(session?.scopes);
  // Every match is on the client already: a sort only rewrites the address.
  const { state, setState } = useListState(TOURNAMENT_MATCH_PARAMS, {
    shallow: true,
  });
  const lazerCheckboxId = useId();

  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(
    new Set()
  );
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [matchIdsToAdd, setMatchIdsToAdd] = useState('');
  const [addAsLazer, setAddAsLazer] = useState(isLazer);

  const handleSelectMatches = useCallback(
    (matchIds: number[], checked: boolean) => {
      setSelectedMatchIds((previous) => {
        const next = new Set(previous);
        for (const matchId of matchIds) {
          if (checked) next.add(matchId);
          else next.delete(matchId);
        }
        return next;
      });
    },
    []
  );

  const handleSelectMatch = useCallback(
    (matchId: number, checked: boolean) =>
      handleSelectMatches([matchId], checked),
    [handleSelectMatches]
  );

  const removeSelected = async () => {
    const result = await orpc.tournaments.admin.manageMatches({
      tournamentId,
      addMatchOsuIds: [],
      removeMatchIds: Array.from(selectedMatchIds),
    });

    result.warnings?.forEach((warning) => toast.warning(warning));
    toast.success(
      `Successfully removed ${formatCountOf(result.removedCount, 'match', 'matches')}`
    );
    setSelectedMatchIds(new Set());
    router.refresh();
  };

  const addMatches = async () => {
    const entries = splitEntries(matchIdsToAdd);

    if (entries.length === 0) {
      toast.error('Please enter match IDs or URLs');
      return;
    }

    const invalid = entries.filter((entry) => parseMatchId(entry) === 0);
    if (invalid.length > 0) {
      const listed = invalid
        .slice(0, 3)
        .map((entry) => `"${entry}"`)
        .join(', ');
      toast.error(
        invalid.length === 1
          ? `Invalid match ID: ${listed}. IDs must be positive integers not exceeding ${formatCount(MAX_MATCH_ID)}.`
          : `Invalid match IDs found: ${listed}${invalid.length > 3 ? ` and ${formatCount(invalid.length - 3)} more` : ''}. IDs must be positive integers not exceeding ${formatCount(MAX_MATCH_ID)}.`
      );
      return;
    }

    const uniqueIds = Array.from(new Set(entries.map(parseMatchId)));

    setIsAdding(true);
    try {
      const result = await orpc.tournaments.admin.manageMatches({
        tournamentId,
        addMatchOsuIds: uniqueIds.map((osuId) => ({
          osuId,
          isLazer: addAsLazer,
        })),
        removeMatchIds: [],
      });

      result.warnings?.forEach((warning) => toast.warning(warning));

      const { addedCount, skippedCount } = result;
      if (addedCount === 0 && skippedCount > 0) {
        toast.success(
          `No new matches were added. Skipped ${formatCountOf(skippedCount, 'already existing match', 'already existing matches')}.`
        );
      } else {
        toast.success(
          [
            `Added ${formatCountOf(addedCount, 'match', 'matches')}.`,
            skippedCount > 0
              ? `Skipped ${formatCountOf(skippedCount, 'match', 'matches')} already existing.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')
        );
      }
      setMatchIdsToAdd('');
      setIsAddDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error('Failed to add matches');
      console.error('Error adding matches:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const selectedMatches = matches.filter((match) =>
    selectedMatchIds.has(match.id)
  );
  const allSelected =
    matches.length > 0 && selectedMatchIds.size === matches.length;

  return (
    <Panel>
      <SectionHeader
        icon={Swords}
        title="Matches"
        // The count is on the Matches tab; the strip keeps its room for the sort.
        actions={
          matches.length > 0 || isAdmin ? (
            <>
              {matches.length > 0 && (
                <SortControl
                  size="sm"
                  className="w-52 md:w-auto"
                  label="Sort matches by"
                  options={MATCH_SORT_OPTIONS}
                  value={state.sort}
                  onValueChange={(sort) => setState({ sort })}
                />
              )}
              {isAdmin && matches.length > 0 && (
                // Beside the sort, a phone's strip has room for the icon
                // only. Outline, as the sort's own button.
                <IconButton
                  variant="outline"
                  label="Add matches"
                  icon={Plus}
                  onClick={() => setIsAddDialogOpen(true)}
                  className="sm:hidden"
                />
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={Plus}
                  onClick={() => setIsAddDialogOpen(true)}
                  className={cn(matches.length > 0 && 'hidden sm:inline-flex')}
                >
                  Add matches
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {matches.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="No matches"
          description="This tournament has no matches."
        />
      ) : (
        <>
          {isAdmin && (
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={
                    selectedMatchIds.size === 0
                      ? false
                      : allSelected
                        ? true
                        : 'indeterminate'
                  }
                  onCheckedChange={(checked) =>
                    setSelectedMatchIds(
                      checked === true
                        ? new Set(matches.map((match) => match.id))
                        : new Set()
                    )
                  }
                  aria-label="Select all matches"
                />
                <span
                  aria-live="polite"
                  className="text-sm text-muted-foreground tabular-nums"
                >
                  {selectedMatchIds.size > 0
                    ? `${formatCount(selectedMatchIds.size)} selected`
                    : 'Select all'}
                </span>
              </div>
              {selectedMatchIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setIsRemoveDialogOpen(true)}
                >
                  Remove selected
                </Button>
              )}
            </div>
          )}

          <TournamentMatchesLedger
            matches={matches}
            sort={state.sort}
            selectedMatchIds={isAdmin ? selectedMatchIds : undefined}
            onSelectMatch={isAdmin ? handleSelectMatch : undefined}
            onSelectMatches={isAdmin ? handleSelectMatches : undefined}
          />
        </>
      )}

      {isAdmin && (
        <>
          <DialogTemplate
            open={isAddDialogOpen}
            onOpenChange={(open) => {
              if (isAdding) return;
              setIsAddDialogOpen(open);
              if (!open) setMatchIdsToAdd('');
            }}
            title="Add matches"
            description="Enter osu! match IDs or URLs to add to the tournament. Match data will be automatically fetched from the osu! API."
            onSubmit={(event) => {
              event.preventDefault();
              void addMatches();
            }}
            footer={
              <>
                <Button
                  variant="outline"
                  disabled={isAdding}
                  onClick={() => {
                    setIsAddDialogOpen(false);
                    setMatchIdsToAdd('');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" icon={Plus} pending={isAdding}>
                  {isAdding ? 'Adding…' : 'Add matches'}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <FormFieldLabel
                htmlFor={`${lazerCheckboxId}-ids`}
                hint="Separate with commas or new lines"
              >
                Matches
              </FormFieldLabel>
              <Textarea
                id={`${lazerCheckboxId}-ids`}
                placeholder="Enter match IDs or URLs"
                value={matchIdsToAdd}
                onChange={(event) => setMatchIdsToAdd(event.target.value)}
                className="field-sizing-fixed"
                rows={5}
              />
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                <li>Direct match ID (e.g., 123456789)</li>
                <li>
                  Match URL (e.g.,
                  https://osu.ppy.sh/community/matches/123456789)
                </li>
                <li>Short URL (e.g., https://osu.ppy.sh/mp/123456789)</li>
              </ul>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={lazerCheckboxId}
                checked={addAsLazer}
                onCheckedChange={(checked) => setAddAsLazer(checked === true)}
              />
              <Label htmlFor={lazerCheckboxId}>Lazer matches</Label>
            </div>
          </DialogTemplate>

          <ConfirmDialog
            open={isRemoveDialogOpen}
            onOpenChange={setIsRemoveDialogOpen}
            title={`Remove ${formatCountOf(selectedMatchIds.size, 'match', 'matches')}?`}
            description={
              <>
                <p>
                  This will permanently delete the selected matches from{' '}
                  {tournamentName}. All games and scores within these matches
                  will also be deleted.
                </p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Remove matches"
            pendingLabel="Removing…"
            errorText="Failed to remove matches"
            onConfirm={removeSelected}
          >
            <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-sm">
              {selectedMatches.map((match) => (
                <li
                  key={match.id}
                  className="flex items-baseline gap-2 px-3 py-1.5"
                >
                  <Link
                    href={`/matches/${match.id}`}
                    prefetch={false}
                    className="shrink-0 text-muted-foreground tabular-nums underline decoration-dotted underline-offset-2 transition-colors hover:text-link"
                  >
                    {formatId(match.id)}
                  </Link>
                  <span className="min-w-0 truncate">
                    {match.name || `Match ${formatId(match.id)}`}
                  </span>
                </li>
              ))}
            </ul>
          </ConfirmDialog>
        </>
      )}
    </Panel>
  );
}
