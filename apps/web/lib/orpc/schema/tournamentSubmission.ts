import { z } from 'zod';

import { Ruleset, TournamentRejectionReason } from '@otr/core/osu';
import { ApprovalStatusSchema, ApprovalUserSchema } from './approval';
import {
  FORUM_POST_URL_REQUIRED_MESSAGE,
  FORUM_POST_URL_SOURCE_MESSAGE,
  LOBBY_SIZE_MAXIMUM_MESSAGE,
  LOBBY_SIZE_MINIMUM_MESSAGE,
  LOBBY_SIZE_REQUIRED_MESSAGE,
  RANK_RESTRICTION_MINIMUM_MESSAGE,
  RANK_RESTRICTION_REQUIRED_MESSAGE,
  RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE,
  RULESET_REQUIRED_MESSAGE,
  TOURNAMENT_ABBREVIATION_REQUIRED_MESSAGE,
  TOURNAMENT_NAME_REQUIRED_MESSAGE,
  maxBeatmapIdsMessage,
  maxMatchIdsMessage,
} from './tournamentMessages';

const getEnumNumericValues = (enumObject: Record<string, unknown>): number[] =>
  Object.values(enumObject).filter(
    (value): value is number => typeof value === 'number'
  );

const createBitwiseEnumSchema = (enumObject: Record<string, unknown>) => {
  const flags = getEnumNumericValues(enumObject);
  const allFlags = flags.reduce((acc, flag) => acc | flag, 0);

  return z
    .number()
    .int()
    .nonnegative()
    .refine((value) => (value & ~allFlags) === 0, {
      message: 'Invalid flag combination',
    });
};

/** A missing value reads "… is required" instead of zod's default message. */
const requiredMessage =
  (message: string) =>
  (issue: { input?: unknown }): string | undefined =>
    issue.input === undefined ? message : undefined;

const hasUniqueValues = (values: readonly number[]) =>
  new Set(values).size === values.length;

const FORUM_URL_PATTERN =
  /^(https:\/\/osu\.ppy\.sh\/(community\/forums\/topics\/\d+|wiki\/en\/Tournaments\/[^?#]*))(\?.*)?$/;

// An empty field reports only that it is required, not also the source rule
const forumUrlSchema = z
  .string()
  .trim()
  .min(1, { error: FORUM_POST_URL_REQUIRED_MESSAGE, abort: true })
  .regex(FORUM_URL_PATTERN, FORUM_POST_URL_SOURCE_MESSAGE)
  .transform((value) => value.split('?')[0]);

export const MAX_SUBMISSION_IDS = 1000;

const matchIdSchema = z.number().int().positive();
const beatmapIdSchema = z.number().int().positive().max(20_000_000);

const MAX_MATCH_IDS_MESSAGE = maxMatchIdsMessage(MAX_SUBMISSION_IDS);
const MAX_BEATMAP_IDS_MESSAGE = maxBeatmapIdsMessage(MAX_SUBMISSION_IDS);

const baseSubmissionSchema = z.object({
  name: z.string().min(1, TOURNAMENT_NAME_REQUIRED_MESSAGE),
  abbreviation: z.string().min(1, TOURNAMENT_ABBREVIATION_REQUIRED_MESSAGE),
  forumUrl: forumUrlSchema,
  ruleset: z.enum(Ruleset, {
    error: requiredMessage(RULESET_REQUIRED_MESSAGE),
  }),
  rankRangeLowerBound: z
    .number({
      error: (issue) =>
        issue.input === undefined
          ? RANK_RESTRICTION_REQUIRED_MESSAGE
          : RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE,
    })
    .int(RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE)
    .min(1, RANK_RESTRICTION_MINIMUM_MESSAGE),
  lobbySize: z
    .number({ error: requiredMessage(LOBBY_SIZE_REQUIRED_MESSAGE) })
    .int()
    .min(1, LOBBY_SIZE_MINIMUM_MESSAGE)
    .max(8, LOBBY_SIZE_MAXIMUM_MESSAGE),
  rejectionReason: createBitwiseEnumSchema(TournamentRejectionReason).default(
    TournamentRejectionReason.None
  ),
  isLazer: z.boolean().default(false),
  ids: z
    .array(matchIdSchema)
    .min(1, 'At least one match ID is required')
    .max(MAX_SUBMISSION_IDS, MAX_MATCH_IDS_MESSAGE),
  beatmapIds: z
    .array(beatmapIdSchema)
    .max(MAX_SUBMISSION_IDS, MAX_BEATMAP_IDS_MESSAGE)
    .default([]),
});

export const TournamentSubmissionInputSchema = baseSubmissionSchema.check(
  (ctx) => {
    const {
      value: { ids, beatmapIds },
      issues,
    } = ctx;

    if (!hasUniqueValues(ids)) {
      issues.push({
        path: ['ids'],
        code: 'custom',
        message: 'Duplicate match IDs are not allowed',
        input: ids,
      });
    }

    if (!hasUniqueValues(beatmapIds)) {
      issues.push({
        path: ['beatmapIds'],
        code: 'custom',
        message: 'Duplicate beatmap IDs are not allowed',
        input: beatmapIds,
      });
    }
  }
);

export type TournamentSubmissionInput = z.infer<
  typeof TournamentSubmissionInputSchema
>;

const parseMatchIds = z.preprocess(
  (val) => {
    if (
      !val ||
      (Array.isArray(val) && val.length === 0) ||
      (typeof val === 'string' && val.trim() === '')
    ) {
      return [];
    }

    if (Array.isArray(val)) {
      return val.map((item) => {
        if (!item || (typeof item === 'string' && item.trim() === '')) {
          return 0;
        }

        const str = String(item).trim();
        const match = str.match(
          /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/(?:community\/matches|mp|multiplayer\/rooms)\/(\d+)(?:\/events)?)$/
        );
        return match ? Number(match[1] || match[2]) : 0;
      });
    }

    return [];
  },
  z
    .array(matchIdSchema)
    .min(1, 'At least one valid match link is required')
    .max(MAX_SUBMISSION_IDS, MAX_MATCH_IDS_MESSAGE)
    .refine(
      (val) => val.every((id) => id > 0),
      'All match links must be valid osu! match IDs or URLs'
    )
);

const parseBeatmapIds = z.preprocess(
  (val) => {
    if (
      !val ||
      (Array.isArray(val) && val.length === 0) ||
      (typeof val === 'string' && val.trim() === '')
    ) {
      return [];
    }

    if (Array.isArray(val)) {
      return val.map((item) => {
        if (!item || (typeof item === 'string' && item.trim() === '')) {
          return 0;
        }

        const str = String(item).trim();
        const match = str.match(
          /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/b\/(\d+)|https:\/\/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|fruits|mania|taiko)\/(\d+))$/
        );
        const numericId = match ? Number(match[1] || match[2] || match[3]) : 0;
        return numericId > 20_000_000 ? 0 : numericId;
      });
    }

    return [];
  },
  z
    .array(beatmapIdSchema)
    .max(MAX_SUBMISSION_IDS, MAX_BEATMAP_IDS_MESSAGE)
    .refine(
      (val) => val.every((id) => id > 0),
      'All beatmap links must be valid osu! beatmap IDs or URLs'
    )
);

