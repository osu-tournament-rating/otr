import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { call } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';
import {
  getSession,
  useFakeOsuUser,
  type CookieJar,
} from '@/lib/auth/osu-sign-in.test-utils';

import {
  generateUserApiKey,
  getUserApiKeys,
} from '../procedures/apiKeyProcedures';

// Keys are made through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

// Anyone who reads the database, such as Grafana's role or a dev-tier copy,
// must not be able to read a working key out of it
describe.skipIf(!enabled)('a new API key', () => {
  const osuUser = useFakeOsuUser();

  let cookies: CookieJar;
  let userId: string;

  const sessionContext = () => ({
    context: {
      headers: new Headers({
        cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      }),
    },
  });

  beforeAll(async () => {
    ({ cookies } = await osuUser.signIn());
    userId = (await getSession(cookies))!.user.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.apiKeys)
      .where(eq(schema.apiKeys.referenceId, userId));
  });

  test('is shown whole only to its creator, once, and stored nowhere', async () => {
    const created = await call(
      generateUserApiKey,
      { name: 'stored nowhere' },
      sessionContext()
    );
    expect(created.key).toStartWith('otr-');

    const rows = await db.execute<{ row: string }>(
      sql`SELECT row_to_json(api_keys)::text AS row FROM api_keys WHERE id = ${created.id}`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.row).not.toContain(created.key);

    const listed = await call(getUserApiKeys, undefined, sessionContext());
    expect(listed).toEqual([expect.objectContaining({ id: created.id })]);
    expect(JSON.stringify(listed)).not.toContain(created.key);
  });
});
