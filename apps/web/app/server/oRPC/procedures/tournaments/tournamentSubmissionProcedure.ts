import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import {
  ApprovalStatus,
  TournamentRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';
import { withAuditUserId } from '@otr/core/db';
import { parseForumTopicId } from '@otr/core/osu/forum';
import { enqueueJobs, JobQueue, type JobPayload } from '@otr/core/jobs';
import {
  TournamentSubmissionInputSchema,
  TournamentSubmissionResponseSchema,
  type TournamentSubmissionInput,
  type TournamentSubmissionResponse,
} from '@/lib/orpc/schema/tournamentSubmission';
import { hasAdminScope } from '@/lib/auth/roles';
import type { DatabaseClient } from '@/lib/db';
import { createPlaceholderBeatmap } from './beatmapPlaceholders';

import { protectedMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { assertOutsideMaintenanceWindow } from '../shared/maintenanceWindow';
import { getCorrelationId } from '../logging/helpers';

const formatIdList = (ids: readonly number[], limit = 5) => {
  if (ids.length <= limit) {
    return ids.join(', ');
  }

  const shown = ids.slice(0, limit).join(', ');
  return `${shown} and ${ids.length - limit} more`;
};

type DatabaseError = Error & {
  code?: string;
  detail?: string;
  constraint?: string;
};

const isDatabaseError = (error: unknown): error is DatabaseError =>
  Boolean(error) &&
  typeof error === 'object' &&
  'code' in (error as Record<string, unknown>);

const NAME_AND_ABBREVIATION_CONFLICT_MESSAGE =
  'A tournament with this name and abbreviation already exists. Please double-check before submitting.';

const PENDING_DUPLICATE_MESSAGE =
  'You already submitted a tournament with this name and abbreviation. It is waiting for an admin to approve it.';

/** The errors creating a tournament from a submission can raise, shared with approval. */
export const TOURNAMENT_CREATION_ERRORS = {
  NAME_ABBREVIATION_CONFLICT: {
    status: 409,
    message: NAME_AND_ABBREVIATION_CONFLICT_MESSAGE,
  },
  MATCH_ASSIGNMENT_CONFLICT: {
    status: 409,
  },
  TOURNAMENT_CREATION_FAILED: {
    status: 500,
    message: 'Failed to create tournament.',
  },
  DUPLICATE_TOURNAMENT_DETAILS: {
    status: 409,
    message:
      'A tournament with the provided details already exists. Please review the submission and try again.',
  },
} as const;

export type TransactionClient = Parameters<
  Parameters<DatabaseClient['transaction']>[0]
>[0];

/** The fields a tournament is made from, held or submitted directly. */
export type SubmissionDetails = Pick<
  TournamentSubmissionInput,
  | 'name'
  | 'abbreviation'
  | 'forumUrl'
  | 'rankRangeLowerBound'
  | 'ruleset'
  | 'lobbySize'
  | 'isLazer'
  | 'ids'
  | 'beatmapIds'
>;

export interface TournamentCreationErrors {
  NAME_ABBREVIATION_CONFLICT(options?: {
    message?: string;
  }): ORPCError<string, unknown>;
  MATCH_ASSIGNMENT_CONFLICT(options?: {
    message?: string;
  }): ORPCError<string, unknown>;
  TOURNAMENT_CREATION_FAILED(): ORPCError<string, unknown>;
  DUPLICATE_TOURNAMENT_DETAILS(): ORPCError<string, unknown>;
}

/**
 * Refuses a submission whose name and abbreviation another tournament has,
 * or whose matches were merged away or belong to another tournament. A held
 * submission runs it twice: when it is sent, so the submitter hears at once,
 * and again on approval, since another tournament may have claimed them since.
 */
export async function assertNoTournamentConflicts(
  tx: TransactionClient,
  details: SubmissionDetails,
  errors: TournamentCreationErrors,
  ownTournamentId: number | null = null
) {
  const existingWithNameAndAbbreviation = await tx.query.tournaments.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.tournaments.name, details.name),
      eq(schema.tournaments.abbreviation, details.abbreviation)
    ),
  });

  if (
    existingWithNameAndAbbreviation &&
    existingWithNameAndAbbreviation.id !== ownTournamentId
  ) {
    throw errors.NAME_ABBREVIATION_CONFLICT();
  }

  const matchOsuIds = Array.from(new Set(details.ids));

  if (matchOsuIds.length === 0) {
    return [];
  }

  const mergedMatches = await tx
    .select({ osuId: schema.matchMerges.osuId })
    .from(schema.matchMerges)
    .where(
      and(
        inArray(schema.matchMerges.osuId, matchOsuIds),
        eq(schema.matchMerges.isLazer, details.isLazer)
      )
    );

  if (mergedMatches.length) {
    throw errors.MATCH_ASSIGNMENT_CONFLICT({
      message: `The following matches were merged into other matches: ${formatIdList(
        mergedMatches.map((match) => Number(match.osuId))
      )}.`,
    });
  }

  const existingMatches = await tx
    .select({
      osuId: schema.matches.osuId,
      tournamentId: schema.matches.tournamentId,
    })
    .from(schema.matches)
    .where(
      and(
        inArray(schema.matches.osuId, matchOsuIds),
        eq(schema.matches.isLazer, details.isLazer)
      )
    );

  const conflictingMatches = existingMatches.filter(
    (match) =>
      match.tournamentId !== null && match.tournamentId !== ownTournamentId
  );

  if (conflictingMatches.length) {
    throw errors.MATCH_ASSIGNMENT_CONFLICT({
      message: `The following matches are already assigned to another tournament: ${formatIdList(
        conflictingMatches.map((match) => Number(match.osuId))
      )}.`,
    });
  }

  return existingMatches;
}

