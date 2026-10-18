import { ORPCError } from '@orpc/server';
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { ReportEntityType, ReportStatus } from '@otr/core/osu/enums';

import type { DatabaseClient } from '@/lib/db';
import {
  MarkReportViewedInputSchema,
  MyReportListResponseSchema,
  MyUnreadReportCountResponseSchema,
  ReportCreateInputSchema,
  ReportGetInputSchema,
  ReportListInputSchema,
  ReportListResponseSchema,
  ReportMutationResponseSchema,
  ReportReopenInputSchema,
  ReportResolveInputSchema,
  ReportSchema,
  ReportTemplatesInputSchema,
  ReportTemplatesResponseSchema,
  UnseenReportCountResponseSchema,
  type ReportCreateInput,
} from '@/lib/orpc/schema/report';

import {
  adminMutationProcedure,
  protectedMutationProcedure,
  protectedProcedure,
} from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import {
  normalizeReportCreateContent,
  normalizeStoredReportContent,
} from './reportContent';
import { buildReportListOrder } from './reportListOrder';
import { hasUnreadAdminUpdate } from './reportReadStatus';
import { getReportReasons, isReportReasonKeyValid } from './reportTemplates';

const NOW = sql`CURRENT_TIMESTAMP`;

async function getMatchIdForEntity(
  db: DatabaseClient,
  entityType: ReportEntityType,
  entityId: number
): Promise<number | undefined> {
  switch (entityType) {
    case ReportEntityType.Game: {
      const game = await db.query.games.findFirst({
        columns: { matchId: true },
        where: eq(schema.games.id, entityId),
      });
      return game?.matchId;
    }
    case ReportEntityType.Score: {
      const score = await db.query.gameScores.findFirst({
        columns: { gameId: true },
        where: eq(schema.gameScores.id, entityId),
        with: {
          game: {
            columns: { matchId: true },
          },
        },
      });
      return score?.game?.matchId;
    }
    default:
      return undefined;
  }
}

async function getEntityDisplayName(
  db: DatabaseClient,
  entityType: ReportEntityType,
  entityId: number
): Promise<string> {
  switch (entityType) {
    case ReportEntityType.Tournament: {
      const tournament = await db.query.tournaments.findFirst({
        columns: { name: true },
        where: eq(schema.tournaments.id, entityId),
      });
      return tournament?.name ?? `Tournament #${entityId}`;
    }
    case ReportEntityType.Match: {
      const match = await db.query.matches.findFirst({
        columns: { name: true },
        where: eq(schema.matches.id, entityId),
      });
      return match?.name ?? `Match #${entityId}`;
    }
    case ReportEntityType.Game: {
      const game = await db.query.games.findFirst({
        columns: { id: true },
        where: eq(schema.games.id, entityId),
        with: {
          beatmap: {
            columns: { diffName: true },
            with: {
              beatmapset: {
                columns: { title: true },
              },
            },
          },
        },
      });
      if (game?.beatmap) {
        return `${game.beatmap.beatmapset?.title ?? 'Unknown'} [${game.beatmap.diffName}]`;
      }
      return `Game #${entityId}`;
    }
    case ReportEntityType.Score: {
      const score = await db.query.gameScores.findFirst({
        columns: { id: true },
        where: eq(schema.gameScores.id, entityId),
        with: {
          player: {
            columns: { username: true },
          },
        },
      });
      return score?.player?.username
        ? `${score.player.username}'s score`
        : `Score #${entityId}`;
    }
    default:
      return `Entity #${entityId}`;
  }
}

async function verifyEntityExists(
  db: DatabaseClient,
  entityType: ReportEntityType,
  entityId: number
): Promise<boolean> {
  switch (entityType) {
    case ReportEntityType.Tournament: {
      const result = await db.query.tournaments.findFirst({
        columns: { id: true },
        where: eq(schema.tournaments.id, entityId),
      });
      return !!result;
    }
    case ReportEntityType.Match: {
      const result = await db.query.matches.findFirst({
        columns: { id: true },
        where: eq(schema.matches.id, entityId),
      });
      return !!result;
    }
    case ReportEntityType.Game: {
      const result = await db.query.games.findFirst({
        columns: { id: true },
        where: eq(schema.games.id, entityId),
      });
      return !!result;
    }
    case ReportEntityType.Score: {
      const result = await db.query.gameScores.findFirst({
        columns: { id: true },
        where: eq(schema.gameScores.id, entityId),
      });
      return !!result;
    }
    default:
      return false;
  }
}

