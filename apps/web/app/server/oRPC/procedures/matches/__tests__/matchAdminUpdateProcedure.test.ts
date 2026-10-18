import { describe, expect, it } from 'bun:test';

import {
  updateMatchAdminHandler,
  type UpdateMatchAdminArgs,
} from '../matchAdminHandlers';
import * as schema from '@otr/core/db/schema';
import { MatchWarningFlags, VerificationStatus } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';

type RequireKeys<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

type TestMatchRow = RequireKeys<
  typeof schema.matches.$inferSelect,
  'id' | 'verificationStatus' | 'verifiedByUserId'
>;

type TestGameRow = RequireKeys<
  typeof schema.games.$inferSelect,
  'id' | 'matchId'
>;

type TestGameScoreRow = RequireKeys<
  typeof schema.gameScores.$inferSelect,
  'id' | 'gameId'
>;

class UpdateMatchTestDb {
  public readonly games: TestGameRow[];
  public readonly gameScores: TestGameScoreRow[];
  public readonly matchUpdates: Array<Record<string, unknown>> = [];
  public readonly gameUpdates: Array<Record<string, unknown>> = [];
  public readonly gameScoreUpdates: Array<Record<string, unknown>> = [];
  public auditCallCount = 0;

  constructor(
    private readonly existingMatch: TestMatchRow,
    options: {
      games?: TestGameRow[];
      gameScores?: TestGameScoreRow[];
    } = {}
  ) {
    this.games = options.games ?? [];
    this.gameScores = options.gameScores ?? [];
  }

  query = {
    matches: {
      findFirst: async () => this.existingMatch,
    },
  } as const;

  async transaction<T>(
    callback: (tx: UpdateMatchTestTransaction) => Promise<T>
  ): Promise<T> {
    const tx = new UpdateMatchTestTransaction(this);
    return callback(tx);
  }
}

class UpdateMatchTestTransaction {
  constructor(private readonly parent: UpdateMatchTestDb) {}

  async execute(): Promise<void> {
    this.parent.auditCallCount += 1;
  }

  private recordUpdate(table: unknown, values: Record<string, unknown>) {
    if (table === schema.matches) {
      this.parent.matchUpdates.push(values);
      return;
    }

    if (table === schema.games) {
      this.parent.gameUpdates.push(values);
      return;
    }

    if (table === schema.gameScores) {
      this.parent.gameScoreUpdates.push(values);
      return;
    }

    throw new Error('Unsupported update target');
  }

  private rowsFor(table: unknown) {
    if (table === schema.games) {
      return this.parent.games;
    }

    if (table === schema.gameScores) {
      return this.parent.gameScores;
    }

    return [];
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.games) {
            return this.parent.games;
          }

          if (table === schema.gameScores) {
            return this.parent.gameScores;
          }

          return [];
        },
      }),
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => {
          this.recordUpdate(table, values);

          const rows = this.rowsFor(table);

          return {
            returning: async () => rows.map((row) => ({ ...row })),
          };
        },
      }),
    };
  }
}

describe('updateMatchAdminHandler', () => {
  const baseInput: UpdateMatchAdminArgs['input'] = {
    id: 1,
    name: 'Test Match',
    verificationStatus: VerificationStatus.None,
    rejectionReason: 0,
    warningFlags: MatchWarningFlags.None,
    startTime: null,
    endTime: null,
  };

  const adminSession: NonNullable<UpdateMatchAdminArgs['context']['session']> =
    {
      dbUser: {
        id: 99,
        scopes: ['admin'],
      },
    };

  it('preserves verifiedByUserId when status unchanged', async () => {
    const db = new UpdateMatchTestDb({
      id: 1,
      verificationStatus: VerificationStatus.Verified,
      verifiedByUserId: 55,
    });

    await updateMatchAdminHandler({
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.Verified,
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.matchUpdates[0].verifiedByUserId).toBe(55);
  });

  it('sets verifiedByUserId to admin on Verified', async () => {
    const db = new UpdateMatchTestDb({
      id: 1,
      verificationStatus: VerificationStatus.None,
      verifiedByUserId: null,
    });

    await updateMatchAdminHandler({
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.Verified,
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.matchUpdates[0].verifiedByUserId).toBe(99);
  });

  it('leaves children alone when verified without a choice', async () => {
    const db = new UpdateMatchTestDb(
      {
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
      },
      { games: [{ id: 20, matchId: 1 }], gameScores: [{ id: 30, gameId: 20 }] }
    );

    await updateMatchAdminHandler({
      input: { ...baseInput, verificationStatus: VerificationStatus.Verified },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.gameUpdates).toHaveLength(0);
    expect(db.gameScoreUpdates).toHaveLength(0);
  });

  it('sets verifiedByUserId to admin on Rejected', async () => {
    const db = new UpdateMatchTestDb({
      id: 1,
      verificationStatus: VerificationStatus.None,
      verifiedByUserId: null,
    });

    await updateMatchAdminHandler({
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.Rejected,
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.matchUpdates[0].verifiedByUserId).toBe(99);
  });

  it('clears verifiedByUserId when reverting to None', async () => {
    const db = new UpdateMatchTestDb({
      id: 1,
      verificationStatus: VerificationStatus.Verified,
      verifiedByUserId: 55,
    });

    await updateMatchAdminHandler({
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.None,
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.matchUpdates[0].verifiedByUserId).toBeNull();
  });

  it('only includes expected keys in .set()', async () => {
    const db = new UpdateMatchTestDb({
      id: 1,
      verificationStatus: VerificationStatus.None,
      verifiedByUserId: null,
    });

    await updateMatchAdminHandler({
      input: baseInput,
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    const expectedKeys = new Set([
      'name',
      'verificationStatus',
      'rejectionReason',
      'warningFlags',
      'startTime',
      'endTime',
      'verifiedByUserId',
      'updated',
    ]);

    expect(new Set(Object.keys(db.matchUpdates[0]))).toEqual(expectedKeys);
  });
});
