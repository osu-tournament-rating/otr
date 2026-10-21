import { z } from 'zod';

import { ReportEntityType, ReportStatus } from '@otr/core/osu/enums';

import { dataReportSelectSchema } from './base';

export const ReportReasonSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
});

/** The most text one report stores, as the report form allows. */
const MAX_REPORT_DETAILS_LENGTH = 2000;

/** Characters the legacy shape stores: changed fields' names and values, and the justification. */
const legacyDetailsLength = (input: {
  suggestedChanges?: Record<string, string>;
  justification?: string;
}) =>
  Object.entries(input.suggestedChanges ?? {}).reduce(
    (length, [field, value]) => length + field.length + value.length,
    input.justification?.length ?? 0
  );

export const ReportCreateInputSchema = z
  .object({
    entityType: z.nativeEnum(ReportEntityType),
    entityId: z.number().int().positive(),
    reasonKey: z.string().trim().min(1).optional(),
    additionalInformation: z
      .string()
      .trim()
      .max(MAX_REPORT_DETAILS_LENGTH)
      .optional(),
    suggestedChanges: z.record(z.string(), z.string()).optional(),
    justification: z.string().min(1).optional(),
  })
  .superRefine((input, context) => {
    const isLegacyInput =
      input.suggestedChanges !== undefined && input.justification !== undefined;

    if (!input.reasonKey && !isLegacyInput) {
      context.addIssue({
        code: 'custom',
        message: 'Reason is required',
        path: ['reasonKey'],
      });
    }

    if (legacyDetailsLength(input) > MAX_REPORT_DETAILS_LENGTH) {
      context.addIssue({
        code: 'custom',
        message: 'Report details cannot exceed 2,000 characters',
        path: ['justification'],
      });
    }
  });

export const ReportTemplatesInputSchema = z.object({
  entityType: z.nativeEnum(ReportEntityType),
});

export const ReportTemplatesResponseSchema = z.object({
  entityType: z.nativeEnum(ReportEntityType),
  templates: z.array(ReportReasonSchema),
});

/** `created` is when the report came in; `resolvedAt` when an admin closed it. */
export const ReportListSortSchema = z.enum(['created', 'resolvedAt']);

export const ReportListInputSchema = z.object({
  status: z.nativeEnum(ReportStatus).optional(),
  entityType: z.nativeEnum(ReportEntityType).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  /** Defaults to `created`. Open reports have no `resolvedAt` and sort last. */
  sort: ReportListSortSchema.optional(),
  /** Defaults to true: newest first. */
  descending: z.boolean().optional(),
});

export const ReportResolveInputSchema = z.object({
  reportId: z.number().int().positive(),
  status: z.union([
    z.literal(ReportStatus.Approved),
    z.literal(ReportStatus.Rejected),
  ]),
  adminNote: z.string().trim().min(1, 'Comment is required').max(500),
});

export const ReportGetInputSchema = z.object({
  reportId: z.number().int().positive(),
});

export const ReportReopenInputSchema = z.object({
  reportId: z.number().int().positive(),
});

const reportPlayerSchema = z.object({
  id: z.number().int().positive(),
  osuId: z.number().int().positive(),
  username: z.string(),
  country: z.string(),
});

const reportUserSchema = z.object({
  id: z.number().int().positive(),
  player: reportPlayerSchema,
});

const reportBaseSchema = dataReportSelectSchema.pick({
  id: true,
  entityType: true,
  entityId: true,
  suggestedChanges: true,
  justification: true,
  status: true,
  adminNote: true,
  created: true,
  resolvedAt: true,
});

export const ReportSchema = reportBaseSchema.extend({
  reason: ReportReasonSchema,
  additionalInformation: z.string().nullable(),
  reporter: reportUserSchema.nullable(),
  resolvedBy: reportUserSchema.nullable(),
  entityDisplayName: z.string(),
  matchId: z.number().int().positive().optional(),
});

export const ReportListResponseSchema = z.object({
  reports: z.array(ReportSchema),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

/** A reporter's own view: no reporter or resolver identity, plus an unread flag. */
export const MyReportSchema = reportBaseSchema.extend({
  reason: ReportReasonSchema,
  additionalInformation: z.string().nullable(),
  entityDisplayName: z.string(),
  matchId: z.number().int().positive().optional(),
  hasUnreadUpdate: z.boolean(),
});

export const MyReportListResponseSchema = z.object({
  reports: z.array(MyReportSchema),
});

export const MarkReportViewedInputSchema = z.object({
  reportId: z.number().int().positive(),
});

export const MyUnreadReportCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export const ReportMutationResponseSchema = z.object({
  success: z.boolean(),
  reportId: z.number().int().positive().optional(),
});

export type ReportCreateInput = z.infer<typeof ReportCreateInputSchema>;
export type ReportReason = z.infer<typeof ReportReasonSchema>;
export type ReportTemplatesInput = z.infer<typeof ReportTemplatesInputSchema>;
export type ReportTemplatesResponse = z.infer<
  typeof ReportTemplatesResponseSchema
>;
export type ReportListInput = z.infer<typeof ReportListInputSchema>;
export type ReportListSort = z.infer<typeof ReportListSortSchema>;
export type ReportResolveInput = z.infer<typeof ReportResolveInputSchema>;
export type ReportGetInput = z.infer<typeof ReportGetInputSchema>;
export type ReportReopenInput = z.infer<typeof ReportReopenInputSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;
export type ReportMutationResponse = z.infer<
  typeof ReportMutationResponseSchema
>;

export const UnseenReportCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export type UnseenReportCountResponse = z.infer<
  typeof UnseenReportCountResponseSchema
>;

export type MyReport = z.infer<typeof MyReportSchema>;
export type MyReportListResponse = z.infer<typeof MyReportListResponseSchema>;
export type MarkReportViewedInput = z.infer<typeof MarkReportViewedInputSchema>;
export type MyUnreadReportCountResponse = z.infer<
  typeof MyUnreadReportCountResponseSchema
>;
