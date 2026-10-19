import type { Pool } from 'pg';

/** Created by migration 0041, which grants it read access. */
export const GRAFANA_ROLE = 'otr_grafana_read_only';

/**
 * Lets Grafana's role log in with `password`, and keeps its queries from
 * writing, running long, or crowding out the site. Roles live outside the
 * database, so a restored archive brings the role and its grants back but not
 * its password; every deploy and recovery runs this after the migrations.
 *
 * The password is GRAFANA_SECRET_KEY, a secret Grafana already holds, so the
 * role needs no configuration of its own.
 *
 * Returns false, changing nothing, where the role doesn't exist, as in a
 * cluster restored from a dev or public archive: those leave the role out, and
 * the migration that creates it is already recorded as applied.
 */
export async function ensureGrafanaRoleLogin(
  pool: Pool,
  password: string
): Promise<boolean> {
  const client = await pool.connect();

  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [GRAFANA_ROLE]
    );
    if (!rowCount) {
      return false;
    }

    await client.query('BEGIN');
    await client.query(
      `ALTER ROLE ${GRAFANA_ROLE} LOGIN CONNECTION LIMIT 5 PASSWORD ${client.escapeLiteral(password)}`
    );
    await client.query(
      `ALTER ROLE ${GRAFANA_ROLE} SET default_transaction_read_only = on`
    );
    await client.query(
      `ALTER ROLE ${GRAFANA_ROLE} SET statement_timeout = '30s'`
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
