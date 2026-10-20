import { sql, type SQL } from 'drizzle-orm';

import { adminEditColumns, type AdminEditTable } from './admin-edits';

/**
 * The `edited_fields` value without the named groups, for an UPDATE's SET:
 * the next fetch restores those fields from osu!.
 */
export function withoutEditedFields(
  table: AdminEditTable,
  fields: readonly string[]
): SQL {
  const columns = adminEditColumns(table, fields);
  if (columns.length === 0) {
    return sql`edited_fields`;
  }

  return sql`array(
    select field from unnest(edited_fields) as field
    where field not in (${sql.join(
      columns.map((column) => sql`${column}`),
      sql`, `
    )})
    order by field
  )`;
}

type SqlClient = {
  execute(query: SQL): Promise<unknown>;
};

/**
 * Runs `operation` with admin writes that do not count as corrections of
 * single rows, such as a tournament's new ruleset written to every game and
 * score. They change the fields but lock none of them. Call it inside the
 * transaction that writes them.
 */
export async function withoutEditLocks<T>(
  client: SqlClient,
  operation: () => Promise<T>
): Promise<T> {
  await client.execute(sql`select set_config('otr.edit_locks', 'off', true)`);

  try {
    return await operation();
  } finally {
    await client.execute(sql`select set_config('otr.edit_locks', '', true)`);
  }
}