export const tournamentSubmissionFormSchema = baseSubmissionSchema
  .extend({
    ids: parseMatchIds,
    beatmapIds: parseBeatmapIds,
  })
  .check((ctx) => {
    const ids = ctx.value.ids as number[];
    const beatmapIds = ctx.value.beatmapIds as number[];

    if (!hasUniqueValues(ids)) {
      ctx.issues.push({
        path: ['ids'],
        code: 'custom',
        message: 'Duplicate match IDs are not allowed',
        input: ids,
      });
    }

    if (!hasUniqueValues(beatmapIds)) {
      ctx.issues.push({
        path: ['beatmapIds'],
        code: 'custom',
        message: 'Duplicate beatmap IDs are not allowed',
        input: beatmapIds,
      });
    }
  });

export type TournamentSubmissionFormValues = z.infer<
  typeof tournamentSubmissionFormSchema
>;

/**
 * `created`: an admin's submission, made into a tournament at once.
 * `pending`: anyone else's, held until an admin approves it.
 */
export const TournamentSubmissionResponseSchema = z.discriminatedUnion(
  'status',
  [
    z.object({
      status: z.literal('created'),
      id: z.number().int().positive(),
    }),
    z.object({
      status: z.literal('pending'),
      submissionId: z.number().int().positive(),
    }),
  ]
);

export type TournamentSubmissionResponse = z.infer<
  typeof TournamentSubmissionResponseSchema
>;

/** A held submission as its submitter sees it. */
export const TournamentSubmissionSummarySchema = z.object({
  id: z.number().int().positive(),
  status: ApprovalStatusSchema,
  created: z.string(),
  name: z.string(),
  abbreviation: z.string(),
  forumUrl: z.string(),
  ruleset: z.enum(Ruleset),
  rankRangeLowerBound: z.number().int(),
  lobbySize: z.number().int(),
  isLazer: z.boolean(),
  matchCount: z.number().int().nonnegative(),
  beatmapCount: z.number().int().nonnegative(),
  /** The tournament approval created; null while pending, when denied, or once deleted. */
  tournamentId: z.number().int().positive().nullable(),
  reviewedAt: z.string().nullable(),
});

export type TournamentSubmissionSummary = z.infer<
  typeof TournamentSubmissionSummarySchema
>;

/** A held submission in the admin queue: who sent it, and every ID. */
export const AdminTournamentSubmissionSchema =
  TournamentSubmissionSummarySchema.extend({
    submitter: ApprovalUserSchema.nullable(),
    reviewer: ApprovalUserSchema.nullable(),
    matchIds: z.array(z.number().int().positive()),
    beatmapIds: z.array(z.number().int().positive()),
  });

export type AdminTournamentSubmission = z.infer<
  typeof AdminTournamentSubmissionSchema
>;

export const AdminTournamentSubmissionListSchema = z.object({
  submissions: z.array(AdminTournamentSubmissionSchema),
});

export const MyTournamentSubmissionListSchema = z.object({
  submissions: z.array(TournamentSubmissionSummarySchema),
});

export const TournamentSubmissionApprovalResponseSchema = z.object({
  tournamentId: z.number().int().positive(),
});