export const getReportTemplates = protectedProcedure
  .input(ReportTemplatesInputSchema)
  .output(ReportTemplatesResponseSchema)
  .route({
    summary: 'List data report reasons',
    tags: ['reports'],
    method: 'GET',
    path: '/reports/templates',
  })
  .handler(async ({ input }) => ({
    entityType: input.entityType,
    templates: [...getReportReasons(input.entityType)],
  }));

interface CreateReportContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
    } | null;
  } | null;
}

export interface CreateReportHandlerArgs {
  input: ReportCreateInput;
  context: CreateReportContext;
}

export async function createReportHandler({
  input,
  context,
}: CreateReportHandlerArgs) {
  const userId = context.session?.dbUser?.id;
  if (!userId) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'User not authenticated',
    });
  }

  const reportContent = normalizeReportCreateContent(input);

  if (!isReportReasonKeyValid(input.entityType, reportContent.reasonKey)) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Invalid reason for this report type',
    });
  }

  const entityExists = await verifyEntityExists(
    context.db,
    input.entityType,
    input.entityId
  );

  if (!entityExists) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Entity not found',
    });
  }

  const [created] = await context.db
    .insert(schema.dataReports)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      reasonKey: reportContent.reasonKey,
      suggestedChanges: reportContent.suggestedChanges,
      justification: reportContent.justification,
      status: ReportStatus.Pending,
      reporterUserId: userId,
    })
    .returning({ id: schema.dataReports.id });

  return { success: true, reportId: created.id };
}

export const createReport = protectedMutationProcedure
  .input(ReportCreateInputSchema)
  .output(ReportMutationResponseSchema)
  .route({
    summary: 'Create a data report',
    tags: ['reports'],
    method: 'POST',
    path: '/reports',
  })
  .handler(createReportHandler);

export const listReports = protectedProcedure
  .input(ReportListInputSchema)
  .output(ReportListResponseSchema)
  .route({
    summary: 'List data reports (admin)',
    tags: ['reports', 'admin'],
    method: 'GET',
    path: '/reports',
  })
  .handler(async ({ input, context }) => {
    ensureAdminSession(context.session);

    const conditions = [];
    if (input.status !== undefined) {
      conditions.push(eq(schema.dataReports.status, input.status));
    }
    if (input.entityType !== undefined) {
      conditions.push(eq(schema.dataReports.entityType, input.entityType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [reports, countResult] = await Promise.all([
      context.db.query.dataReports.findMany({
        where: whereClause,
        orderBy: (reports) =>
          buildReportListOrder(reports, input.sort, input.descending),
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
        with: {
          reporter: {
            columns: { id: true },
            with: {
              player: {
                columns: {
                  id: true,
                  osuId: true,
                  username: true,
                  country: true,
                },
              },
            },
          },
          resolvedBy: {
            columns: { id: true },
            with: {
              player: {
                columns: {
                  id: true,
                  osuId: true,
                  username: true,
                  country: true,
                },
              },
            },
          },
        },
      }),
      context.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.dataReports)
        .where(whereClause),
    ]);

    const mappedReports = await Promise.all(
      reports.map(async (report) => ({
        id: report.id,
        entityType: report.entityType,
        entityId: report.entityId,
        suggestedChanges: report.suggestedChanges as Record<string, string>,
        justification: report.justification,
        ...normalizeStoredReportContent(report),
        status: report.status,
        adminNote: report.adminNote,
        created: report.created,
        resolvedAt: report.resolvedAt,
        entityDisplayName: await getEntityDisplayName(
          context.db,
          report.entityType,
          report.entityId
        ),
        matchId: await getMatchIdForEntity(
          context.db,
          report.entityType,
          report.entityId
        ),
        reporter: report.reporter
          ? {
              id: report.reporter.id,
              player: report.reporter.player,
            }
          : null,
        resolvedBy: report.resolvedBy
          ? {
              id: report.resolvedBy.id,
              player: report.resolvedBy.player,
            }
          : null,
      }))
    );

    const totalCount = countResult[0]?.count ?? 0;

    return {
      reports: mappedReports,
      totalCount,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(totalCount / input.pageSize),
    };
  });

export const getReport = protectedProcedure
  .input(ReportGetInputSchema)
  .output(ReportSchema)
  .route({
    summary: 'Get a single data report (admin)',
    tags: ['reports', 'admin'],
    method: 'GET',
    path: '/reports/{reportId}',
  })
  .handler(async ({ input, context }) => {
    ensureAdminSession(context.session);

    const report = await context.db.query.dataReports.findFirst({
      where: eq(schema.dataReports.id, input.reportId),
      with: {
        reporter: {
          columns: { id: true },
          with: {
            player: {
              columns: {
                id: true,
                osuId: true,
                username: true,
                country: true,
              },
            },
          },
        },
        resolvedBy: {
          columns: { id: true },
          with: {
            player: {
              columns: {
                id: true,
                osuId: true,
                username: true,
                country: true,
              },
            },
          },
        },
      },
    });

    if (!report) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Report not found',
      });
    }

    return {
      id: report.id,
      entityType: report.entityType,
      entityId: report.entityId,
      suggestedChanges: report.suggestedChanges as Record<string, string>,
      justification: report.justification,
      ...normalizeStoredReportContent(report),
      status: report.status,
      adminNote: report.adminNote,
      created: report.created,
      resolvedAt: report.resolvedAt,
      entityDisplayName: await getEntityDisplayName(
        context.db,
        report.entityType,
        report.entityId
      ),
      matchId: await getMatchIdForEntity(
        context.db,
        report.entityType,
        report.entityId
      ),
      reporter: report.reporter
        ? {
            id: report.reporter.id,
            player: report.reporter.player,
          }
        : null,
      resolvedBy: report.resolvedBy
        ? {
            id: report.resolvedBy.id,
            player: report.resolvedBy.player,
          }
        : null,
    };
  });

