'use client';

import {
  AdminNoteRouteTarget,
  AuditEntityType,
  ReportEntityType,
} from '@otr/core/osu';
import {
  CalendarDays,
  ExternalLink,
  GitMerge,
  History,
  NotebookPen,
  PencilLine,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';

import { DELETE_CASCADE_DESCRIPTION } from '@/components/admin-forms/adminFormFields';
import { AdminNotesDialog } from '@/components/admin-notes/AdminNotesDialog';
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { IconButton } from '@/components/kit/controls/IconButton';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import { Badge } from '@/components/kit/status/Badge';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import ReportButton from '@/components/reports/ReportButton';
import { entityTypeToSlug } from '@/lib/audit-entity-types';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { formatBadgeCount } from '@/lib/kit/status/count';
import {
  getRejectionReasonTexts,
  getWarningTexts,
} from '@/lib/kit/status/reasons';
import { orpc } from '@/lib/orpc/orpc';
import type { MatchDetail } from '@/lib/orpc/schema/match';

import MatchEditDialog from './MatchEditDialog';
import { getMatchDisplayName } from './matchName';
import MergeMatchDialog from './MergeMatchDialog';

export type MatchTab = 'games' | 'stats';

function osuMatchUrl(match: { osuId: number; isLazer: boolean }) {
  return match.isLazer
    ? `https://osu.ppy.sh/multiplayer/rooms/${match.osuId}`
    : `https://osu.ppy.sh/community/matches/${match.osuId}`;
}

/**
 * The top of the match page: the match's name, status, tournament and time,
 * the Admin menu, public actions (report, audit history, osu!, in the
 * tournament hero's order) and the Games and Stats tabs.
 */
export default function MatchHero({
  match,
  tab,
}: {
  match: MatchDetail;
  tab: MatchTab;
}) {
  const session = useSession();
  const isAdmin = hasAdminScope(session?.scopes ?? []);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewingNotes, setViewingNotes] = useState(false);

  const name = getMatchDisplayName(match);
  const games = match.games ?? [];
  const playerCount = new Set(
    games.flatMap((game) => game.scores.map((score) => score.playerId))
  ).size;
  const noteCount = match.adminNotes?.length ?? 0;
  const mergedMatches = match.mergedMatches ?? [];
  const osuUrl = osuMatchUrl(match);
  const tabHref = (value: MatchTab) => `/matches/${match.id}?tab=${value}`;

  return (
    <>
      <DetailHero
        title={<span data-testid="match-name">{name}</span>}
        status={
          <VerificationStatusBadge
            status={match.verificationStatus}
            warnings={getWarningTexts('match', match.warningFlags)}
            rejectionReasons={getRejectionReasonTexts(
              'match',
              match.rejectionReason
            )}
            reviewer={match.verifiedByUsername ?? undefined}
            tooltip="tap"
          />
        }
        meta={
          <>
            {match.tournament ? (
              <HeroMetaItem icon={Trophy}>
                <EntityLink
                  href={`/tournaments/${match.tournament.id}`}
                  data-testid="match-tournament-link"
                  wrap
                >
                  {match.tournament.name}
                </EntityLink>
              </HeroMetaItem>
            ) : null}
            {match.startTime ? (
              <HeroMetaItem icon={CalendarDays}>
                <Timestamp date={match.startTime} />
              </HeroMetaItem>
            ) : null}
            {playerCount > 0 ? (
              <HeroMetaItem icon={Users}>
                {formatCountOf(playerCount, 'player')}
              </HeroMetaItem>
            ) : null}
            {mergedMatches.length > 0 ? (
              <HeroMetaItem icon={GitMerge} data-testid="match-merged-from">
                Merged from{' '}
                {mergedMatches.map((merged, index) => (
                  <Fragment key={merged.mergedMatchId}>
                    {index > 0 ? ', ' : null}
                    <EntityLink
                      variant="inline"
                      href={osuMatchUrl(merged)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {merged.osuId}
                    </EntityLink>
                  </Fragment>
                ))}
              </HeroMetaItem>
            ) : null}
            {match.isLazer ? <Badge variant="outline">lazer</Badge> : null}
          </>
        }
        adminActions={
          isAdmin ? (
            <AdminMenu
              notification={noteCount > 0 ? 'Has admin notes' : undefined}
              data-testid="match-admin-menu"
              actions={[
                {
                  label: 'Edit match',
                  icon: PencilLine,
                  onSelect: () => setEditing(true),
                },
                {
                  label: 'Admin notes',
                  icon: NotebookPen,
                  trailing:
                    noteCount > 0 ? (
                      <Badge size="sm">{formatBadgeCount(noteCount)}</Badge>
                    ) : undefined,
                  onSelect: () => setViewingNotes(true),
                },
                {
                  label: 'Merge matches',
                  icon: GitMerge,
                  group: 'data',
                  onSelect: () => setMerging(true),
                },
                {
                  label: 'Delete match',
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => setDeleting(true),
                },
              ]}
            />
          ) : null
        }
        actions={
          <>
            <ReportButton
              variant="outline"
              entityType={ReportEntityType.Match}
              entityId={match.id}
              entityDisplayName={name}
            />
            {!isAdmin && noteCount > 0 ? (
              <IconButton
                variant="outline"
                icon={NotebookPen}
                label="Admin notes"
                onClick={() => setViewingNotes(true)}
              />
            ) : null}
            <IconButton
              asChild
              variant="outline"
              icon={History}
              label="View audit history"
            >
              <Link
                href={`/audit/${entityTypeToSlug(AuditEntityType.Match)}/${match.id}`}
                prefetch={false}
              />
            </IconButton>
            <IconButton
              asChild
              variant="outline"
              icon={ExternalLink}
              label="View on osu!"
            >
              <a href={osuUrl} target="_blank" rel="noopener noreferrer" />
            </IconButton>
          </>
        }
        tabs={
          <HeroTabs
            aria-label="Match views"
            value={tab}
            data-testid="match-tabs"
            items={[
              {
                value: 'games',
                label: 'Games',
                count: formatCount(games.length),
                href: tabHref('games'),
                testId: 'tab-trigger-games',
              },
              {
                value: 'stats',
                label: 'Stats',
                href: tabHref('stats'),
                testId: 'tab-trigger-stats',
              },
            ]}
          />
        }
      />

      <AdminNotesDialog
        open={viewingNotes}
        onOpenChange={setViewingNotes}
        notes={match.adminNotes}
        entity={AdminNoteRouteTarget.Match}
        entityId={match.id}
        entityDisplayName={name}
      />

      {isAdmin ? (
        <>
          <MatchEditDialog
            match={match}
            open={editing}
            onOpenChange={setEditing}
          />
          <MergeMatchDialog
            match={{ id: match.id, name }}
            open={merging}
            onOpenChange={setMerging}
          />
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title="Delete this match?"
            description={DELETE_CASCADE_DESCRIPTION}
            confirmLabel="Delete match"
            pendingLabel="Deleting…"
            errorText="Failed to delete match"
            onConfirm={async () => {
              await orpc.matches.admin.delete({ id: match.id });
              toast.success('Match deleted successfully');
              router.replace(
                match.tournament?.id
                  ? `/tournaments/${match.tournament.id}`
                  : '/tournaments'
              );
              router.refresh();
            }}
          />
        </>
      ) : null}
    </>
  );
}