interface CreateTournamentOptions {
  rejectionReason: number;
  submittedByUserId: number | null;
  /** Who the fetch jobs are queued for. */
  requestedByUserId: number | null;
  correlationId: string | undefined;
  /** When it was submitted, for a held submission approved later. */
  created?: string;
}

/**
 * Creates the tournament, assigns or creates its matches, links its pooled
 * beatmaps, and queues their fetches, all in the caller's transaction, so the
 * tournament and its fetches commit together.
 */
export async function createTournament(
  tx: TransactionClient,
  details: SubmissionDetails,
  errors: TournamentCreationErrors,
  {
    rejectionReason,
    submittedByUserId,
    requestedByUserId,
    correlationId,
    created,
  }: CreateTournamentOptions
): Promise<number> {
  await assertNoTournamentConflicts(tx, { ...details, ids: [] }, errors);

  const [tournament] = await tx
    .insert(schema.tournaments)
    .values({
      name: details.name,
      abbreviation: details.abbreviation,
      forumUrl: details.forumUrl,
      rankRangeLowerBound: details.rankRangeLowerBound,
      ruleset: details.ruleset,
      lobbySize: details.lobbySize,
      rejectionReason,
      verificationStatus:
        rejectionReason === TournamentRejectionReason.None
          ? VerificationStatus.None
          : VerificationStatus.Rejected,
      submittedByUserId,
      isLazer: details.isLazer,
      ...(created ? { created } : {}),
    })
    .returning({ id: schema.tournaments.id });

  if (!tournament) {
    throw errors.TOURNAMENT_CREATION_FAILED();
  }

  const tournamentId = tournament.id;
  const fetches: JobPayload<JobQueue.OsuFetch>[] = [];

  const matchOsuIds = Array.from(new Set(details.ids));
  const existingMatches = await assertNoTournamentConflicts(
    tx,
    details,
    errors,
    tournamentId
  );

  const matchesToUpdate = existingMatches.filter(
    (match) => match.tournamentId === null
  );

  for (const match of matchesToUpdate) {
    await tx
      .update(schema.matches)
      .set({
        tournamentId,
        submittedByUserId,
      })
      .where(
        and(
          eq(schema.matches.osuId, match.osuId),
          eq(schema.matches.isLazer, details.isLazer)
        )
      );
  }

  const matchesToInsert = matchOsuIds.filter(
    (osuId) => !existingMatches.some((match) => match.osuId === osuId)
  );

  if (matchesToInsert.length) {
    await tx.insert(schema.matches).values(
      matchesToInsert.map((osuId) => ({
        osuId,
        tournamentId,
        submittedByUserId,
        verificationStatus: VerificationStatus.None,
        rejectionReason: 0,
        warningFlags: 0,
        isLazer: details.isLazer,
      }))
    );

    matchesToInsert.forEach((osuMatchId) =>
      fetches.push({
        type: 'match',
        osuMatchId,
        isLazer: details.isLazer,
      })
    );
  }

  const beatmapOsuIds = Array.from(new Set(details.beatmapIds));

  if (beatmapOsuIds.length) {
    const beatmapRows = await tx
      .select({
        id: schema.beatmaps.id,
        osuId: schema.beatmaps.osuId,
      })
      .from(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, beatmapOsuIds));

    const existingMap = new Map<number, number>();
    beatmapRows.forEach((beatmap) => {
      existingMap.set(Number(beatmap.osuId), beatmap.id);
    });

    const missingOsuIds = beatmapOsuIds.filter(
      (osuId) => !existingMap.has(osuId)
    );

    if (missingOsuIds.length > 0) {
      const placeholderRows = missingOsuIds.map((osuId) =>
        createPlaceholderBeatmap(osuId, details.ruleset)
      );

      if (placeholderRows.length > 0) {
        const insertedBeatmaps = await tx
          .insert(schema.beatmaps)
          .values(placeholderRows)
          .onConflictDoNothing({
            target: schema.beatmaps.osuId,
          })
          .returning({
            id: schema.beatmaps.id,
            osuId: schema.beatmaps.osuId,
          });

        insertedBeatmaps.forEach((beatmap) => {
          existingMap.set(Number(beatmap.osuId), beatmap.id);
        });
      }

      if (missingOsuIds.some((osuId) => !existingMap.has(osuId))) {
        const refreshedBeatmaps = await tx
          .select({
            id: schema.beatmaps.id,
            osuId: schema.beatmaps.osuId,
          })
          .from(schema.beatmaps)
          .where(inArray(schema.beatmaps.osuId, missingOsuIds));

        refreshedBeatmaps.forEach((beatmap) => {
          existingMap.set(Number(beatmap.osuId), beatmap.id);
        });
      }

      missingOsuIds.forEach((beatmapId) =>
        fetches.push({ type: 'beatmap', beatmapId })
      );
    }

    const beatmapIdsForJoin = beatmapOsuIds
      .map((osuId) => {
        const beatmapId = existingMap.get(osuId);
        if (!beatmapId) {
          return null;
        }

        return {
          pooledBeatmapsId: beatmapId,
          tournamentsPooledInId: tournamentId,
        } satisfies typeof schema.joinPooledBeatmaps.$inferInsert;
      })
      .filter(Boolean) as (typeof schema.joinPooledBeatmaps.$inferInsert)[];

    if (beatmapIdsForJoin.length > 0) {
      const beatmapIds = beatmapIdsForJoin.map(
        (value) => value.pooledBeatmapsId
      );

      const existingJoins = await tx
        .select({
          beatmapId: schema.joinPooledBeatmaps.pooledBeatmapsId,
        })
        .from(schema.joinPooledBeatmaps)
        .where(
          and(
            eq(schema.joinPooledBeatmaps.tournamentsPooledInId, tournamentId),
            inArray(schema.joinPooledBeatmaps.pooledBeatmapsId, beatmapIds)
          )
        );

      const existingJoinSet = new Set(
        existingJoins.map((row) => row.beatmapId)
      );

      const joinValues = beatmapIdsForJoin.filter(
        (value) => !existingJoinSet.has(value.pooledBeatmapsId)
      );

      if (joinValues.length > 0) {
        await tx
          .insert(schema.joinPooledBeatmaps)
          .values(joinValues)
          .onConflictDoNothing();
      }
    }
  }

  const topicId = parseForumTopicId(details.forumUrl);
  if (topicId !== null) {
    fetches.push({ type: 'forumTopic', topicId });
  }

  await enqueueJobs(
    tx,
    JobQueue.OsuFetch,
    fetches.map((payload) => ({
      payload,
      correlationId,
      tournamentId,
      requestedByUserId,
      explicit: true,
    }))
  );

  return tournamentId;
}