export const resolveReport = adminMutationProcedure
  .input(ReportResolveInputSchema)
  .output(ReportMutationResponseSchema)
  .route({
    summary: 'Resolve a data report (admin)',
    tags: ['reports', 'admin'],
    method: 'PATCH',
    path: '/reports/{reportId}/resolve',
  })
  .handler(async ({ input, context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    const report = await context.db.query.dataReports.findFirst({
      where: eq(schema.dataReports.id, input.reportId),
    });

    if (!report) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Report not found',
      });
    }

    if (report.status !== ReportStatus.Pending) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Report has already been resolved',
      });
    }

    await context.db
      .update(schema.dataReports)
      .set({
        status: input.status,
        adminNote: input.adminNote ?? null,
        resolvedByUserId: adminUserId,
        resolvedAt: NOW,
      })
      .where(eq(schema.dataReports.id, input.reportId));

    return { success: true, reportId: input.reportId };
  });

export const reopenReport = adminMutationProcedure
  .input(ReportReopenInputSchema)
  .output(ReportMutationResponseSchema)
  .route({
    summary: 'Reopen a resolved report (admin)',
    tags: ['reports', 'admin'],
    method: 'PATCH',
    path: '/reports/{reportId}/reopen',
  })
  .handler(async ({ input, context }) => {
    ensureAdminSession(context.session);

    const report = await context.db.query.dataReports.findFirst({
      where: eq(schema.dataReports.id, input.reportId),
    });

    if (!report) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Report not found',
      });
    }

    if (report.status === ReportStatus.Pending) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Report is already pending',
      });
    }

    await context.db
      .update(schema.dataReports)
      .set({
        status: ReportStatus.Pending,
        resolvedByUserId: null,
        resolvedAt: null,
      })
      .where(eq(schema.dataReports.id, input.reportId));

    return { success: true, reportId: input.reportId };
  });

