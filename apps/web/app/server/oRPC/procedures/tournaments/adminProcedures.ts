import { ORPCError } from '@orpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { cascadeTournamentRejection } from '@otr/core/db/rejection-cascade';
import { cascadeTournamentVerification } from '@otr/core/db/verification-cascade';
import { resolveTournamentVerification } from '@otr/core/db/verification-resolve';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { withAuditUserId } from '@otr/core/db';
import { parseForumTopicId } from '@otr/core/osu/forum';
import {
  TournamentAdminMutationResponseSchema,
  TournamentAdminUpdateInputSchema,
  TournamentIdInputSchema,
  TournamentRefetchBeatmapDataResponseSchema,
  TournamentRefetchMatchDataResponseSchema,
  TournamentResetAutomatedChecksInputSchema,
  type TournamentAdminUpdateInput,
  type TournamentIdInput,
  type TournamentResetAutomatedChecksInput,
} from '@/lib/orpc/schema/tournament';
import type { DatabaseClient } from '@/lib/db';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { getCorrelationId } from '../logging/helpers';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import {
  publishFetchBeatmapMessage,
  publishFetchForumTopicMessage,
  publishFetchMatchMessage,
  publishProcessTournamentAutomationCheckMessage,
} from '@/lib/queue/publishers';
import { MessagePriority } from '@otr/core';

const NOW = sql`CURRENT_TIMESTAMP`;
export const REFETCH_QUEUE_WARNING =
  'We could not queue match or beatmap fetches. Please contact the o!TR developers.';

export const AUTOMATION_QUEUE_WARNING =
  'We could not queue automated checks. Please contact the o!TR developers.';

interface RefetchMatchDataContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface RefetchMatchDataArgs {
  input: TournamentIdInput;
  context: RefetchMatchDataContext;
}

export async function refetchTournamentMatchDataHandler({
  input,
  context,
}: RefetchMatchDataArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const matches: Array<{ id: number; osuId: number; isLazer: boolean }> =
    await context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, () =>
        tx
          .update(schema.matches)
          .set({
            dataFetchStatus: DataFetchStatus.NotFetched,
            updated: NOW,
          })
          .where(eq(schema.matches.tournamentId, input.id))
          .returning({
            id: schema.matches.id,
            osuId: schema.matches.osuId,
            isLazer: schema.matches.isLazer,
          })
      )
    );

  const uniqueMatches = Array.from(
    new Map(
      matches
        .filter((match) => Number.isFinite(Number(match.osuId)))
        .map((match) => [
          `${match.osuId}-${match.isLazer}`,
          { osuMatchId: Number(match.osuId), isLazer: match.isLazer },
        ])
    ).values()
  );

  const correlationId = getCorrelationId(context);
  const queueTasks: Array<{
    kind: 'match' | 'beatmap';
    id: number;
    promise: Promise<unknown>;
  }> = [];

  uniqueMatches.forEach(({ osuMatchId, isLazer }) => {
    queueTasks.push({
      kind: 'match',
      id: osuMatchId,
      promise: publishFetchMatchMessage(
        { osuMatchId, isLazer },
        correlationId ? { metadata: { correlationId } } : undefined
      ),
    });
  });

  const warnings: string[] = [];

  if (queueTasks.length > 0) {
    const results = await Promise.allSettled(
      queueTasks.map((task) => task.promise)
    );

    const failures = results
      .map((result, index) => ({ result, task: queueTasks[index] }))
      .filter(
        (
          entry
        ): entry is {
          result: PromiseRejectedResult;
          task: (typeof queueTasks)[number];
        } => entry.result.status === 'rejected'
      );

    if (failures.length > 0) {
      warnings.push(REFETCH_QUEUE_WARNING);

      failures.forEach(({ task, result }) => {
        console.error('Failed to publish refetch message', {
          type: task.kind,
          id: task.id,
          error: result.reason,
        });
      });
    }
  }

  return {
    success: true,
    matchesUpdated: matches.length,
    warnings: warnings.length ? warnings : undefined,
  } as const;
}

