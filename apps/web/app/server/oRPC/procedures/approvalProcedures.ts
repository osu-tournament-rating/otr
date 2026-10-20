import { count, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApprovalStatus } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';

import { protectedProcedure } from './base';
import { ensureAdminSession } from './shared/adminGuard';

const PendingApprovalCountSchema = z.object({
  submissions: z.number().int().nonnegative(),
  filterRequests: z.number().int().nonnegative(),
});

/** How many tournament submissions and filter requests wait for an admin. */
export const getPendingApprovalCount = protectedProcedure
  .output(PendingApprovalCountSchema)
  .route({
    summary:
      'Count submissions and filter requests waiting for approval (admin)',
    tags: ['admin'],
    method: 'GET',
    path: '/approvals/pending-count',
  })
  .handler(async ({ context }) => {
    ensureAdminSession(context.session);

    const [[submissions], [filterRequests]] = await Promise.all([
      context.db
        .select({ value: count() })
        .from(schema.tournamentSubmissions)
        .where(eq(schema.tournamentSubmissions.status, ApprovalStatus.Pending)),
      context.db
        .select({ value: count() })
        .from(schema.filterRequests)
        .where(eq(schema.filterRequests.status, ApprovalStatus.Pending)),
    ]);

    return {
      submissions: submissions?.value ?? 0,
      filterRequests: filterRequests?.value ?? 0,
    };
  });
