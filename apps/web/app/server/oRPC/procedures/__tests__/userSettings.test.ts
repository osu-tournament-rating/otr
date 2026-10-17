import { describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';

import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

import type { DatabaseClient } from '@/lib/db';
import { UpdateUserSettingsInputSchema } from '@/lib/orpc/schema/user';

import { withCurrentBuildGuard, withMaintenanceWindowGuard } from '../base';
import { router } from '../../router';
import {
  getUserSettingsHandler,
  updateUserSettingsHandler,
} from '../userProcedures';

type Upsert = {
  values: Record<string, unknown>;
  target: unknown;
  set: Record<string, unknown>;
};

/** Records the upsert the handler sends. */
class UpsertTestDb {
  upsert: Upsert | null = null;

  insert(table: unknown) {
    if (table !== schema.userSettings) {
      throw new Error('Unexpected insert target');
    }
    return {
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (config: {
          target: unknown;
          set: Record<string, unknown>;
        }) => {
          this.upsert = { values, ...config };
        },
      }),
    };
  }
}

/** Answers the settings read with `rows`. */
const selectTestDb = (rows: unknown[]) => {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  return { select: () => chain } as unknown as DatabaseClient;
};

const session = { dbUser: { id: 7, playerId: 70 } };

const update = (
  input: Parameters<typeof updateUserSettingsHandler>[0]['input']
) => {
  const db = new UpsertTestDb();
  return {
    db,
    run: () =>
      updateUserSettingsHandler({
        input,
        context: { db: db as unknown as DatabaseClient, session },
      }),
  };
};

describe('updateUserSettingsHandler', () => {
  it('upserts only the setting it was sent, keyed on the session user', async () => {
    const { db, run } = update({ browsingRuleset: Ruleset.Taiko });

    expect(await run()).toEqual({ success: true });
    expect(db.upsert?.values).toEqual({
      userId: 7,
      browsingRuleset: Ruleset.Taiko,
    });
    expect(db.upsert?.target).toBe(schema.userSettings.userId);
    expect(Object.keys(db.upsert?.set ?? {}).sort()).toEqual([
      'browsingRuleset',
      'updated',
    ]);
  });

  it('clears a setting with null and leaves the other alone', async () => {
    const { db, run } = update({ profileRuleset: null });
    await run();

    expect(db.upsert?.values).toEqual({ userId: 7, profileRuleset: null });
    expect(db.upsert?.set.profileRuleset).toBeNull();
    expect('browsingRuleset' in (db.upsert?.set ?? {})).toBe(false);
    expect(db.upsert?.set.updated).toBeDefined();
  });

  it('saves both settings at once', async () => {
    const { db, run } = update({
      profileRuleset: Ruleset.Mania4k,
      browsingRuleset: null,
    });
    await run();

    expect(db.upsert?.values).toEqual({
      userId: 7,
      profileRuleset: Ruleset.Mania4k,
      browsingRuleset: null,
    });
  });

  it('refuses a session without a user row', async () => {
    const db = new UpsertTestDb();
    const call = updateUserSettingsHandler({
      input: { profileRuleset: Ruleset.Osu },
      context: {
        db: db as unknown as DatabaseClient,
        session: { dbUser: null },
      },
    });

    await expect(call).rejects.toBeInstanceOf(ORPCError);
    await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.upsert).toBeNull();
  });
});

describe('getUserSettingsHandler', () => {
  it('returns both settings and the ruleset played most', async () => {
    const settings = {
      profileRuleset: Ruleset.Catch,
      browsingRuleset: null,
      mostPlayedRuleset: Ruleset.Osu,
    };

    expect(
      await getUserSettingsHandler({
        context: { db: selectTestDb([settings]), session },
      })
    ).toEqual(settings);
  });

  it('refuses a session without a user row', async () => {
    await expect(
      getUserSettingsHandler({
        context: { db: selectTestDb([]), session: null },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('UpdateUserSettingsInputSchema', () => {
  it('accepts a rated ruleset or null for either setting', () => {
    expect(
      UpdateUserSettingsInputSchema.safeParse({ profileRuleset: Ruleset.Taiko })
        .success
    ).toBe(true);
    expect(
      UpdateUserSettingsInputSchema.safeParse({ browsingRuleset: null }).success
    ).toBe(true);
  });

  it('refuses mania (other), unknown rulesets and an empty change', () => {
    expect(
      UpdateUserSettingsInputSchema.safeParse({
        profileRuleset: Ruleset.ManiaOther,
      }).success
    ).toBe(false);
    expect(
      UpdateUserSettingsInputSchema.safeParse({ browsingRuleset: 9 }).success
    ).toBe(false);
    expect(UpdateUserSettingsInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('settings procedures', () => {
  const { getSettings, updateSettings } = router.users;

  it('keeps both off the public API', () => {
    expect(getSettings['~orpc'].route.tags).toEqual(['authenticated']);
    expect(updateSettings['~orpc'].route.tags).toEqual(['authenticated']);
  });

  // A user preference has nothing to do with the rating run, so only the
  // stale-build guard applies.
  it('refuses a stale page’s write outside the maintenance window', () => {
    const middlewares = updateSettings['~orpc'].middlewares;
    expect(middlewares).toContain(withCurrentBuildGuard);
    expect(middlewares).not.toContain(withMaintenanceWindowGuard);
  });
});