interface RefetchBeatmapDataContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface RefetchBeatmapDataArgs {
  input: TournamentIdInput;
  context: RefetchBeatmapDataContext;
}

export async function refetchTournamentBeatmapsHandler({
  input,
  context,
}: RefetchBeatmapDataArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const beatmapRows = await context.db
    .select({
      id: schema.beatmaps.id,
      osuId: schema.beatmaps.osuId,
      dataFetchStatus: schema.beatmaps.dataFetchStatus,
    })
    .from(schema.joinPooledBeatmaps)
    .innerJoin(
      schema.beatmaps,
      eq(schema.beatmaps.id, schema.joinPooledBeatmaps.pooledBeatmapsId)
    )
    .where(eq(schema.joinPooledBeatmaps.tournamentsPooledInId, input.id));

  const beatmapIdsToUpdate = beatmapRows
    .filter((b) => b.dataFetchStatus !== DataFetchStatus.NotFound)
    .map((b) => b.id);

  if (beatmapIdsToUpdate.length > 0) {
    await context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, () =>
        tx
          .update(schema.beatmaps)
          .set({
            dataFetchStatus: DataFetchStatus.NotFetched,
            updated: NOW,
          })
          .where(inArray(schema.beatmaps.id, beatmapIdsToUpdate))
      )
    );
  }

  const correlationId = getCorrelationId(context);
  const queueTasks = beatmapRows
    .filter((b) => b.dataFetchStatus !== DataFetchStatus.NotFound)
    .map((b) => ({
      beatmapId: b.osuId,
      promise: publishFetchBeatmapMessage(
        {
          beatmapId: b.osuId,
          skipAutomationChecks: true,
        },
        {
          metadata: {
            priority: MessagePriority.High,
            ...(correlationId && { correlationId }),
          },
        }
      ),
    }));

  const warnings: string[] = [];

  if (queueTasks.length > 0) {
    const results = await Promise.allSettled(queueTasks.map((t) => t.promise));
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      warnings.push(REFETCH_QUEUE_WARNING);
    }
  }

  return {
    success: true,
    beatmapsUpdated: beatmapIdsToUpdate.length,
    beatmapsSkipped: beatmapRows.length - beatmapIdsToUpdate.length,
    warnings: warnings.length ? warnings : undefined,
  } as const;
}

interface ResetAutomatedChecksContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface ResetAutomatedChecksArgs {
  input: TournamentResetAutomatedChecksInput;
  context: ResetAutomatedChecksContext;
}

export async function resetTournamentAutomatedChecksHandler({
  input,
  context,
}: ResetAutomatedChecksArgs) {
  ensureAdminSession(context.session);

  const warnings: string[] = [];
  const correlationId = getCorrelationId(context);

  try {
    await publishProcessTournamentAutomationCheckMessage(
      {
        tournamentId: input.id,
        overrideVerifiedState: input.overrideVerifiedState ?? false,
      },
      correlationId ? { metadata: { correlationId } } : undefined
    );
  } catch (error) {
    console.error('Failed to publish automated checks reset message', {
      tournamentId: input.id,
      error,
    });
    warnings.push(AUTOMATION_QUEUE_WARNING);
  }

  return {
    success: true,
    warnings: warnings.length ? warnings : undefined,
  } as const;
}

interface UpdateTournamentAdminContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface UpdateTournamentAdminArgs {
  input: TournamentAdminUpdateInput;
  context: UpdateTournamentAdminContext;
}

