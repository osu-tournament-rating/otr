/**
 * Names for the osu! fields an admin can correct on a match, game or score,
 * as the edit dialogs label them, for the reset dialog and audit diffs.
 */

import {
  editedFieldGroups,
  type AdminEditField,
  type AdminEditTable,
} from '@otr/core/db/admin-edits';

export const EDITED_FIELD_LABELS: {
  [T in AdminEditTable]: Record<AdminEditField<T>, string>;
} = {
  matches: { name: 'Name', start_time: 'Start time', end_time: 'End time' },
  games: {
    ruleset: 'Ruleset',
    scoring_type: 'Scoring type',
    team_type: 'Team type',
    mods: 'Mods',
    start_time: 'Start time',
    end_time: 'End time',
  },
  game_scores: {
    accuracy: 'Accuracy',
    max_combo: 'Max combo',
    stat_perfect: 'Perfect',
    stat_great: 'Great',
    stat_good: 'Good',
    stat_ok: 'Ok',
    stat_meh: 'Meh',
    stat_miss: 'Miss',
    grade: 'Grade',
    mods: 'Mods',
    team: 'Team',
    ruleset: 'Ruleset',
  },
};

/** The label of one editable field, by its group name. */
export function getEditedFieldLabel(
  table: AdminEditTable,
  field: string
): string {
  const labels: Record<string, string> = EDITED_FIELD_LABELS[table];
  return labels[field] ?? field;
}

/**
 * `Mods, Team` for a row's `edited_fields` column names, a group (mods with
 * lazer mods) named once; `None` when nothing is edited.
 */
export function formatEditedFields(
  table: AdminEditTable,
  columns: readonly string[]
): string {
  const groups = editedFieldGroups(table, columns);
  return groups.length > 0
    ? groups.map((group) => getEditedFieldLabel(table, group)).join(', ')
    : 'None';
}
