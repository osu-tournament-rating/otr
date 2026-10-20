/** The tables whose osu! fields an admin can correct. */
export type AdminEditTable = 'matches' | 'games' | 'game_scores';

/**
 * The fields of each table that come from osu! and that an admin can correct,
 * by column name. When an admin's write changes one, the database adds it to
 * the row's `edited_fields`, and from then on a write without an admin (a data
 * worker fetch, an automated check, the processor) keeps the admin's value.
 *
 * Each inner list is one group, locked and reset together. Mods and lazer mods
 * are one group: an admin's mod edit clears the lazer mods, and a fetch writes
 * both.
 *
 * Statuses, rejection reasons, warning flags and placement are left out on
 * purpose: admin cascades, the automated checks and the weekly processor run
 * must keep writing them.
 *
 * Migration 0043 passes these groups to the `keep_admin_edits` trigger on each
 * table, one argument per group with its columns separated by spaces. To
 * protect another field, add its group here and recreate that table's trigger
 * with the new arguments in a migration; a test compares the two. A migration
 * that rewrites a protected column must disable that table's
 * `keep_admin_edits` trigger around the write. Otherwise the trigger keeps the
 * old value of every column in `edited_fields`, and ignores the migration's
 * own changes to `edited_fields`.
 */
export const ADMIN_EDIT_FIELD_GROUPS = {
  matches: [['name'], ['start_time'], ['end_time']],
  games: [
    ['ruleset'],
    ['scoring_type'],
    ['team_type'],
    ['mods', 'lazer_mods'],
    ['start_time'],
    ['end_time'],
  ],
  game_scores: [
    ['accuracy'],
    ['max_combo'],
    ['stat_perfect'],
    ['stat_great'],
    ['stat_good'],
    ['stat_ok'],
    ['stat_meh'],
    ['stat_miss'],
    ['grade'],
    ['mods', 'lazer_mods'],
    ['team'],
    ['ruleset'],
  ],
} as const satisfies Record<AdminEditTable, readonly (readonly string[])[]>;

/** A group's name: its first column, such as `mods` for mods and lazer mods. */
export type AdminEditField<T extends AdminEditTable> =
  (typeof ADMIN_EDIT_FIELD_GROUPS)[T][number][0];

/**
 * The groups of `table` that `editedFields` holds, by name, in definition
 * order. A group counts as edited when any of its columns is.
 */
export function editedFieldGroups<T extends AdminEditTable>(
  table: T,
  editedFields: readonly string[]
): AdminEditField<T>[] {
  const edited = new Set(editedFields);
  const groups: readonly (readonly string[])[] = ADMIN_EDIT_FIELD_GROUPS[table];

  return groups
    .filter((group) => group.some((column) => edited.has(column)))
    .map((group) => group[0] as AdminEditField<T>);
}

/**
 * Every column of the named groups of `table`. Throws on a name that is not a
 * group of that table, so a caller can't unlock a column it doesn't own.
 */
export function adminEditColumns(
  table: AdminEditTable,
  fields: readonly string[]
): string[] {
  const groups: readonly (readonly string[])[] = ADMIN_EDIT_FIELD_GROUPS[table];
  const columns: string[] = [];

  for (const field of fields) {
    const group = groups.find((candidate) => candidate[0] === field);
    if (!group) {
      throw new Error(`${field} is not an editable field of ${table}`);
    }
    columns.push(...group);
  }

  return columns;
}
