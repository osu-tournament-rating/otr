import { afterAll, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';

import { ensureGrafanaRoleLogin, GRAFANA_ROLE } from '../grafana-role';

// Set by the `checks` job in .github/workflows/ci.yml, which migrates it.
const url = process.env.SEARCH_TEST_DATABASE_URL;

// The columns the dev archive redacts (dev_secret_columns in apps/scripts),
// and any column named like a credential, on tables that exist now or later.
const SECRET_COLUMNS = new Set([
  'api_keys.key',
  'auth_accounts.access_token',
  'auth_accounts.refresh_token',
  'auth_accounts.id_token',
  'auth_accounts.password',
  'auth_sessions.token',
  'auth_verifications.value',
  'o_auth_clients.secret',
]);
const CREDENTIAL_NAME =
  /^(key|token|secret|password)$|_(token|secret|password)$/;

describe.skipIf(!url)(GRAFANA_ROLE, () => {
  const pool = new Pool({ connectionString: url });

  afterAll(() => pool.end());

  const readableColumns = async () => {
    const { rows } = await pool.query<{ column: string }>(
      `SELECT table_name || '.' || column_name AS column
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND has_column_privilege($1, format('public.%I', table_name), column_name, 'SELECT')`,
      [GRAFANA_ROLE]
    );
    return rows.map((row) => row.column);
  };

  it('reads the data but no credential column', async () => {
    const readable = await readableColumns();

    expect(readable).toContain('players.username');
    expect(readable).toContain('api_keys.reference_id');
    expect(readable.filter((column) => SECRET_COLUMNS.has(column))).toEqual([]);
    expect(
      readable.filter((column) => CREDENTIAL_NAME.test(column.split('.')[1]!))
    ).toEqual([]);
  });

  it('reads a table created after its migration', async () => {
    await pool.query('CREATE TABLE grafana_role_probe (id integer)');

    try {
      const { rows } = await pool.query<{ readable: boolean }>(
        `SELECT has_table_privilege($1, 'public.grafana_role_probe', 'SELECT') AS readable`,
        [GRAFANA_ROLE]
      );
      expect(rows[0]!.readable).toBe(true);
    } finally {
      await pool.query('DROP TABLE grafana_role_probe');
    }
  });

  it('logs in with the password it is given, and cannot write', async () => {
    const password = `test-${crypto.randomUUID()}`;
    expect(await ensureGrafanaRoleLogin(pool, password)).toBe(true);
    // A second deploy finds the role already set up.
    await ensureGrafanaRoleLogin(pool, password);

    const login = new URL(url!);
    login.username = GRAFANA_ROLE;
    login.password = password;
    const grafana = new Pool({ connectionString: login.toString() });

    try {
      const read = await grafana.query('SELECT count(*) FROM players');
      expect(read.rowCount).toBe(1);
      const timeout = await grafana.query<{ statement_timeout: string }>(
        'SHOW statement_timeout'
      );
      expect(timeout.rows[0]!.statement_timeout).toBe('30s');
      const readOnly = await grafana.query<{
        default_transaction_read_only: string;
      }>('SHOW default_transaction_read_only');
      expect(readOnly.rows[0]!.default_transaction_read_only).toBe('on');

      const write = await grafana
        .query('DELETE FROM players WHERE false')
        .catch((error: unknown) => error);
      expect(write).toBeInstanceOf(Error);
      expect((write as Error).message).toMatch(
        /read-only transaction|permission denied/
      );
    } finally {
      await grafana.end();
    }
  });

  it('skips a cluster where the role does not exist', async () => {
    const renamed = `${GRAFANA_ROLE}_away`;
    await pool.query(`ALTER ROLE ${GRAFANA_ROLE} RENAME TO ${renamed}`);

    try {
      expect(await ensureGrafanaRoleLogin(pool, 'unused')).toBe(false);
    } finally {
      await pool.query(`ALTER ROLE ${renamed} RENAME TO ${GRAFANA_ROLE}`);
    }
  });
});
