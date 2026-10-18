import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { syncTournamentDateRange, withAuditUserId } from '@otr/core/db';
import {
  MatchAdminDeleteInputSchema,
  MatchAdminDeletePlayerScoresInputSchema,
  MatchAdminDeletePlayerScoresResponseSchema,
  MatchAdminMergeInputSchema,
  MatchAdminMergeResponseSchema,
  MatchAdminMutationResponseSchema,
  MatchAdminUpdateInputSchema,
} from '@/lib/orpc/schema/match';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import {
  mergeMatchAdminHandler,
  updateMatchAdminHandler,
} from './matchAdminHandlers';

export const updateMatchAdmin = adminMutationProcedure
  .input(MatchAdminUpdateInputSchema)
  .output(MatchAdminMutationResponseSchema)
  .route({
    summary: 'Update match',
    tags: ['admin'],
    method: 'PATCH',
    path: '/matches/{id}',
  })
  .handler(({ input, context }) => updateMatchAdminHandler({ input, context }));

export const mergeMatchAdmin = adminMutationProcedure
  .input(MatchAdminMergeInputSchema)
  .output(MatchAdminMergeResponseSchema)
  .route({
    summary: 'Merge matches',
    tags: ['admin'],
    method: 'POST',
    path: '/matches:merge',
  })
  .handler(({ input, context }) => mergeMatchAdminHandler({ input, context }));

export const deleteMatchAdmin = adminMutationProcedure
  .input(MatchAdminDeleteInputSchema)
  .output(MatchAdminMutationResponseSchema)
  .route({
    summary: 'Delete match',
    tags: ['admin'],
    method: 'DELETE',
    path: '/matches/{id}',
  })
  .handler(async ({ input, context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    return context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, async () => {
        const match = await tx.query.matches.findFirst({
          columns: {
            id: true,
            tournamentId: true,
          },
          where: eq(schema.matches.id, input.id),
        });

        if (!match) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Match not found',
          });
        }

        await tx.delete(schema.matches).where(eq(schema.matches.id, input.id));

        if (match.tournamentId != null) {
          await syncTournamentDateRange(tx, match.tournamentId);
        }

        return { success: true } as const;
      })
    );
  });

export const deleteMatchPlayerScoresAdmin = adminMutationProcedure
  .input(MatchAdminDeletePlayerScoresInputSchema)
  .output(MatchAdminDeletePlayerScoresResponseSchema)
  .route({
    summary: 'Delete player scores from match',
    tags: ['admin'],
    method: 'DELETE',
    path: '/matches/{matchId}/players/{playerId}/scores',
  })
  .handler(async ({ input, context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    return context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, async () => {
        const gameRows = await tx
          .select({ id: schema.games.id })
          .from(schema.games)
          .where(eq(schema.games.matchId, input.matchId));

        const gameIds = gameRows.map((row) => row.id);

        if (gameIds.length === 0) {
          return { success: true, deletedCount: 0 } as const;
        }

        const deleted = await tx
          .delete(schema.gameScores)
          .where(
            and(
              eq(schema.gameScores.playerId, input.playerId),
              inArray(schema.gameScores.gameId, gameIds)
            )
          )
          .returning({ id: schema.gameScores.id });

        return { success: true, deletedCount: deleted.length } as const;
      })
    );
  });
