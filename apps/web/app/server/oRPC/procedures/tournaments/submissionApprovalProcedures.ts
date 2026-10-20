import { ORPCError } from '@orpc/server';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { ApprovalStatus } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';
import { withAuditUserId } from '@otr/core/db';
import { ApprovalIdInputSchema } from '@/lib/orpc/schema/approval';
import {
  AdminTournamentSubmissionListSchema,
  MyTournamentSubmissionListSchema,
  TournamentSubmissionApprovalResponseSchema,
  type AdminTournamentSubmission,
  type TournamentSubmissionSummary,
} from '@/lib/orpc/schema/tournamentSubmission';
import type { DatabaseClient } from '@/lib/db';

import { adminMutationProcedure, protectedProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { loadApprovalUsers } from '../shared/approvalUsers';
import { getCorrelationId } from '../logging/helpers';
import {
  createTournament,
  TOURNAMENT_CREATION_ERRORS,
  tournamentConflictError,
  type TournamentCreationErrors,
} from './tournamentSubmissionProcedure';

type SubmissionRow = typeof schema.tournamentSubmissions.$inferSelect;

const toSummary = (row: SubmissionRow): TournamentSubmissionSummary => ({
  id: row.id,
  status: row.status as ApprovalStatus,
  created: row.created,
  name: row.name,
  abbreviation: row.abbreviation,
  forumUrl: row.forumUrl,
  ruleset: row.ruleset,
  rankRangeLowerBound: row.rankRangeLowerBound,
  lobbySize: row.lobbySize,
  isLazer: row.isLazer,
  matchCount: row.matchIds.length,
  beatmapCount: row.beatmapIds.length,
  tournamentId: row.tournamentId,
  reviewedAt: row.reviewedAt,
});

interface SessionContext {
  db: DatabaseClient;
  session: {
    dbUser?: { id: number; scopes?: string[] | null } | null;
  } | null;
}

/** Locks a held submission for review, refusing one already decided. */
async function lockPendingSubmission(
  tx: Parameters<Parameters<DatabaseClient['transaction']>[0]>[0],
  id: number
) {
  const [submission] = await tx
    .select()
    .from(schema.tournamentSubmissions)
    .where(eq(schema.tournamentSubmissions.id, id))
    .for('update');

  if (!submission) {
    throw new ORPCError('NOT_FOUND', {
      message: `Tournament submission ${id} was not found`,
    });
  }

  if (submission.status !== ApprovalStatus.Pending) {
    throw new ORPCError('CONFLICT', {
      message: `Tournament submission ${id} was already ${
        submission.status === ApprovalStatus.Approved ? 'approved' : 'denied'
      }`,
    });
  }

  return submission;
}

export async function listTournamentSubmissionsAdminHandler({
  context,
}: {
  context: SessionContext;
}) {
  ensureAdminSession(context.session);

  // The queue: every held submission, oldest first
  const rows = await context.db
    .select()
    .from(schema.tournamentSubmissions)
    .where(eq(schema.tournamentSubmissions.status, ApprovalStatus.Pending))
    .orderBy(
      asc(schema.tournamentSubmissions.created),
      asc(schema.tournamentSubmissions.id)
    );

  const users = await loadApprovalUsers(
    context.db,
    rows.flatMap((row) => [row.submittedByUserId, row.reviewedByUserId])
  );

  return {
    submissions: rows.map((row): AdminTournamentSubmission => ({
      ...toSummary(row),
      submitter:
        row.submittedByUserId === null
          ? null
          : (users.get(row.submittedByUserId) ?? null),
      reviewer:
        row.reviewedByUserId === null
          ? null
          : (users.get(row.reviewedByUserId) ?? null),
      matchIds: row.matchIds.map(Number),
      beatmapIds: row.beatmapIds.map(Number),
    })),
  };
}

export interface ApproveTournamentSubmissionArgs {
  input: { id: number };
  context: SessionContext;
  errors: TournamentCreationErrors;
}

/**
 * Creates the tournament a held submission describes and queues its
 * fetches, in the same transaction that marks the submission approved. The
 * tournament keeps the submitter and the time they submitted it.
 */
export async function approveTournamentSubmissionHandler({
  input,
  context,
  errors,
}: ApproveTournamentSubmissionArgs) {
  const { adminUserId } = ensureAdminSession(context.session);
  const correlationId = getCorrelationId(context);

  try {
    return await context.db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, async () => {
        const submission = await lockPendingSubmission(tx, input.id);

        const tournamentId = await createTournament(
          tx,
          {
            name: submission.name,
            abbreviation: submission.abbreviation,
            forumUrl: submission.forumUrl,
            rankRangeLowerBound: submission.rankRangeLowerBound,
            ruleset: submission.ruleset,
            lobbySize: submission.lobbySize,
            isLazer: submission.isLazer,
            ids: submission.matchIds.map(Number),
            beatmapIds: submission.beatmapIds.map(Number),
          },
          errors,
          {
            rejectionReason: 0,
            submittedByUserId: submission.submittedByUserId,
            requestedByUserId: submission.submittedByUserId ?? adminUserId,
            correlationId,
            created: submission.created,
          }
        );

        await tx
          .update(schema.tournamentSubmissions)
          .set({
            status: ApprovalStatus.Approved,
            tournamentId,
            reviewedByUserId: adminUserId,
            reviewedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.tournamentSubmissions.id, submission.id));

        return { tournamentId };
      })
    );
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    const conflict = tournamentConflictError(error, errors);
    if (conflict) {
      throw conflict;
    }

    throw error;
  }
}

