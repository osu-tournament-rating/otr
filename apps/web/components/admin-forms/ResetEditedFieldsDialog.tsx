'use client';

import {
  editedFieldGroups,
  type AdminEditTable,
} from '@otr/core/db/admin-edits';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { getEditedFieldLabel } from '@/lib/kit/format/edited-fields';
import { orpc } from '@/lib/orpc/orpc';

const RESET_PROCEDURES = {
  matches: orpc.matches.admin.resetEdits,
  games: orpc.games.admin.resetEdits,
  game_scores: orpc.scores.admin.resetEdits,
} satisfies Record<AdminEditTable, unknown>;

/**
 * Whether a match, game or score has fields an admin edited, which the
 * reset action lists.
 */
export function hasEditedFields(
  table: AdminEditTable,
  editedFields: readonly string[] | undefined
) {
  return editedFieldGroups(table, editedFields ?? []).length > 0;
}

/**
 * Confirms resetting fields an admin edited to osu!'s values. Every edited
 * field starts ticked; the reset unlocks the ticked ones and queues a refetch
 * of the match, which writes osu!'s values back.
 */
export function ResetEditedFieldsDialog({
  table,
  id,
  editedFields,
  open,
  onOpenChange,
}: {
  table: AdminEditTable;
  id: number;
  editedFields: readonly string[] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const groupId = useId();
  const groups = editedFieldGroups(table, editedFields ?? []);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const selected = groups.filter((group) => !unticked.has(group));

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setUnticked(new Set());
        onOpenChange(next);
      }}
      title="Reset to osu! values?"
      description={
        <p>
          The match is refetched, and the fields you choose take osu!&apos;s
          values again.
        </p>
      }
      confirmLabel="Reset to osu! values"
      pendingLabel="Resetting…"
      errorText="Failed to reset fields"
      confirmDisabled={selected.length === 0}
      onConfirm={async () => {
        await RESET_PROCEDURES[table]({ id, fields: selected });
        toast.success('Queued match data for refetch');
        router.refresh();
      }}
    >
      <div className="flex flex-col gap-3">
        <FormFieldLabel groupId={groupId}>Edited fields</FormFieldLabel>
        <div
          role="group"
          aria-labelledby={groupId}
          className="flex flex-col gap-2"
        >
          {groups.map((group) => (
            <div key={group} className="flex items-center gap-2">
              <Checkbox
                id={`${groupId}-${group}`}
                checked={!unticked.has(group)}
                onCheckedChange={(checked) =>
                  setUnticked((current) => {
                    const next = new Set(current);
                    if (checked === true) {
                      next.delete(group);
                    } else {
                      next.add(group);
                    }
                    return next;
                  })
                }
              />
              <Label htmlFor={`${groupId}-${group}`}>
                {getEditedFieldLabel(table, group)}
              </Label>
            </div>
          ))}
        </div>
      </div>
    </ConfirmDialog>
  );
}
