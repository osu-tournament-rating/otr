'use client';

import {
  AdminNoteRouteTarget,
  AuditEntityType,
  ReportEntityType,
} from '@otr/core/osu';
import {
  Flag,
  GitMerge,
  History,
  Music2,
  NotebookPen,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { DELETE_CASCADE_DESCRIPTION } from '@/components/admin-forms/adminFormFields';
import { AdminNotesDialog } from '@/components/admin-notes/AdminNotesDialog';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { RowActionsMenu } from '@/components/kit/controls/RowActionsMenu';
import { Badge } from '@/components/kit/status/Badge';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { entityTypeToSlug } from '@/lib/audit-entity-types';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { formatBadgeCount } from '@/lib/kit/status/count';
import { orpc } from '@/lib/orpc/orpc';
import type { Game } from '@/lib/orpc/schema/match';

import GameEditDialog from './GameEditDialog';
import MergeGameDialog from './MergeGameDialog';

/**
 * The one actions button on a game card's cover: audit history, the beatmap
 * on osu! and report for everyone, admin notes when there are any (with a
 * dot on the button, as the old notes button had), and the admin's edit,
 * merge and delete actions.
 */
export default function GameActionsMenu({
  game,
  gameName,
  itemName,
}: {
  game: Game;
  /**
   * "Title [Difficulty]", or "Game 123" for a deleted beatmap; names the
   * report and the notes.
   */
  gameName: string;
  /**
   * Names the menu with the game's place in the match, such as "Game 3", so
   * two games on one beatmap have distinct buttons.
   */
  itemName: string;
}) {
  const session = useSession();
  const isAdmin = hasAdminScope(session?.scopes ?? []);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [viewingNotes, setViewingNotes] = useState(false);

  const noteCount = game.adminNotes.length;
  const beatmapOsuId = game.beatmap?.osuId;

  return (
    <>
      <RowActionsMenu
        onArt
        itemName={itemName}
        notification={noteCount > 0 ? 'Has admin notes' : undefined}
        data-testid="game-actions"
        // Public items first, in the heroes' order (report, audit history,
        // osu!), then the admin ones.
        actions={[
          session && {
            label: 'Report an issue',
            icon: Flag,
            onSelect: () => setReporting(true),
          },
          {
            label: 'View audit history',
            icon: History,
            href: `/audit/${entityTypeToSlug(AuditEntityType.Game)}/${game.id}`,
          },
          Boolean(beatmapOsuId) && {
            label: 'View beatmap on osu!',
            icon: Music2,
            href: `https://osu.ppy.sh/b/${beatmapOsuId}`,
            external: true,
          },
          isAdmin && {
            label: 'Edit game',
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
          isAdmin && {
            label: 'Merge games',
            icon: GitMerge,
            group: 'data',
            onSelect: () => setMerging(true),
          },
          isAdmin && {
            label: 'Delete game',
            icon: Trash2,
            destructive: true,
            onSelect: () => setDeleting(true),
          },
        ]}
      />

      {session ? (
        <ReportDialog
          open={reporting}
          onOpenChange={setReporting}
          entityType={ReportEntityType.Game}
          entityId={game.id}
          entityDisplayName={gameName}
        />
      ) : null}
      {isAdmin || noteCount > 0 ? (
        <AdminNotesDialog
          open={viewingNotes}
          onOpenChange={setViewingNotes}
          notes={game.adminNotes}
          entity={AdminNoteRouteTarget.Game}
          entityId={game.id}
          entityDisplayName={gameName}
        />
      ) : null}

      {isAdmin ? (
        <>
          <GameEditDialog
            game={game}
            open={editing}
            onOpenChange={setEditing}
          />
          <MergeGameDialog
            game={game}
            open={merging}
            onOpenChange={setMerging}
          />
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title="Delete this game?"
            description={DELETE_CASCADE_DESCRIPTION}
            confirmLabel="Delete game"
            pendingLabel="Deleting…"
            errorText="Failed to delete game"
            onConfirm={async () => {
              await orpc.games.admin.delete({ id: game.id });
              toast.success('Game deleted successfully');
              router.refresh();
            }}
          />
        </>
      ) : null}
    </>
  );
}