export async function denyTournamentSubmissionHandler({
  input,
  context,
}: {
  input: { id: number };
  context: SessionContext;
}) {
  const { adminUserId } = ensureAdminSession(context.session);

  await context.db.transaction(async (tx) => {
    const submission = await lockPendingSubmission(tx, input.id);

    await tx
      .update(schema.tournamentSubmissions)
      .set({
        status: ApprovalStatus.Denied,
        reviewedByUserId: adminUserId,
        reviewedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.tournamentSubmissions.id, submission.id));
  });

  return { success: true as const };
}

export const listTournamentSubmissionsAdmin = protectedProcedure
  .output(AdminTournamentSubmissionListSchema)
  .route({
    summary: 'List tournament submissions waiting for approval (admin)',
    tags: ['admin'],
    method: 'GET',
    path: '/tournaments/submissions',
  })
  .handler(({ context }) => listTournamentSubmissionsAdminHandler({ context }));

export const approveTournamentSubmissionAdmin = adminMutationProcedure
  .input(ApprovalIdInputSchema)
  .output(TournamentSubmissionApprovalResponseSchema)
  .errors(TOURNAMENT_CREATION_ERRORS)
  .route({
    summary: 'Approve a tournament submission (admin)',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/submissions/{id}:approve',
  })
  .handler(({ input, context, errors }) =>
    approveTournamentSubmissionHandler({ input, context, errors })
  );

export const denyTournamentSubmissionAdmin = adminMutationProcedure
  .input(ApprovalIdInputSchema)
  .route({
    summary: 'Deny a tournament submission (admin)',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/submissions/{id}:deny',
  })
  .handler(({ input, context }) =>
    denyTournamentSubmissionHandler({ input, context })
  );

export const listMyTournamentSubmissions = protectedProcedure
  .output(MyTournamentSubmissionListSchema)
  .route({
    summary: "List the current user's tournament submissions",
    tags: ['authenticated'],
    method: 'GET',
    path: '/tournaments/submissions/me',
  })
  .handler(async ({ context }) => {
    const userId = context.session.dbUser?.id;

    if (!userId) {
      return { submissions: [] };
    }

    const rows = await context.db
      .select()
      .from(schema.tournamentSubmissions)
      .where(eq(schema.tournamentSubmissions.submittedByUserId, userId))
      .orderBy(
        desc(schema.tournamentSubmissions.created),
        desc(schema.tournamentSubmissions.id)
      );

    return { submissions: rows.map(toSummary) };
  });
