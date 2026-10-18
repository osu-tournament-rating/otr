import { and, eq, inArray, not, sql } from 'drizzle-orm';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { syncTournamentDateRange } from '@otr/core/db';

type Executor =
  DatabaseClient | Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

// Advisory lock class for "tournament data is complete" checks.
const COMPLETION_LOCK_CLASS = 1201;

interface TournamentDataCompletionServiceOptions {
  db: DatabaseClient;
  logger: Logger;
  publishAutomationCheck?: (options: {
    tournamentId: number;
    overrideVerifiedState: boolean;
  }) => Promise<void>;
}

export class TournamentDataCompletionService {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly publishAutomationCheck?: (options: {
    tournamentId: number;
    overrideVerifiedState: boolean;
  }) => Promise<void>;

  private readonly pendingAutomation = new Set<number>();

  constructor(options: TournamentDataCompletionServiceOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.publishAutomationCheck = options.publishAutomationCheck;
  }

  /**
   * Sets a match's fetch status, then queues automated checks once its
   * tournament's data is complete. Pass the transaction the status belongs
   * to; without one, the update runs in a transaction of its own.
   */
  async updateMatchFetchStatus(
    matchId: number,
    status: number,
    db?: Executor
  ): Promise<void> {
    if (!db) {
      return this.db.transaction((tx) =>
        this.updateMatchFetchStatus(matchId, status, tx)
      );
    }

    const match = await db.query.matches.findFirst({
      where: eq(schema.matches.id, matchId),
      columns: {
        id: true,
        tournamentId: true,
      },
    });

    if (!match) {
      this.logger.warn('Attempted to update fetch status for unknown match', {
        matchId,
      });
      return;
    }

    if (match.tournamentId) {
      await lockTournaments(db, [match.tournamentId]);
    }

    await db
      .update(schema.matches)
      .set({ dataFetchStatus: status })
      .where(eq(schema.matches.id, matchId));

    if (match.tournamentId) {
      await this.checkAndTriggerAutomationChecksIfComplete(
        match.tournamentId,
        db
      );
    }
  }

  /** Like updateMatchFetchStatus, for every tournament that uses the beatmap. */
  async updateBeatmapFetchStatus(
    beatmapId: number,
    status: number,
    options?: { skipAutomationChecks?: boolean },
    db?: Executor
  ): Promise<void> {
    if (!db) {
      return this.db.transaction((tx) =>
        this.updateBeatmapFetchStatus(beatmapId, status, options, tx)
      );
    }

    const beatmap = await db.query.beatmaps.findFirst({
      where: eq(schema.beatmaps.id, beatmapId),
      columns: {
        id: true,
      },
    });

    if (!beatmap) {
      this.logger.warn('Attempted to update fetch status for unknown beatmap', {
        beatmapId,
      });
      return;
    }

    const tournamentIds = await tournamentsUsingBeatmap(db, beatmapId);

    if (!options?.skipAutomationChecks) {
      await lockTournaments(db, [...tournamentIds]);
    }

    await db
      .update(schema.beatmaps)
      .set({ dataFetchStatus: status })
      .where(
        and(
          eq(schema.beatmaps.id, beatmapId),
          not(schema.beatmaps.manualOverride)
        )
      );

    if (!options?.skipAutomationChecks) {
      for (const id of tournamentIds) {
        await this.checkAndTriggerAutomationChecksIfComplete(id, db);
      }
    }
  }

  /**
   * Checks again whether the tournaments are complete, holding their locks,
   * for when the data behind them is already saved but its own check failed.
   */
  async recheckTournaments(tournamentIds: number[], db: Executor) {
    await lockTournaments(db, tournamentIds);
    for (const id of new Set(tournamentIds)) {
      await this.checkAndTriggerAutomationChecksIfComplete(id, db);
    }
  }

  /** Every tournament that pools the beatmap or played it in a match. */
  tournamentsUsingBeatmap(beatmapId: number, db: Executor) {
    return tournamentsUsingBeatmap(db, beatmapId);
  }