export async function updateTournamentAdminHandler({
  input,
  context,
}: UpdateTournamentAdminArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const existing = await context.db.query.tournaments.findFirst({
    columns: {
      id: true,
      verifiedByUserId: true,
      verificationStatus: true,
      ruleset: true,
      forumUrl: true,
    },
    where: eq(schema.tournaments.id, input.id),
  });

  if (!existing) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Tournament not found',
    });
  }

  const verificationStatusChanged =
    input.verificationStatus !== existing.verificationStatus;

  const newStatusRequiresReviewer =
    input.verificationStatus === VerificationStatus.Verified ||
    input.verificationStatus === VerificationStatus.Rejected;

  const forumUrlChanged = input.forumUrl !== existing.forumUrl;

  const shouldPropagateManiaVariant =
    existing.ruleset === Ruleset.ManiaOther &&
    (input.ruleset === Ruleset.Mania4k || input.ruleset === Ruleset.Mania7k);

  await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const verifiedByUserId = (() => {
        if (!verificationStatusChanged) {
          return existing.verifiedByUserId;
        }

        if (newStatusRequiresReviewer) {
          return adminUserId;
        }

        return null;
      })();

      await tx
        .update(schema.tournaments)
        .set({
          name: input.name,
          abbreviation: input.abbreviation,
          forumUrl: input.forumUrl,
          // The worker links the new URL's post once it is fetched.
          ...(forumUrlChanged ? { forumPostId: null } : {}),
          rankRangeLowerBound: input.rankRangeLowerBound,
          ruleset: input.ruleset,
          lobbySize: input.lobbySize,
          verificationStatus: input.verificationStatus,
          rejectionReason: input.rejectionReason,
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
          verifiedByUserId,
          updated: NOW,
        })
        .where(eq(schema.tournaments.id, input.id));

      if (shouldPropagateManiaVariant) {
        await alignTournamentChildRulesets(tx, input.id, input.ruleset);
      }

      if (input.verificationStatus === VerificationStatus.Verified) {
        if (input.children === 'set') {
          await cascadeTournamentVerification(tx, [input.id], {
            updatedAt: NOW,
          });
        } else if (input.children === 'accept') {
          await resolveTournamentVerification(tx, input.id, {
            updatedAt: NOW,
            verifiedByUserId: adminUserId,
          });
        }
      }

      if (input.verificationStatus === VerificationStatus.Rejected) {
        await cascadeTournamentRejection(tx, [input.id], {
          updatedAt: NOW,
        });
      }
    })
  );

  const topicId = forumUrlChanged ? parseForumTopicId(input.forumUrl) : null;
  if (topicId !== null) {
    const correlationId = getCorrelationId(context);
    try {
      await publishFetchForumTopicMessage(
        { topicId },
        correlationId ? { metadata: { correlationId } } : undefined
      );
    } catch (error) {
      // The data worker's startup backfill queues it again.
      console.error('Failed to publish forum topic fetch message', {
        tournamentId: input.id,
        topicId,
        error,
      });
    }
  }

  return { success: true } as const;
}

export const updateTournamentAdmin = adminMutationProcedure
  .input(TournamentAdminUpdateInputSchema)
  .output(TournamentAdminMutationResponseSchema)
  .route({
    summary: 'Update tournament',
    tags: ['admin'],
    method: 'PATCH',
    path: '/tournaments/{id}',
  })
  .handler(({ input, context }) =>
    updateTournamentAdminHandler({ input, context })
  );

async function alignTournamentChildRulesets(
  tx: Pick<DatabaseClient, 'select' | 'update'>,
  tournamentId: number,
  nextRuleset: Ruleset
) {
  const matchRows = await tx
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(eq(schema.matches.tournamentId, tournamentId));

  if (matchRows.length === 0) {
    return;
  }

  const matchIds = matchRows.map((row) => row.id);

  const gameRows = await tx
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(inArray(schema.games.matchId, matchIds));

  if (gameRows.length === 0) {
    return;
  }

  const gameIds = gameRows.map((row) => row.id);

  // Propagate variants to games/scores
  await tx
    .update(schema.games)
    .set({
      ruleset: nextRuleset,
      updated: NOW,
    })
    .where(inArray(schema.games.id, gameIds));

  await tx
    .update(schema.gameScores)
    .set({
      ruleset: nextRuleset,
      updated: NOW,
    })
    .where(inArray(schema.gameScores.gameId, gameIds));
}

