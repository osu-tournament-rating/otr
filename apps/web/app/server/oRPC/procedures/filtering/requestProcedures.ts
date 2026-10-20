import { ORPCError } from '@orpc/server';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { ApprovalStatus, type Ruleset } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';
import { hasAdminScope } from '@/lib/auth/roles';
import type { DatabaseClient } from '@/lib/db';
import { ApprovalIdInputSchema } from '@/lib/orpc/schema/approval';
import {
  AdminFilterRequestListSchema,
  FILTER_REPORTS_PER_DAY,
  FilterRequestApprovalResponseSchema,
  MyFilterRequestsSchema,
  type AdminFilterRequest,
} from '@/lib/orpc/schema/filtering';

import { adminMutationProcedure, protectedProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import {
  apiAllowanceRetryAfter,
  chargeApiAllowance,
} from '../shared/apiAllowance';
import { loadApprovalUsers } from '../shared/approvalUsers';
import { assertOutsideMaintenanceWindow } from '../shared/maintenanceWindow';
import { getCorrelationId } from '../logging/helpers';
import { lockUser, readDailyFilterUsage, toFilterRequest } from './limits';
import {
  countUnknownPlayers,
  runFilter,
  type TransactionClient,
} from './runFilter';

interface SessionContext {
  db: DatabaseClient;
  headers: Headers;
  session: {
    dbUser?: { id: number; scopes?: string[] | null } | null;
  } | null;
  logging?: unknown;
}

/** Locks a held request for review, refusing one already decided. */
async function lockPendingRequest(tx: TransactionClient, id: number) {
  const [request] = await tx
    .select()
    .from(schema.filterRequests)
    .where(eq(schema.filterRequests.id, id))
    .for('update');

  if (!request) {
    throw new ORPCError('NOT_FOUND', {
      message: `Filter request ${id} was not found`,
    });
  }

  if (request.status !== ApprovalStatus.Pending) {
    throw new ORPCError('CONFLICT', {
      message: `Filter request ${id} was already ${
        request.status === ApprovalStatus.Approved ? 'approved' : 'denied'
      }`,
    });
  }

  return request;
}

export async function listFilterRequestsAdminHandler({
  context,
}: {
  context: Pick<SessionContext, 'db' | 'session'>;
}) {
  ensureAdminSession(context.session);

  // The queue: every held request, oldest first
  const rows = await context.db
    .select()
    .from(schema.filterRequests)
    .where(eq(schema.filterRequests.status, ApprovalStatus.Pending))
    .orderBy(asc(schema.filterRequests.created), asc(schema.filterRequests.id));

  const users = await loadApprovalUsers(
    context.db,
    rows.flatMap((row) => [row.userId, row.reviewedByUserId])
  );

  return {
    requests: rows.map((row): AdminFilterRequest => ({
      ...toFilterRequest(row),
      requester: row.userId === null ? null : (users.get(row.userId) ?? null),
      reviewer:
        row.reviewedByUserId === null
          ? null
          : (users.get(row.reviewedByUserId) ?? null),
      osuPlayerIds: row.osuPlayerIds.map(Number),
    })),
  };
}

/**
 * Runs a held filter request for its requester, in the same transaction that
 * marks it approved. The players it looks up are charged to the requester's
 * API allowance, as if they had run it themselves.
 */
export async function approveFilterRequestHandler({
  input,
  context,
}: {
  input: { id: number };
  context: SessionContext;
}) {
  const { adminUserId } = ensureAdminSession(context.session);

  await assertOutsideMaintenanceWindow(context.headers, { db: context.db });

  const correlationId = getCorrelationId(context);

  return context.db.transaction(async (tx) => {
    const request = await lockPendingRequest(tx, input.id);
    const osuIds = request.osuPlayerIds.map(Number);

    if (request.userId !== null) {
      await lockUser(tx, request.userId);
      await chargeApiAllowance(
        tx,
        request.userId,
        await countUnknownPlayers(tx, osuIds)
      );
    }

    const result = await runFilter(tx, {
      userId: request.userId,
      requestedByUserId: request.userId ?? adminUserId,
      ruleset: request.ruleset as Ruleset,
      minRating: request.minRating,
      maxRating: request.maxRating,
      osuIds,
      correlationId,
      headers: context.headers,
    });

    await tx
      .update(schema.filterRequests)
      .set({
        status: ApprovalStatus.Approved,
        filterReportId: result.filterReportId,
        reviewedByUserId: adminUserId,
        reviewedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.filterRequests.id, request.id));

    return { filterReportId: result.filterReportId };
  });
}

export async function denyFilterRequestHandler({
  input,
  context,
}: {
  input: { id: number };
  context: Pick<SessionContext, 'db' | 'session'>;
}) {
  const { adminUserId } = ensureAdminSession(context.session);

  await context.db.transaction(async (tx) => {
    const request = await lockPendingRequest(tx, input.id);

    await tx
      .update(schema.filterRequests)
      .set({
        status: ApprovalStatus.Denied,
        reviewedByUserId: adminUserId,
        reviewedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.filterRequests.id, request.id));
  });

  return { success: true as const };
}

/** The user's held requests, newest first, and what is left of their limits. */
export async function listMyFilterRequestsHandler({
  context,
}: {
  context: Pick<SessionContext, 'db' | 'session'>;
}) {
  const userId = context.session?.dbUser?.id;

  if (!userId) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'User account is not linked to an internal profile',
    });
  }

  const isAdmin = hasAdminScope(context.session?.dbUser?.scopes);

  const [rows, daily, lookupRetryAfterSeconds] = await Promise.all([
    context.db
      .select()
      .from(schema.filterRequests)
      .where(eq(schema.filterRequests.userId, userId))
      .orderBy(
        desc(schema.filterRequests.created),
        desc(schema.filterRequests.id)
      ),
    isAdmin ? null : readDailyFilterUsage(context.db, userId),
    apiAllowanceRetryAfter(context.db, userId),
  ]);

  return {
    requests: rows.map(toFilterRequest),
    usage: {
      reportsLeft: daily
        ? Math.max(0, FILTER_REPORTS_PER_DAY - daily.used)
        : null,
      nextReportAt: daily?.nextReportAt ?? null,
      lookupRetryAfterSeconds,
    },
  };
}

