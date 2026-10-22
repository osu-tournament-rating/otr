import { z } from 'zod';

import { ApprovalStatus } from '@otr/core/osu';

/** Where a held tournament submission or filter request stands. */
export const ApprovalStatusSchema = z
  .enum(ApprovalStatus)
  .describe('ApprovalStatus: 0=Pending, 1=Approved, 2=Denied');

/** A requester or reviewer; null in a response once they deleted their account. */
export const ApprovalUserSchema = z.object({
  id: z.number().int().positive(),
  player: z.object({
    id: z.number().int().positive(),
    osuId: z.number().int().positive(),
    username: z.string(),
    country: z.string(),
  }),
});

export type ApprovalUser = z.infer<typeof ApprovalUserSchema>;

export const ApprovalIdInputSchema = z.object({
  id: z.number().int().positive(),
});
