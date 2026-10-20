import { ORPCError } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';

import {
  adminEditColumns,
  withAuditUserId,
  withoutEditedFields,
  type AdminEditTable,
} from '@otr/core/db';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import * as schema from '@otr/core/db/schema';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import type { DatabaseClient } from '@/lib/db';
import type { AdminEditResetInput } from '@/lib/orpc/schema/match';

import { getCorrelationId } from '../logging/helpers';
import { ensureAdminSession } from './adminGuard';

// No `../base` import here, so handler tests skip the auth/db module graph

const NOW = sql`CURRENT_TIMESTAMP`;

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

interface ResetEditedFieldsArgs {
  table: AdminEditTable;
  input: AdminEditResetInput;
  context: {
    db: DatabaseClient;
    session: {
      dbUser?: {
        id: number;
        scopes?: string[] | null;
      } | null;
    } | null;
  };
}

/**
 * Unlocks fields an admin edited on a match, game or score and queues a fetch
 * of its match, which writes osu!'s values back. Until that fetch runs, the
 * edited values stay.
 */
export async function resetEditedFieldsHandler({
  table,
  input,
  context,
}: ResetEditedFieldsArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  try {
    adminEditColumns(table, input.fields);
  } catch (error) {
    throw new ORPCError('BAD_REQUEST', {
      message: error instanceof Error ? error.message : 'Unknown field',
    });
  }

  await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const matchId = await unlockFields(tx, table, input);

      if (matchId == null) {
        throw new ORPCError('NOT_FOUND', {
          message: `${ENTITY_NAMES[table]} not found`,
        });
      }

      const [match] = await tx
        .update(schema.matches)
        .set({ dataFetchStatus: DataFetchStatus.NotFetched, updated: NOW })
        .where(eq(schema.matches.id, matchId))
        .returning({
          osuId: schema.matches.osuId,
          isLazer: schema.matches.isLazer,
          tournamentId: schema.matches.tournamentId,
        });

      await enqueueJobs(tx, JobQueue.OsuFetch, [
        {
          payload: {
            type: 'match',
            osuMatchId: match!.osuId,
            isLazer: match!.isLazer,
          },
          correlationId: getCorrelationId(context),
          tournamentId: match!.tournamentId,
          requestedByUserId: adminUserId,
          explicit: true,
        },
      ]);
    })
  );

  return { success: true } as const;
}

const ENTITY_NAMES: Record<AdminEditTable, string> = {
  matches: 'Match',
  games: 'Game',
  game_scores: 'Score',
};

/** Unlocks the fields and returns the ID of the row's match, or null. */
async function unlockFields(
  tx: Transaction,
  table: AdminEditTable,
  { id, fields }: AdminEditResetInput
): Promise<number | null> {
  const editedFields = withoutEditedFields(table, fields);

  if (table === 'matches') {
    const [match] = await tx
      .update(schema.matches)
      .set({ editedFields, updated: NOW })
      .where(eq(schema.matches.id, id))
      .returning({ id: schema.matches.id });
    return match?.id ?? null;
  }

  if (table === 'games') {
    const [game] = await tx
      .update(schema.games)
      .set({ editedFields, updated: NOW })
      .where(eq(schema.games.id, id))
      .returning({ matchId: schema.games.matchId });
    return game?.matchId ?? null;
  }

  const [score] = await tx
    .update(schema.gameScores)
    .set({ editedFields, updated: NOW })
    .where(eq(schema.gameScores.id, id))
    .returning({ gameId: schema.gameScores.gameId });
  if (!score) {
    return null;
  }

  const [game] = await tx
    .select({ matchId: schema.games.matchId })
    .from(schema.games)
    .where(eq(schema.games.id, score.gameId));
  return game?.matchId ?? null;
}