  /**
   * Queues automated checks once every match and beatmap of the tournament
   * has finished fetching, whether it succeeded or not. Callers that just
   * changed a status hold the tournament's lock, so two of them finishing a
   * tournament's last items can't each miss the other's change.
   */
  async checkAndTriggerAutomationChecksIfComplete(
    tournamentId: number,
    db: Executor = this.db
  ): Promise<boolean> {
    if (this.pendingAutomation.has(tournamentId)) {
      return false;
    }

    const matches = await db
      .select({
        id: schema.matches.id,
        dataFetchStatus: schema.matches.dataFetchStatus,
      })
      .from(schema.matches)
      .where(eq(schema.matches.tournamentId, tournamentId));

    if (matches.length === 0) {
      return false;
    }

    const matchesComplete = matches.every(
      (match) =>
        match.dataFetchStatus === DataFetchStatus.Fetched ||
        match.dataFetchStatus === DataFetchStatus.NotFound ||
        match.dataFetchStatus === DataFetchStatus.Error
    );

    if (!matchesComplete) {
      return false;
    }

    await syncTournamentDateRange(db, tournamentId, {
      logger: this.logger,
    });

    const pooledBeatmapIds = await db
      .select({ beatmapId: schema.joinPooledBeatmaps.pooledBeatmapsId })
      .from(schema.joinPooledBeatmaps)
      .where(eq(schema.joinPooledBeatmaps.tournamentsPooledInId, tournamentId));

    const gameBeatmapIds = await db
      .select({ beatmapId: schema.games.beatmapId })
      .from(schema.games)
      .innerJoin(schema.matches, eq(schema.games.matchId, schema.matches.id))
      .where(eq(schema.matches.tournamentId, tournamentId));

    const beatmapIdSet = new Set<number>();
    for (const row of pooledBeatmapIds) {
      if (row.beatmapId != null) {
        beatmapIdSet.add(row.beatmapId);
      }
    }
    for (const row of gameBeatmapIds) {
      if (row.beatmapId != null) {
        beatmapIdSet.add(row.beatmapId);
      }
    }

    if (beatmapIdSet.size > 0) {
      const beatmapStatuses = await db
        .select({ dataFetchStatus: schema.beatmaps.dataFetchStatus })
        .from(schema.beatmaps)
        .where(inArray(schema.beatmaps.id, Array.from(beatmapIdSet)));

      const beatmapsComplete = beatmapStatuses.every(
        (row) =>
          row.dataFetchStatus === DataFetchStatus.Fetched ||
          row.dataFetchStatus === DataFetchStatus.NotFound ||
          row.dataFetchStatus === DataFetchStatus.Error
      );

      if (!beatmapsComplete) {
        return false;
      }
    }

    this.pendingAutomation.add(tournamentId);

    if (this.publishAutomationCheck) {
      try {
        await this.publishAutomationCheck({
          tournamentId,
          overrideVerifiedState: false,
        });
      } catch (error) {
        this.pendingAutomation.delete(tournamentId);
        throw error;
      }
    } else {
      this.logger.info(
        'Tournament ready for automation checks (no publisher)',
        {
          tournamentId,
        }
      );
      this.pendingAutomation.delete(tournamentId);
    }

    return true;
  }

  clearPendingAutomationCheck(tournamentId: number): void {
    this.pendingAutomation.delete(tournamentId);
  }
}

/**
 * Takes each tournament's completion lock, then its row, until the
 * transaction ends, in id order. The row comes before any match or beatmap a
 * caller writes, the order admin tournament edits lock them in.
 */
const lockTournaments = async (db: Executor, tournamentIds: number[]) => {
  const ids = [...new Set(tournamentIds)].sort((a, b) => a - b);
  for (const id of ids) {
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(${COMPLETION_LOCK_CLASS}, ${id})`
    );
  }
  if (ids.length > 0) {
    await db.execute(sql`
      SELECT 1 FROM tournaments
      WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
      ORDER BY id
      FOR NO KEY UPDATE`);
  }
};

const tournamentsUsingBeatmap = async (db: Executor, beatmapId: number) => {
  const pooledTournamentRows = await db
    .select({ tournamentId: schema.joinPooledBeatmaps.tournamentsPooledInId })
    .from(schema.joinPooledBeatmaps)
    .where(eq(schema.joinPooledBeatmaps.pooledBeatmapsId, beatmapId));

  const gameTournamentRows = await db
    .select({ tournamentId: schema.matches.tournamentId })
    .from(schema.games)
    .innerJoin(schema.matches, eq(schema.games.matchId, schema.matches.id))
    .where(eq(schema.games.beatmapId, beatmapId));

  const tournamentIds = new Set<number>();
  for (const row of [...pooledTournamentRows, ...gameTournamentRows]) {
    if (row.tournamentId != null) {
      tournamentIds.add(row.tournamentId);
    }
  }
  return tournamentIds;
};
