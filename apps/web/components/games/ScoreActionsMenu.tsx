'use client';

import {
  AdminNoteRouteTarget,
  AuditEntityType,
  ReportEntityType,
} from '@otr/core/osu';
import {
  Flag,
  History,
  NotebookPen,
  PencilLine,
  RotateCcw,
  Trash2,
  UserRoundMinus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  ResetEditedFieldsDialog,
  hasEditedFields,
} from '@/components/admin-forms/ResetEditedFieldsDialog';
import { AdminNotesDialog } from '@/components/admin-notes/AdminNotesDialog';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { RowActionsMenu } from '@/components/kit/controls/RowActionsMenu';
import { Badge } from '@/components/kit/status/Badge';
import { ReportDialog } from '@/components/reports/ReportDialog';
import ScoreEditDialog from '@/components/scores/ScoreEditDialog';
import { entityTypeToSlug } from '@/lib/audit-entity-types';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { formatCountOf } from '@/lib/kit/format/number';
import { formatBadgeCount } from '@/lib/kit/status/count';
import { orpc } from '@/lib/orpc/orpc';
import type { GameScore } from '@/lib/orpc/schema/match';

/**
 * The one actions button on a score card: report and audit history for
 * everyone, admin notes when there are any (with a dot on the button, as the
 * old notes button had), and the admin's edit and delete actions, each
 * opening its own dialog.
 */
export default function ScoreActionsMenu({
  score,
  playerName,
  gameNumber,
  matchId,
}: {
  score: GameScore;
  playerName: string;
  /** The game's place in the match, so each score's menu has its own name. */
  gameNumber: number;
  matchId: number;
}) {
  const session = useSession();
  const isAdmin = hasAdminScope(session?.scopes ?? []);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [viewingNotes, setViewingNotes] = useState(false);

  const noteCount = score.adminNotes.length;
  const scoreName = `${playerName}'s score`;

  return (
    <>
      <RowActionsMenu
        itemName={`${scoreName} in game ${gameNumber}`}
        notification={noteCount > 0 ? 'Has admin notes' : undefined}
        data-testid="score-actions"
        // Public items first, in the heroes' order (report, audit history),
        // then the admin ones.
        actions={[
          session && {
            label: 'Report an issue',
            icon: Flag,
            onSelect: () => setReporting(true),
          },
          {
            label: 'View audit history',
            icon: History,
            href: `/audit/${entityTypeToSlug(AuditEntityType.Score)}/${score.id}`,
          },
          isAdmin && {
            label: 'Edit score',
            icon: PencilLine,
            group: 'admin',
            onSelect: () => setEditing(true),
          },
          (isAdmin || noteCount > 0) && {
            label: 'Admin notes',
            icon: NotebookPen,
            group: 'admin',
            trailing:
              noteCount > 0 ? (
                <Badge size="sm">{formatBadgeCount(noteCount)}</Badge>
              ) : undefined,
            onSelect: () => setViewingNotes(true),
          },
          isAdmin &&
            hasEditedFields('game_scores', score.editedFields) && {
              label: 'Reset to osu! values',
              icon: RotateCcw,
              group: 'data',
              onSelect: () => setResetting(true),
            },
          isAdmin && {
            label: 'Delete score',
            icon: Trash2,
            destructive: true,
            onSelect: () => setDeleting(true),
          },
          isAdmin && {
            label: 'Delete all player scores',
            icon: UserRoundMinus,
            destructive: true,
            onSelect: () => setDeletingAll(true),
          },
        ]}
      />

      {session ? (
        <ReportDialog
          open={reporting}
          onOpenChange={setReporting}
          entityType={ReportEntityType.Score}
          entityId={score.id}
          entityDisplayName={scoreName}
        />
      ) : null}
      {isAdmin || noteCount > 0 ? (
        <AdminNotesDialog
          open={viewingNotes}
          onOpenChange={setViewingNotes}
          notes={score.adminNotes}
          entity={AdminNoteRouteTarget.GameScore}
          entityId={score.id}
          entityDisplayName={scoreName}
        />
      ) : null}

      {isAdmin ? (
        <>
          <ScoreEditDialog
            score={score}
            open={editing}
            onOpenChange={setEditing}
          />
          <ResetEditedFieldsDialog
            table="game_scores"
            id={score.id}
            editedFields={score.editedFields}
            open={resetting}
            onOpenChange={setResetting}
          />
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title="Delete this score?"
            description={
              <>
                <p>All associated data will be permanently removed.</p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Delete score"
            pendingLabel="Deleting…"
            errorText="Failed to delete score"
            onConfirm={async () => {
              await orpc.scores.admin.delete({ id: score.id });
              toast.success('Score deleted successfully');
              router.refresh();
            }}
          />
          <ConfirmDialog
            open={deletingAll}
            onOpenChange={setDeletingAll}
            title="Delete all player scores?"
            description={
              <>
                <p>
                  This will remove all of {playerName}&apos;s scores across all
                  games in this match.
                </p>
                <p>This action cannot be undone.</p>
              </>
            }
            confirmLabel="Delete all scores"
            pendingLabel="Deleting…"
            errorText="Failed to delete player scores"
            onConfirm={async () => {
              const response = await orpc.matches.admin.deletePlayerScores({
                matchId,
                playerId: score.playerId,
              });
              toast.success(
                `Deleted ${formatCountOf(response.deletedCount, 'score')} for ${playerName}`
              );
              router.refresh();
            }}
          />
        </>
      ) : null}
    </>
  );
}
