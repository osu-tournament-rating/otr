import { z } from 'zod';

import { ApprovalStatusSchema, ApprovalUserSchema } from './approval';
import { RulesetSchema } from './constants';

/** The most players a user's filter request can check. */
export const MAX_FILTER_PLAYER_IDS = 1000;

/**
 * The most players any filter request can check, which admins may use. It
 * keeps one report's rows under Postgres's limit on statement parameters.
 */
export const MAX_ADMIN_FILTER_PLAYER_IDS = 5000;

/** The most players `isAdmin`'s filter request can check. */
export const maxFilterPlayerIds = (isAdmin: boolean) =>
  isAdmin ? MAX_ADMIN_FILTER_PLAYER_IDS : MAX_FILTER_PLAYER_IDS;

/** Filter reports a user may create in any 24 hours; admins have no limit. */
export const FILTER_REPORTS_PER_DAY = 2;

/** A request with more than this share of players o!TR has never seen waits for an admin. */
export const FLAGGED_UNKNOWN_PERCENT = 30;

/** The longest justification a held request accepts. */
export const MAX_JUSTIFICATION_LENGTH = 1000;

/** Whether `unknown` of `total` players is more than {@link FLAGGED_UNKNOWN_PERCENT}. */
export const isFlaggedFilterRequest = (unknown: number, total: number) =>
  unknown * 100 > total * FLAGGED_UNKNOWN_PERCENT;

const osuPlayerIdsSchema = z.array(z.number().int().positive());

export const FilteringRequestSchema = z.object({
  ruleset: RulesetSchema,
  minRating: z.number().int().optional().nullable(),
  maxRating: z.number().int().optional().nullable(),
  // Users are held to MAX_FILTER_PLAYER_IDS by the filter itself
  osuPlayerIds: osuPlayerIdsSchema.min(1).max(MAX_ADMIN_FILTER_PLAYER_IDS),
  /** Why an admin should run a request held for its unknown players. */
  justification: z
    .string()
    .trim()
    .min(1)
    .max(MAX_JUSTIFICATION_LENGTH)
    .optional(),
});

export type FilteringRequest = z.infer<typeof FilteringRequestSchema>;

export const PlayerFilteringResultSchema = z.object({
  playerId: z.number().int().nullable(),
  osuId: z.number().int().nullable(),
  username: z.string().nullable(),
  isSuccess: z.boolean(),
  failureReason: z.number().int().nullable(),
  currentRating: z.number().nullable(),
  peakRating: z.number().nullable(),
  tournamentsPlayed: z.number().int().nullable(),
  matchesPlayed: z.number().int().nullable(),
});

export type PlayerFilteringResult = z.infer<typeof PlayerFilteringResultSchema>;

export const FilteringResultSchema = z.object({
  filterReportId: z.number().int().nonnegative(),
  /** Server-side creation timestamp of the stored filter report. */
  created: z.string(),
  playersPassed: z.number().int().nonnegative(),
  playersFailed: z.number().int().nonnegative(),
  filteringResults: z.array(PlayerFilteringResultSchema),
});

export type FilteringResult = z.infer<typeof FilteringResultSchema>;

/**
 * The criteria a stored report was run with. Reports made before the filter
 * offered only rating bounds may also carry the peak rating, tournament and
 * match criteria they were run with; the filter no longer applies those.
 */
export const StoredFilteringRequestSchema = z.object({
  ruleset: RulesetSchema,
  minRating: z.number().int().optional().nullable(),
  maxRating: z.number().int().optional().nullable(),
  peakRating: z.number().int().optional().nullable(),
  tournamentsPlayed: z.number().int().optional().nullable(),
  maxTournamentsPlayed: z.number().int().optional().nullable(),
  matchesPlayed: z.number().int().optional().nullable(),
  maxMatchesPlayed: z.number().int().optional().nullable(),
  osuPlayerIds: osuPlayerIdsSchema,
});

export type StoredFilteringRequest = z.infer<
  typeof StoredFilteringRequestSchema
>;

export const FilterReportSchema = z.object({
  id: z.number().int().positive(),
  created: z.string(),
  request: StoredFilteringRequestSchema,
  response: FilteringResultSchema,
});

export type FilterReport = z.infer<typeof FilterReportSchema>;

/** A filter request held for an admin, as its requester sees it. */
export const FilterRequestSchema = z.object({
  id: z.number().int().positive(),
  status: ApprovalStatusSchema,
  created: z.string(),
  ruleset: RulesetSchema,
  minRating: z.number().int().nullable(),
  maxRating: z.number().int().nullable(),
  playerCount: z.number().int().nonnegative(),
  unknownPlayerCount: z.number().int().nonnegative(),
  justification: z.string(),
  /** The report approval made; null while pending or when denied. */
  filterReportId: z.number().int().positive().nullable(),
  reviewedAt: z.string().nullable(),
});

export type FilterRequest = z.infer<typeof FilterRequestSchema>;

/** A held filter request in the admin queue: who sent it, and every ID. */
export const AdminFilterRequestSchema = FilterRequestSchema.extend({
  requester: ApprovalUserSchema.nullable(),
  reviewer: ApprovalUserSchema.nullable(),
  osuPlayerIds: osuPlayerIdsSchema,
});

export type AdminFilterRequest = z.infer<typeof AdminFilterRequestSchema>;

export const AdminFilterRequestListSchema = z.object({
  requests: z.array(AdminFilterRequestSchema),
});

/** `completed`: the report. `pending`: held for an admin. */
export const FilteringResponseSchema = z.discriminatedUnion('status', [
  FilteringResultSchema.extend({ status: z.literal('completed') }),
  z.object({ status: z.literal('pending'), request: FilterRequestSchema }),
]);

export type FilteringResponse = z.infer<typeof FilteringResponseSchema>;

/** What the signed-in user has left of their limits. */
export const FilterUsageSchema = z.object({
  /** Null for admins, who have no daily limit. */
  reportsLeft: z.number().int().nonnegative().nullable(),
  /** When the next report becomes available, while none are left. */
  nextReportAt: z.string().nullable(),
  /** Seconds until lookups of unknown players can run; 0 now. */
  lookupRetryAfterSeconds: z.number().int().nonnegative(),
});

export type FilterUsage = z.infer<typeof FilterUsageSchema>;

export const MyFilterRequestsSchema = z.object({
  requests: z.array(FilterRequestSchema),
  usage: FilterUsageSchema,
});

export const FilterRequestApprovalResponseSchema = z.object({
  filterReportId: z.number().int().positive(),
});
