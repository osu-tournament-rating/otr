'use client';

import {
  AdminNoteRouteTarget,
  AuditEntityType,
  ReportEntityType,
} from '@otr/core/osu';
import {
  CalendarDays,
  ExternalLink,
  FileMusic,
  History,
  ListChecks,
  NotebookPen,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Target,
  Trash2,
  Unlink,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { DELETE_CASCADE_DESCRIPTION } from '@/components/admin-forms/adminFormFields';
import { AdminNotesDialog } from '@/components/admin-notes/AdminNotesDialog';
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { IconButton } from '@/components/kit/controls/IconButton';
import { DateRangeText } from '@/components/kit/format/DateRangeText';
import { RulesetName } from '@/components/kit/format/RulesetName';
import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import { Badge } from '@/components/kit/status/Badge';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import ReportButton from '@/components/reports/ReportButton';
import TournamentEditDialog, {
  type EditableTournament,
} from '@/components/tournaments/TournamentEditDialog';
import type { TournamentTab } from '@/components/tournaments/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { entityTypeToSlug } from '@/lib/audit-entity-types';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCount } from '@/lib/kit/format/number';
import { formatBadgeCount } from '@/lib/kit/status/count';
import { getRejectionReasonTexts } from '@/lib/kit/status/reasons';
import { orpc } from '@/lib/orpc/orpc';
import type { TournamentDetail } from '@/lib/orpc/schema/tournament';

/** What the hero needs: the tournament without its matches, pool and stats. */
export type TournamentHeroData = EditableTournament &
  Pick<
    TournamentDetail,
    'isLazer' | 'adminNotes' | 'verifiedByUsername' | 'submittedByUsername'
  >;

type AdminAction =
  | 'edit'
  | 'notes'
  | 'accept'
  | 'reset'
  | 'refetchMatches'
  | 'refetchBeatmaps'
  | 'unlinkBeatmaps'
  | 'delete';

function showWarnings(warnings: readonly string[] | undefined) {
  warnings?.forEach((warning) => toast.warning(warning));
}

/**
 * The top of the tournament page: the name, status and format, the one
 * Admin menu with every admin action and its confirmation, the public
 * actions (report, audit history, the forum post) and the view tabs.
 */
export default function TournamentHero({
  tournament,
  tab,
  counts,
  pendingRating = false,
}: {
  tournament: TournamentHeroData;
  tab: TournamentTab;
  /** What the Matches and Beatmaps tabs hold (visible pooled beatmaps). */
  counts: { matches: number; beatmaps: number };
  /** Verified, but the Tuesday update has not rated it yet. */
  pendingRating?: boolean;
}) {
  const session = useSession();
  const router = useRouter();
  const isAdmin = hasAdminScope(session?.scopes ?? []);
  const resetCheckboxId = useId();
  const [open, setOpen] = useState<AdminAction | null>(null);
  const [resetVerified, setResetVerified] = useState(false);

  const notes = tournament.adminNotes ?? [];
  const tabHref = (value: TournamentTab) =>
    `/tournaments/${tournament.id}?tab=${value}`;
  const dialog = (action: AdminAction) => ({
    open: open === action,
    onOpenChange: (next: boolean) => setOpen(next ? action : null),
  });

  return (
    <>
      <DetailHero
        title={tournament.name}
        titleSuffix={tournament.abbreviation}
        status={
          <VerificationStatusBadge
            status={tournament.verificationStatus}
            rejectionReasons={getRejectionReasonTexts(
              'tournament',
              tournament.rejectionReason
            )}
            reviewer={tournament.verifiedByUsername ?? undefined}
            pendingRating={pendingRating}
            tooltip="tap"
          />
        }
        meta={
          <>
            <HeroMetaItem>
              <RulesetName ruleset={tournament.ruleset} />
            </HeroMetaItem>
            <HeroMetaItem icon={Users}>
              {formatLobbySize(tournament.lobbySize)}
            </HeroMetaItem>
            <HeroMetaItem icon={Target} className="tabular-nums">
              {formatRankRange(tournament.rankRangeLowerBound)}
            </HeroMetaItem>
            {tournament.startTime || tournament.endTime ? (
              <HeroMetaItem icon={CalendarDays}>
                <DateRangeText
                  start={tournament.startTime}
                  end={tournament.endTime}
                />
              </HeroMetaItem>
            ) : null}
            {tournament.submittedByUsername ? (
              <HeroMetaItem icon={UserPlus}>
                Submitted by {tournament.submittedByUsername}
              </HeroMetaItem>
            ) : null}
            {tournament.isLazer ? <Badge variant="outline">lazer</Badge> : null}
          </>
        }
        adminActions={
          isAdmin ? (
            <AdminMenu
              notification={notes.length > 0 ? 'Has admin notes' : undefined}
              data-testid="tournament-admin-menu"
              actions={[
                {
                  label: 'Edit tournament',
                  icon: PencilLine,
                  onSelect: () => setOpen('edit'),
                },
                {
                  label: 'Admin notes',
                  icon: NotebookPen,
                  trailing:
                    notes.length > 0 ? (
                      <Badge size="sm">{formatBadgeCount(notes.length)}</Badge>
                    ) : undefined,
                  onSelect: () => setOpen('notes'),
                },
                {
                  label: 'Accept pre-verification statuses',
                  icon: ListChecks,
                  group: 'data',
                  onSelect: () => setOpen('accept'),
                },
                {
                  label: 'Reset automated checks',
                  icon: RotateCcw,
                  group: 'data',
                  onSelect: () => setOpen('reset'),
                },
                {
                  label: 'Refetch match data',
                  icon: RefreshCw,
                  group: 'data',
                  onSelect: () => setOpen('refetchMatches'),
                },
                {
                  label: 'Refetch beatmap data',
                  icon: FileMusic,
                  group: 'data',
                  onSelect: () => setOpen('refetchBeatmaps'),
                },
                {
                  label: 'Unlink pooled beatmaps',
                  icon: Unlink,
                  destructive: true,
                  onSelect: () => setOpen('unlinkBeatmaps'),
                },
                {
                  label: 'Delete tournament',
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => setOpen('delete'),
                },
              ]}
            />
          ) : null
        }
        actions={
          <>
            <ReportButton
              variant="outline"
              entityType={ReportEntityType.Tournament}
              entityId={tournament.id}
              entityDisplayName={tournament.name}
            />
            {!isAdmin && notes.length > 0 ? (
              <IconButton
                variant="outline"
                icon={NotebookPen}
                label="Admin notes"
                onClick={() => setOpen('notes')}
              />
            ) : null}
            <IconButton
              asChild
              variant="outline"
              icon={History}
              label="View audit history"
            >
              <Link
                href={`/audit/${entityTypeToSlug(AuditEntityType.Tournament)}/${tournament.id}`}
                prefetch={false}
              />
            </IconButton>
            <IconButton
              asChild
              variant="outline"
              icon={ExternalLink}
              label="View on osu!"
            >
              <a
                href={tournament.forumUrl}
                target="_blank"
                rel="noopener noreferrer"
              />
            </IconButton>
          </>
        }
        tabs={
          <HeroTabs
            aria-label="Tournament views"
            value={tab}
            // With the counts, four tabs are wider than a 360px phone's hero;
            // below `sm` the counts stay in each tab's accessible name.
            countsFrom="sm"
            data-testid="tournament-tabs"
            items={[
              {
                value: 'matches',
                label: 'Matches',
                count: formatCount(counts.matches),
                href: tabHref('matches'),
                testId: 'tab-matches',
              },
              {
                value: 'beatmaps',
                label: 'Beatmaps',
                count: formatCount(counts.beatmaps),
                href: tabHref('beatmaps'),
                testId: 'tab-beatmaps',
              },
              {
                value: 'ratings',
                label: 'Ratings',
                href: tabHref('ratings'),
                testId: 'tab-ratings',
              },
              {
                value: 'stats',
                label: 'Stats',
                href: tabHref('stats'),
                testId: 'tab-stats',
              },
            ]}
          />
        }
      />

      <AdminNotesDialog
        {...dialog('notes')}
        notes={notes}
        entity={AdminNoteRouteTarget.Tournament}
        entityId={tournament.id}
        entityDisplayName={tournament.name}
      />

      {isAdmin ? (
        <>
          <TournamentEditDialog tournament={tournament} {...dialog('edit')} />

          <ConfirmDialog
            {...dialog('accept')}
            tone="default"
            title="Accept pre-verification statuses?"
            description={
              <>
                <p>
                  Pre-rejected items will be marked as rejected and pre-verified
                  items as verified. Everything under a rejected item will be
                  rejected.
                </p>
                <p>
                  This processes the tournament and all its children (matches,
                  games, scores). This action cannot be undone.
                </p>
              </>
            }
            confirmLabel="Accept pre-verification statuses"
            pendingLabel="Processing…"
            errorText="Failed to accept pre-verification statuses"
            onConfirm={async () => {
              await orpc.tournaments.admin.acceptPreVerificationStatuses({
                id: tournament.id,
              });
              toast.success('Pre-verification statuses accepted successfully');
              router.refresh();
            }}
          />

          <ConfirmDialog
            open={open === 'reset'}
            onOpenChange={(next) => {
              setOpen(next ? 'reset' : null);
              if (!next) setResetVerified(false);
            }}
            title="Reset automated checks?"
            description={
              <>
                <p>This action will cascade to all children.</p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Reset automated checks"
            pendingLabel="Resetting…"
            errorText="Failed to reset automated checks"
            onConfirm={async () => {
              const result = await orpc.tournaments.admin.resetAutomatedChecks({
                id: tournament.id,
                overrideVerifiedState: resetVerified,
              });
              showWarnings(result.warnings);
              toast.success('Queued automated checks re-run');
              router.refresh();
            }}
          >
            <div className="flex items-center gap-2">
              <Checkbox
                id={resetCheckboxId}
                checked={resetVerified}
                onCheckedChange={(checked) =>
                  setResetVerified(checked === true)
                }
              />
              <Label htmlFor={resetCheckboxId}>
                Reset verified and rejected data
              </Label>
            </div>
          </ConfirmDialog>

          <ConfirmDialog
            {...dialog('refetchMatches')}
            title="Refetch match data?"
            description={
              <>
                <p>
                  All match data will be refetched. If a match has since been
                  deleted from osu!, the data could be permanently lost.
                </p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Refetch match data"
            pendingLabel="Queueing…"
            errorText="Failed to queue match data for refetch"
            onConfirm={async () => {
              const result = await orpc.tournaments.admin.refetchMatchData({
                id: tournament.id,
              });
              showWarnings(result.warnings);
              toast.success(
                result.matchesUpdated > 0
                  ? `Queued ${formatCount(result.matchesUpdated)} matches for refetch`
                  : 'Queued match data for refetch'
              );
              router.refresh();
            }}
          />

          <ConfirmDialog
            {...dialog('refetchBeatmaps')}
            tone="default"
            title="Refetch beatmap data?"
            description={
              <>
                <p>
                  All tournament beatmaps will be refetched from osu!. Valid
                  beatmaps are updated with the latest data; deleted beatmaps
                  keep their existing data.
                </p>
                <p>
                  Missing players will be created from beatmap and beatmapset
                  creators.
                </p>
              </>
            }
            confirmLabel="Refetch beatmap data"
            pendingLabel="Queueing…"
            errorText="Failed to queue beatmap data for refetch"
            onConfirm={async () => {
              const result = await orpc.tournaments.admin.refetchBeatmaps({
                id: tournament.id,
              });
              showWarnings(result.warnings);
              toast.success(
                result.beatmapsUpdated > 0
                  ? `Queued ${formatCount(result.beatmapsUpdated)} ${result.beatmapsUpdated === 1 ? 'beatmap' : 'beatmaps'} for refetch` +
                      (result.beatmapsSkipped > 0
                        ? ` (${formatCount(result.beatmapsSkipped)} deleted ${result.beatmapsSkipped === 1 ? 'beatmap' : 'beatmaps'} skipped)`
                        : '')
                  : 'No beatmaps to refetch'
              );
              router.refresh();
            }}
          />

          <ConfirmDialog
            {...dialog('unlinkBeatmaps')}
            title="Unlink pooled beatmaps?"
            description={
              <>
                <p>
                  This action unlinks all beatmaps from the tournament. The
                  beatmaps themselves will not be deleted from the system.
                </p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Unlink pooled beatmaps"
            pendingLabel="Unlinking…"
            errorText="Failed to unlink pooled beatmaps"
            onConfirm={async () => {
              await orpc.tournaments.admin.deleteBeatmaps({
                id: tournament.id,
              });
              toast.success('Pooled beatmaps unlinked successfully');
              router.refresh();
            }}
          />

          <ConfirmDialog
            {...dialog('delete')}
            title="Delete this tournament?"
            description={DELETE_CASCADE_DESCRIPTION}
            confirmLabel="Delete tournament"
            pendingLabel="Deleting…"
            errorText="Failed to delete tournament"
            onConfirm={async () => {
              await orpc.tournaments.admin.delete({ id: tournament.id });
              toast.success('Tournament deleted successfully');
              router.replace('/tournaments');
              router.refresh();
            }}
          />
        </>
      ) : null}
    </>
  );
}
