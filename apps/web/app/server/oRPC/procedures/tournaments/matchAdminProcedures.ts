import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { syncTournamentDateRange, withAuditUserId } from '@otr/core/db';
import { VerificationStatus } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';
import {
  TournamentMatchAdminMutationInputSchema,
  TournamentMatchAdminMutationResponseSchema,
  type TournamentMatchAdminMutationInput,
} from '@/lib/orpc/schema/tournament';
import { publishFetchMatchMessage } from '@/lib/queue/publishers';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { getCorrelationId } from '../logging/helpers';

const QUEUE_FAILURE_WARNING =
  'We could not queue match data fetches. Please contact the o!TR developers.';

export interface ManageTournamentMatchesAdminArgs {
  input: TournamentMatchAdminMutationInput;
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

export async function manageTournamentMatchesAdminHandler({
  input,
  context,
}: ManageTournamentMatchesAdminArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const tournament = await context.db.query.tournaments.findFirst({
    columns: { id: true },
    where: eq(schema.tournaments.id, input.tournamentId),
  });

  if (!tournament) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Tournament not found',
    });
  }

  const addMatches = input.addMatchOsuIds.map((m) => ({
    osuId: m.osuId,
    isLazer: m.isLazer,
  }));
  const removeIds = Array.from(new Set(input.removeMatchIds));

  let addedCount = 0;
  let skippedCount = 0;
  let removedCount = 0;
  const matchesToQueue: Array<{ osuMatchId: number; isLazer: boolean }> = [];
  const warnings: string[] = [];

  await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      if (removeIds.length > 0) {
        const deleted = await tx
          .delete(schema.matches)
          .where(
            and(
              eq(schema.matches.tournamentId, input.tournamentId),
              inArray(schema.matches.id, removeIds)
            )
          )
          .returning({ id: schema.matches.id });

        removedCount = deleted.length;
      }

      if (addMatches.length > 0) {
        const uniqueMatches = new Map<
          string,
          { osuId: number; isLazer: boolean }
        >();
        for (const match of addMatches) {
          const key = `${match.osuId}-${match.isLazer}`;
          if (!uniqueMatches.has(key)) {
            uniqueMatches.set(key, match);
          }
        }

        for (const match of uniqueMatches.values()) {
          const existingMatch = await tx.query.matches.findFirst({
            columns: { id: true, tournamentId: true },
            where: and(
              eq(schema.matches.osuId, match.osuId),
              eq(schema.matches.isLazer, match.isLazer)
            ),
          });

          if (existingMatch) {
            if (existingMatch.tournamentId === input.tournamentId) {
              skippedCount++;
            } else {
              warnings.push(
                `Match ${match.osuId} already exists in another tournament`
              );
              skippedCount++;
            }
            continue;
          }

          const merge = await tx.query.matchMerges.findFirst({
            columns: { matchId: true },
            where: and(
              eq(schema.matchMerges.osuId, match.osuId),
              eq(schema.matchMerges.isLazer, match.isLazer)
            ),
          });

          if (merge) {
            warnings.push(
              `Match ${match.osuId} was merged into match ${merge.matchId}`
            );
            skippedCount++;
            continue;
          }

          await tx.insert(schema.matches).values({
            osuId: match.osuId,
            isLazer: match.isLazer,
            tournamentId: input.tournamentId,
            submittedByUserId: adminUserId,
            verificationStatus: VerificationStatus.None,
            rejectionReason: 0,
            warningFlags: 0,
          });

          addedCount++;
          matchesToQueue.push({
            osuMatchId: match.osuId,
            isLazer: match.isLazer,
          });
        }
      }

      if (removedCount > 0 || addedCount > 0) {
        await syncTournamentDateRange(tx, input.tournamentId);
      }
    })
  );

  if (matchesToQueue.length > 0) {
    const correlationId = getCorrelationId(context);
    const results = await Promise.allSettled(
      matchesToQueue.map(({ osuMatchId, isLazer }) =>
        publishFetchMatchMessage(
          { osuMatchId, isLazer },
          correlationId ? { metadata: { correlationId } } : undefined
        )
      )
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      warnings.push(QUEUE_FAILURE_WARNING);
      failures.forEach((result) => {
        console.error('Failed to publish match fetch message', {
          error: (result as PromiseRejectedResult).reason,
        });
      });
    }
  }

  return {
    success: true,
    addedCount,
    skippedCount,
    removedCount,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export const manageTournamentMatchesAdmin = adminMutationProcedure
  .input(TournamentMatchAdminMutationInputSchema)
  .output(TournamentMatchAdminMutationResponseSchema)
  .route({
    summary: 'Manage tournament matches',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/matches:manage',
  })
  .handler(({ input, context }) =>
    manageTournamentMatchesAdminHandler({ input, context })
  );