export const getUnseenReportCount = protectedProcedure
  .output(UnseenReportCountResponseSchema)
  .route({
    summary: 'Get count of unseen pending reports (admin)',
    tags: ['reports', 'admin'],
    method: 'GET',
    path: '/reports/unseen-count',
  })
  .handler(async ({ context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    const user = await context.db.query.users.findFirst({
      columns: { lastViewedReportsAt: true },
      where: eq(schema.users.id, adminUserId),
    });

    const conditions = [eq(schema.dataReports.status, ReportStatus.Pending)];
    if (user?.lastViewedReportsAt) {
      conditions.push(gt(schema.dataReports.created, user.lastViewedReportsAt));
    }

    const [result] = await context.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.dataReports)
      .where(and(...conditions));

    return { count: result?.count ?? 0 };
  });

export const markReportsViewed = protectedProcedure
  .output(ReportMutationResponseSchema)
  .route({
    summary: 'Mark reports as viewed (admin)',
    tags: ['reports', 'admin'],
    method: 'POST',
    path: '/reports/mark-viewed',
  })
  .handler(async ({ context }) => {
    const { adminUserId } = ensureAdminSession(context.session);

    await context.db
      .update(schema.users)
      .set({ lastViewedReportsAt: NOW })
      .where(eq(schema.users.id, adminUserId));

    return { success: true };
  });

const unreadUpdateCondition = (userId: number) =>
  and(
    eq(schema.dataReports.reporterUserId, userId),
    isNotNull(schema.dataReports.resolvedAt),
    or(
      isNull(schema.dataReports.reporterViewedAt),
      gt(schema.dataReports.resolvedAt, schema.dataReports.reporterViewedAt)
    )
  );

export const listMyReports = protectedProcedure
  .output(MyReportListResponseSchema)
  .route({
    summary: "List the current user's own reports",
    tags: ['reports'],
    method: 'GET',
    path: '/reports/me',
  })
  .handler(async ({ context }) => {
    const userId = context.session?.dbUser?.id;
    if (!userId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'User not authenticated',
      });
    }

    const reports = await context.db.query.dataReports.findMany({
      where: eq(schema.dataReports.reporterUserId, userId),
      orderBy: desc(schema.dataReports.created),
    });

    const mappedReports = await Promise.all(
      reports.map(async (report) => ({
        id: report.id,
        entityType: report.entityType,
        entityId: report.entityId,
        suggestedChanges: report.suggestedChanges as Record<string, string>,
        justification: report.justification,
        ...normalizeStoredReportContent(report),
        status: report.status,
        adminNote: report.adminNote,
        created: report.created,
        resolvedAt: report.resolvedAt,
        entityDisplayName: await getEntityDisplayName(
          context.db,
          report.entityType,
          report.entityId
        ),
        matchId: await getMatchIdForEntity(
          context.db,
          report.entityType,
          report.entityId
        ),
        hasUnreadUpdate: hasUnreadAdminUpdate(report),
      }))
    );

    return { reports: mappedReports };
  });

export const markMyReportViewed = protectedProcedure
  .input(MarkReportViewedInputSchema)
  .output(ReportMutationResponseSchema)
  .route({
    summary: "Mark one of the current user's reports as viewed",
    tags: ['reports'],
    method: 'POST',
    path: '/reports/{reportId}/mark-viewed',
  })
  .handler(async ({ input, context }) => {
    const userId = context.session?.dbUser?.id;
    if (!userId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'User not authenticated',
      });
    }

    const updated = await context.db
      .update(schema.dataReports)
      .set({ reporterViewedAt: NOW })
      .where(
        and(
          eq(schema.dataReports.id, input.reportId),
          eq(schema.dataReports.reporterUserId, userId)
        )
      )
      .returning({ id: schema.dataReports.id });

    if (updated.length === 0) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Report not found',
      });
    }

    return { success: true, reportId: input.reportId };
  });

export const getMyUnreadReportCount = protectedProcedure
  .output(MyUnreadReportCountResponseSchema)
  .route({
    summary: "Count the current user's reports with unread admin updates",
    tags: ['reports'],
    method: 'GET',
    path: '/reports/me/unread-count',
  })
  .handler(async ({ context }) => {
    const userId = context.session?.dbUser?.id;
    if (!userId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'User not authenticated',
      });
    }

    const [result] = await context.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.dataReports)
      .where(unreadUpdateCondition(userId));

    return { count: result?.count ?? 0 };
  });