export const resetTournamentAutomatedChecks = adminMutationProcedure
  .input(TournamentResetAutomatedChecksInputSchema)
  .output(TournamentAdminMutationResponseSchema)
  .route({
    summary: 'Reset tournament automated checks',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/{id}:reset-automated-checks',
  })
  .handler(async ({ input, context }) =>
    resetTournamentAutomatedChecksHandler({ input, context })
  );

export interface AcceptTournamentPreVerificationStatusesArgs {
  input: TournamentIdInput;
  context: UpdateTournamentAdminContext;
}

export async function acceptTournamentPreVerificationStatusesHandler({
  input,
  context,
}: AcceptTournamentPreVerificationStatusesArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      await tx
        .update(schema.tournaments)
        .set({
          verificationStatus: VerificationStatus.Verified,
          rejectionReason: 0,
          verifiedByUserId: adminUserId,
          updated: NOW,
        })
        .where(
          and(
            eq(schema.tournaments.id, input.id),
            eq(
              schema.tournaments.verificationStatus,
              VerificationStatus.PreVerified
            )
          )
        );

      await tx
        .update(schema.tournaments)
        .set({
          verificationStatus: VerificationStatus.Rejected,
          verifiedByUserId: adminUserId,
          updated: NOW,
        })
        .where(
          and(
            eq(schema.tournaments.id, input.id),
            eq(
              schema.tournaments.verificationStatus,
              VerificationStatus.PreRejected
            )
          )
        );

      const [tournament] = await tx
        .select({ verificationStatus: schema.tournaments.verificationStatus })
        .from(schema.tournaments)
        .where(eq(schema.tournaments.id, input.id));

      if (!tournament) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Tournament not found',
        });
      }

      if (tournament.verificationStatus === VerificationStatus.Rejected) {
        await cascadeTournamentRejection(tx, [input.id], { updatedAt: NOW });
        return;
      }

      await resolveTournamentVerification(tx, input.id, {
        updatedAt: NOW,
        verifiedByUserId: adminUserId,
      });
    })
  );

  return { success: true } as const;
}

export const acceptTournamentPreVerificationStatuses = adminMutationProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentAdminMutationResponseSchema)
  .route({
    summary: 'Accept tournament pre-verification statuses',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/{id}:accept-pre-verification-statuses',
  })
  .handler(({ input, context }) =>
    acceptTournamentPreVerificationStatusesHandler({ input, context })
  );

export const deleteTournamentAdmin = adminMutationProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentAdminMutationResponseSchema)
  .route({
    summary: 'Delete tournament',
    tags: ['admin'],
    method: 'DELETE',
    path: '/tournaments/{id}',
  })
  .handler(async ({ input, context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    const deleted = await context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, () =>
        tx
          .delete(schema.tournaments)
          .where(eq(schema.tournaments.id, input.id))
          .returning({ id: schema.tournaments.id })
      )
    );

    if (deleted.length === 0) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Tournament not found',
      });
    }

    return { success: true } as const;
  });

export const deleteTournamentBeatmapsAdmin = adminMutationProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentAdminMutationResponseSchema)
  .route({
    summary: 'Delete tournament beatmaps',
    tags: ['admin'],
    method: 'DELETE',
    path: '/tournaments/{id}/beatmaps',
  })
  .handler(async ({ input, context }) => {
    ensureAdminSession(context.session);

    await context.db
      .delete(schema.joinPooledBeatmaps)
      .where(eq(schema.joinPooledBeatmaps.tournamentsPooledInId, input.id));

    return { success: true } as const;
  });

export const refetchTournamentMatchData = adminMutationProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentRefetchMatchDataResponseSchema)
  .route({
    summary: 'Refetch tournament match data',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/{id}:refetch-match-data',
  })
  .handler(async ({ input, context }) =>
    refetchTournamentMatchDataHandler({ input, context })
  );

export const refetchTournamentBeatmaps = adminMutationProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentRefetchBeatmapDataResponseSchema)
  .route({
    summary: 'Refetch tournament beatmap data',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/{id}:refetch-beatmap-data',
  })
  .handler(async ({ input, context }) =>
    refetchTournamentBeatmapsHandler({ input, context })
  );