/**
 * A database refusal as the submitter should read it: a name and
 * abbreviation already taken, or another duplicate. Anything else is null.
 */
export function tournamentConflictError(
  error: unknown,
  errors: TournamentCreationErrors
): ORPCError<string, unknown> | null {
  if (!isDatabaseError(error) || error.code !== '23505') {
    return null;
  }

  const detail = error.detail ?? '';
  const constraint = error.constraint ?? '';

  if (
    constraint === 'ix_tournaments_name_abbreviation' ||
    detail.includes('(name, abbreviation)')
  ) {
    return errors.NAME_ABBREVIATION_CONFLICT();
  }

  return errors.DUPLICATE_TOURNAMENT_DETAILS();
}

interface SubmitTournamentContext {
  db: DatabaseClient;
  headers: Headers;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

interface SubmitTournamentErrors extends TournamentCreationErrors {
  ACCOUNT_RESOLUTION_FAILED(): ORPCError<string, unknown>;
  SUBMISSION_FAILED(): ORPCError<string, unknown>;
}

export interface SubmitTournamentHandlerArgs {
  input: TournamentSubmissionInput;
  context: SubmitTournamentContext;
  errors: SubmitTournamentErrors;
}

/**
 * Holds a non-admin's submission for an admin to approve: no tournament,
 * match or beatmap row is made and nothing is fetched until then. An admin's
 * submission skips approval and creates the tournament at once, so it is an
 * admin write and waits out the maintenance window like the others.
 */
export async function submitTournamentHandler({
  input,
  context,
  errors,
}: SubmitTournamentHandlerArgs): Promise<TournamentSubmissionResponse> {
  const { session, db } = context;

  const submittingUserId = session?.dbUser?.id ?? null;

  if (!submittingUserId) {
    throw errors.ACCOUNT_RESOLUTION_FAILED();
  }

  const rejectionReason =
    input.rejectionReason ?? TournamentRejectionReason.None;

  if (rejectionReason !== TournamentRejectionReason.None) {
    ensureAdminSession(session);
  }

  const isAdmin = hasAdminScope(session?.dbUser?.scopes);

  if (isAdmin) {
    await assertOutsideMaintenanceWindow(context.headers, {
      subject: 'Admin changes',
    });
  }

  const correlationId = getCorrelationId(context);

  try {
    if (!isAdmin) {
      const submissionId = await db.transaction(async (tx) => {
        await assertNoTournamentConflicts(tx, input, errors);

        const duplicate = await tx
          .select({ id: schema.tournamentSubmissions.id })
          .from(schema.tournamentSubmissions)
          .where(
            and(
              eq(
                schema.tournamentSubmissions.submittedByUserId,
                submittingUserId
              ),
              eq(schema.tournamentSubmissions.status, ApprovalStatus.Pending),
              eq(schema.tournamentSubmissions.name, input.name),
              eq(schema.tournamentSubmissions.abbreviation, input.abbreviation)
            )
          )
          .limit(1);

        if (duplicate.length > 0) {
          throw errors.NAME_ABBREVIATION_CONFLICT({
            message: PENDING_DUPLICATE_MESSAGE,
          });
        }

        const [submission] = await tx
          .insert(schema.tournamentSubmissions)
          .values({
            submittedByUserId: submittingUserId,
            name: input.name,
            abbreviation: input.abbreviation,
            forumUrl: input.forumUrl,
            rankRangeLowerBound: input.rankRangeLowerBound,
            ruleset: input.ruleset,
            lobbySize: input.lobbySize,
            isLazer: input.isLazer,
            matchIds: Array.from(new Set(input.ids)),
            beatmapIds: Array.from(new Set(input.beatmapIds)),
          })
          .returning({ id: schema.tournamentSubmissions.id });

        if (!submission) {
          throw errors.SUBMISSION_FAILED();
        }

        return submission.id;
      });

      return { status: 'pending', submissionId };
    }

    const id = await db.transaction((tx) =>
      withAuditUserId(tx, submittingUserId, () =>
        createTournament(tx, input, errors, {
          rejectionReason,
          submittedByUserId: submittingUserId,
          requestedByUserId: submittingUserId,
          correlationId,
        })
      )
    );

    return { status: 'created', id };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    const conflict = tournamentConflictError(error, errors);
    if (conflict) {
      throw conflict;
    }

    console.error('Failed to submit tournament', error);

    throw errors.SUBMISSION_FAILED();
  }
}

export const submitTournament = protectedMutationProcedure
  .input(TournamentSubmissionInputSchema)
  .output(TournamentSubmissionResponseSchema)
  .errors({
    ACCOUNT_RESOLUTION_FAILED: {
      status: 403,
      message: 'Failed to resolve account.',
    },
    ...TOURNAMENT_CREATION_ERRORS,
    SUBMISSION_FAILED: {
      status: 500,
      message:
        'Something went wrong while submitting the tournament. Please try again or contact the o!TR team.',
    },
  })
  .route({
    summary: 'Submit tournament for verification',
    description:
      "Holds a non-admin's submission until an admin approves it; nothing is fetched until then. An admin's submission creates the tournament at once.",
    tags: ['authenticated'],
    method: 'POST',
    path: '/tournaments:submit',
  })
  .handler(submitTournamentHandler);
