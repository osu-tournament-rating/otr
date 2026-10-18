import { ORPCError } from '@orpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { cascadeTournamentRejection } from '@otr/core/db/rejection-cascade';
import { cascadeTournamentVerification } from '@otr/core/db/verification-cascade';
import { resolveTournamentVerification } from '@otr/core/db/verification-resolve';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { withAuditUserId } from '@otr/core/db';
import { parseForumTopicId } from '@otr/core/osu/forum';
import { enqueueJob, enqueueJobs, JobQueue } from '@otr/core/jobs';
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
import { MessagePriority } from '@otr/core';

const NOW = sql`CURRENT_TIMESTAMP`;

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
  const correlationId = getCorrelationId(context);

  const matchesUpdated = await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const matches = await tx
        .update(schema.matches)
        .set({
          dataFetchStatus: DataFetchStatus.NotFetched,
          updated: NOW,
        })
        .where(eq(schema.matches.tournamentId, input.id))
        .returning({
          osuId: schema.matches.osuId,
          isLazer: schema.matches.isLazer,
        });

      await enqueueJobs(
        tx,
        JobQueue.OsuFetch,
        matches.map(({ osuId, isLazer }) => ({
          payload: { type: 'match', osuMatchId: osuId, isLazer },
          correlationId,
          tournamentId: input.id,
          requestedByUserId: adminUserId,
          explicit: true,
        }))
      );

      return matches.length;
    })
  );

  return { success: true, matchesUpdated } as const;
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
  const correlationId = getCorrelationId(context);

  return context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const beatmapRows = await tx
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

      const beatmapsToRefetch = beatmapRows.filter(
        (b) => b.dataFetchStatus !== DataFetchStatus.NotFound
      );

      if (beatmapsToRefetch.length > 0) {
        await tx
          .update(schema.beatmaps)
          .set({
            dataFetchStatus: DataFetchStatus.NotFetched,
            updated: NOW,
          })
          .where(
            inArray(
              schema.beatmaps.id,
              beatmapsToRefetch.map((b) => b.id)
            )
          );

        await enqueueJobs(
          tx,
          JobQueue.OsuFetch,
          beatmapsToRefetch.map((b) => ({
            payload: {
              type: 'beatmap',
              beatmapId: b.osuId,
              skipAutomationChecks: true,
            },
            priority: MessagePriority.High,
            correlationId,
            tournamentId: input.id,
            requestedByUserId: adminUserId,
            explicit: true,
          }))
        );
      }

      return {
        success: true,
        beatmapsUpdated: beatmapsToRefetch.length,
        beatmapsSkipped: beatmapRows.length - beatmapsToRefetch.length,
      } as const;
    })
  );
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

/**
 * Queues the tournament's automated checks. The request merges into a check
 * already waiting and clears its backoff, or runs again after one that is
 * running. A failed enqueue fails the call, since nothing else was saved.
 */
export async function resetTournamentAutomatedChecksHandler({
  input,
  context,
}: ResetAutomatedChecksArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  await enqueueJob(context.db, JobQueue.TournamentChecks, {
    payload: {
      tournamentId: input.id,
      overrideVerifiedState: input.overrideVerifiedState ?? false,
    },
    correlationId: getCorrelationId(context),
    tournamentId: input.id,
    requestedByUserId: adminUserId,
    explicit: true,
  });

  return { success: true } as const;
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

      const topicId = forumUrlChanged
        ? parseForumTopicId(input.forumUrl)
        : null;
      if (topicId !== null) {
        await enqueueJobs(tx, JobQueue.OsuFetch, [
          {
            payload: { type: 'forumTopic', topicId },
            correlationId: getCorrelationId(context),
            tournamentId: input.id,
            requestedByUserId: adminUserId,
            explicit: true,
          },
        ]);
      }
    })
  );

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
