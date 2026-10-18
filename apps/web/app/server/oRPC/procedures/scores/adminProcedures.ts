import { ORPCError } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { withAuditUserId } from '@otr/core/db';
import {
  GameScoreAdminDeleteInputSchema,
  GameScoreAdminMutationResponseSchema,
  GameScoreAdminUpdateInputSchema,
} from '@/lib/orpc/schema/match';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';

const NOW = sql`CURRENT_TIMESTAMP`;

export const updateScoreAdmin = adminMutationProcedure
  .input(GameScoreAdminUpdateInputSchema)
  .output(GameScoreAdminMutationResponseSchema)
  .route({
    summary: 'Update game score',
    tags: ['admin'],
    method: 'PATCH',
    path: '/scores/{id}',
  })
  .handler(async ({ input, context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    await context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, async () => {
        const existing = await tx.query.gameScores.findFirst({
          columns: { id: true, mods: true },
          where: eq(schema.gameScores.id, input.id),
        });

        if (!existing) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Score not found',
          });
        }

        await tx
          .update(schema.gameScores)
          .set({
            scoreOverride: input.scoreOverride,
            placement: input.placement,
            maxCombo: input.maxCombo,
            accuracy: input.accuracy,
            statGreat: input.statGreat,
            statOk: input.statOk,
            statMeh: input.statMeh,
            statMiss: input.statMiss,
            statGood: input.statGood,
            statPerfect: input.statPerfect,
            grade: input.grade,
            mods: input.mods,
            // The site shows lazer mods over the flags, so edited flags replace them.
            ...(input.mods !== existing.mods && { lazerMods: null }),
            team: input.team,
            ruleset: input.ruleset,
            verificationStatus: input.verificationStatus,
            rejectionReason: input.rejectionReason,
            updated: NOW,
          })
          .where(eq(schema.gameScores.id, input.id));
      })
    );

    return { success: true } as const;
  });

export const deleteScoreAdmin = adminMutationProcedure
  .input(GameScoreAdminDeleteInputSchema)
  .output(GameScoreAdminMutationResponseSchema)
  .route({
    summary: 'Delete game score',
    tags: ['admin'],
    method: 'DELETE',
    path: '/scores/{id}',
  })
  .handler(async ({ input, context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    const deleted = await context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, () =>
        tx
          .delete(schema.gameScores)
          .where(eq(schema.gameScores.id, input.id))
          .returning({ id: schema.gameScores.id })
      )
    );

    if (deleted.length === 0) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Score not found',
      });
    }

    return { success: true } as const;
  });