export const listFilterRequestsAdmin = protectedProcedure
  .output(AdminFilterRequestListSchema)
  .route({
    summary: 'List filter requests waiting for approval (admin)',
    tags: ['admin'],
    method: 'GET',
    path: '/filtering/requests',
  })
  .handler(({ context }) => listFilterRequestsAdminHandler({ context }));

export const approveFilterRequestAdmin = adminMutationProcedure
  .input(ApprovalIdInputSchema)
  .output(FilterRequestApprovalResponseSchema)
  .route({
    summary: 'Approve a filter request (admin)',
    tags: ['admin'],
    method: 'POST',
    path: '/filtering/requests/{id}:approve',
  })
  .handler(({ input, context }) =>
    approveFilterRequestHandler({ input, context })
  );

export const denyFilterRequestAdmin = adminMutationProcedure
  .input(ApprovalIdInputSchema)
  .route({
    summary: 'Deny a filter request (admin)',
    tags: ['admin'],
    method: 'POST',
    path: '/filtering/requests/{id}:deny',
  })
  .handler(({ input, context }) =>
    denyFilterRequestHandler({ input, context })
  );

export const listMyFilterRequests = protectedProcedure
  .output(MyFilterRequestsSchema)
  .route({
    summary: "List the current user's held filter requests and limits",
    tags: ['authenticated'],
    method: 'GET',
    path: '/filtering/requests/me',
  })
  .handler(({ context }) => listMyFilterRequestsHandler({ context }));
