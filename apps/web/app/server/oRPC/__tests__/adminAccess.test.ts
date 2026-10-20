import { describe, expect, it, spyOn } from 'bun:test';
import { call, isProcedure, ORPCError, type AnyProcedure } from '@orpc/server';

import { auth } from '@/lib/auth/auth';

import {
  adminMutationProcedure,
  adminProcedure,
  withAdminGuard,
} from '../procedures/base';
import { router } from '../router';

const collectProcedures = (
  node: unknown,
  path: string[] = []
): Array<{ path: string; procedure: AnyProcedure }> => {
  if (isProcedure(node)) {
    return [{ path: path.join('.'), procedure: node }];
  }

  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, child]) => collectProcedures(child, [...path, key])
  );
};

const adminProcedures = collectProcedures(router).filter(({ procedure }) =>
  procedure['~orpc'].route.tags?.includes('admin')
);

// Fails the call if the handler queries before checking the caller
const untouchableDb = new Proxy(
  {},
  {
    get(_, property) {
      throw new Error(`db.${String(property)} read before the admin check`);
    },
  }
);

const signedInSession = (scopes: string[]) => ({
  user: { id: 'user-1', playerId: 7 },
  session: { id: 'session-1', userId: 'user-1' },
  dbPlayer: { id: 7 },
  dbUser: { id: 7, playerId: 7, scopes },
});

/** Runs the handler alone, as withAuth leaves it for a signed-in user. */
const runHandler = async (procedure: AnyProcedure, session: unknown) => {
  const result = await procedure['~orpc'].handler({
    context: {
      headers: new Headers(),
      session,
      db: untouchableDb,
    },
    input: {},
    path: [],
    procedure,
    signal: undefined,
    lastEventId: undefined,
    errors: {},
  } as never);

  // A streaming handler runs only when its first event is read
  if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
    await (result as AsyncIterator<unknown>).next();
  }

  return result;
};

const refusal = async (procedure: AnyProcedure, session: unknown) =>
  runHandler(procedure, session).then(
    () => null,
    (error: unknown) => error
  );

describe('admin procedures', () => {
  it('finds the admin procedures in the router', () => {
    const paths = adminProcedures.map(({ path }) => path);

    expect(paths).toContain('admin.massEnqueue');
    expect(paths).toContain('reports.list');
    expect(paths).toContain('users.admin.ban');
    expect(paths).toContain('players.lookup');
  });

  it('refuses a signed-in user without an admin scope', async () => {
    const allowed: string[] = [];

    for (const { path, procedure } of adminProcedures) {
      const error = await refusal(procedure, signedInSession(['user']));

      if (!(error instanceof ORPCError) || error.code !== 'FORBIDDEN') {
        allowed.push(`${path}: ${String(error)}`);
      }
    }

    expect(allowed).toEqual([]);
  });

  it('refuses a session without a user record', async () => {
    const allowed: string[] = [];

    for (const { path, procedure } of adminProcedures) {
      const error = await refusal(procedure, {
        ...signedInSession([]),
        dbUser: null,
      });

      if (!(error instanceof ORPCError) || error.code !== 'FORBIDDEN') {
        allowed.push(`${path}: ${String(error)}`);
      }
    }

    expect(allowed).toEqual([]);
  });

  // The calls above fail on the scope, not on the empty input or missing db
  it('lets an admin past the check', async () => {
    const refused: string[] = [];

    for (const { path, procedure } of adminProcedures) {
      const error = await refusal(procedure, signedInSession(['admin']));

      if (
        error instanceof ORPCError &&
        ['FORBIDDEN', 'UNAUTHORIZED'].includes(error.code)
      ) {
        refused.push(path);
      }
    }

    expect(refused).toEqual([]);
  });
});

describe('the shared admin procedures', () => {
  it('check the caller in every admin procedure', () => {
    const unchecked = adminProcedures
      .filter(
        ({ procedure }) =>
          !procedure['~orpc'].middlewares.includes(withAdminGuard)
      )
      .map(({ path }) => path);

    expect(unchecked).toEqual([]);
  });

  /** Calls `procedure` as the signed-in user `withAuth` finds in `session`. */
  const callAs = async (procedure: AnyProcedure, session: unknown) => {
    const getSession = spyOn(auth.api, 'getSession').mockResolvedValue(
      session as never
    );

    try {
      return await call(procedure, undefined, {
        context: { headers: new Headers() },
      }).catch((error: unknown) => error);
    } finally {
      getSession.mockRestore();
    }
  };

  it('refuse a signed-in user without an admin scope before the handler runs', async () => {
    for (const shared of [adminProcedure, adminMutationProcedure]) {
      let ran = false;
      const procedure = shared.handler(() => {
        ran = true;
      });

      const error = await callAs(procedure, signedInSession(['user']));

      expect(error).toBeInstanceOf(ORPCError);
      expect(error).toMatchObject({ code: 'FORBIDDEN' });
      expect(ran).toBe(false);
    }
  });

  it('let an admin through', async () => {
    const procedure = adminProcedure.handler(() => 'ran');

    expect(await callAs(procedure, signedInSession(['admin']))).toBe('ran');
  });
});
