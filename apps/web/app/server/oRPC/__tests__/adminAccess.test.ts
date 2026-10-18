import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { isProcedure, ORPCError, type AnyProcedure } from '@orpc/server';

import {
  resetQueuePublishersForTesting,
  setQueuePublishersForTesting,
} from '@/lib/queue/publishers';

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

// Keeps an admin's call from reaching the broker in .env
const refusePublish = async (): Promise<never> => {
  throw new Error('queue publish in a test');
};

describe('admin procedures', () => {
  beforeAll(() => {
    setQueuePublishersForTesting({
      fetchBeatmap: refusePublish,
      fetchMatch: refusePublish,
      fetchPlayer: refusePublish,
      processAutomationCheck: refusePublish,
    });
  });

  afterAll(() => {
    resetQueuePublishersForTesting();
  });

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
