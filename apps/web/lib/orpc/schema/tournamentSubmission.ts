import { z } from 'zod';

import { Ruleset, TournamentRejectionReason } from '@otr/core/osu';
import {
  FORUM_POST_URL_REQUIRED_MESSAGE,
  FORUM_POST_URL_SOURCE_MESSAGE,
  LOBBY_SIZE_MAXIMUM_MESSAGE,
  LOBBY_SIZE_MINIMUM_MESSAGE,
  LOBBY_SIZE_REQUIRED_MESSAGE,
  MATCH_LINKS_NEED_STABLE_MESSAGE,
  MIXED_MATCH_LINKS_MESSAGE,
  RANK_RESTRICTION_MINIMUM_MESSAGE,
  RANK_RESTRICTION_REQUIRED_MESSAGE,
  RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE,
  ROOM_LINKS_NEED_LAZER_MESSAGE,
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

const MATCH_LINK_PATTERN =
  /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/(community\/matches|mp|multiplayer\/rooms)\/(\d+)(?:\/events)?)$/;

/** What a match link says it is: a lazer room or a stable match. */
type MatchLinkKind = 'lazer' | 'stable';

/**
 * The osu! ID in one line of the matches field, or 0 when it is not a match
 * link, and whether the link is a lazer room or a stable match. A bare ID says
 * neither.
 */
const parseMatchLink = (
  item: unknown
): { id: number; kind: MatchLinkKind | null } => {
  if (!item || (typeof item === 'string' && item.trim() === '')) {
    return { id: 0, kind: null };
  }

  const match = String(item).trim().match(MATCH_LINK_PATTERN);
  if (!match) {
    return { id: 0, kind: null };
  }

  if (match[1]) {
    return { id: Number(match[1]), kind: null };
  }

  return {
    id: Number(match[3]),
    kind: match[2] === 'multiplayer/rooms' ? 'lazer' : 'stable',
  };
};

/**
 * Whether the links in the matches field contradict "Played on osu!lazer":
 * every match is fetched as the box says, so a room link fetched as a stable
 * match (or the reverse) finds nothing.
 */
const matchLinkMismatchMessage = (
  ids: unknown,
  isLazer: unknown
): string | null => {
  const kinds = new Set(
    (Array.isArray(ids) ? ids : []).map((item) => parseMatchLink(item).kind)
  );

  if (kinds.has('lazer') && kinds.has('stable')) {
    return MIXED_MATCH_LINKS_MESSAGE;
  }
  if (kinds.has('lazer') && isLazer !== true) {
    return ROOM_LINKS_NEED_LAZER_MESSAGE;
  }
  if (kinds.has('stable') && isLazer === true) {
    return MATCH_LINKS_NEED_STABLE_MESSAGE;
  }
  return null;
};

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
      return val.map((item) => parseMatchLink(item).id);
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

const formSubmissionSchema = baseSubmissionSchema
  .extend({
    ids: parseMatchIds,
    beatmapIds: parseBeatmapIds,
    // Read from the raw links before they become IDs; dropped from the output.
    matchLinkMismatch: z.string().nullable(),
  })
  .check((ctx) => {
    const ids = ctx.value.ids as number[];
    const beatmapIds = ctx.value.beatmapIds as number[];

    if (ctx.value.matchLinkMismatch) {
      ctx.issues.push({
        path: ['ids'],
        code: 'custom',
        message: ctx.value.matchLinkMismatch,
        input: ids,
      });
    }

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
  })
  .transform(({ matchLinkMismatch: _mismatch, ...values }) => values);

export const tournamentSubmissionFormSchema = z.preprocess(
  (raw) =>
    raw && typeof raw === 'object'
      ? {
          ...raw,
          matchLinkMismatch: matchLinkMismatchMessage(
            (raw as { ids?: unknown }).ids,
            (raw as { isLazer?: unknown }).isLazer
          ),
        }
      : raw,
  formSubmissionSchema
);

export type TournamentSubmissionFormValues = z.infer<
  typeof tournamentSubmissionFormSchema
>;

export const TournamentSubmissionResponseSchema = z.object({
  id: z.number().int().positive(),
  warnings: z.array(z.string().min(1)).optional(),
});

export type TournamentSubmissionResponse = z.infer<
  typeof TournamentSubmissionResponseSchema
>;
