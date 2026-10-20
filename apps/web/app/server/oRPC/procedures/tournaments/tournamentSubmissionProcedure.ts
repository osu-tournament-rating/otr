import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { TournamentRejectionReason, VerificationStatus } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';
import { withAuditUserId } from '@otr/core/db';
import { parseForumTopicId } from '@otr/core/osu/forum';
import { enqueueJobs, JobQueue, type JobPayload } from '@otr/core/jobs';
import {
  TournamentSubmissionInputSchema,
  TournamentSubmissionResponseSchema,
  type TournamentSubmissionInput,
} from '@/lib/orpc/schema/tournamentSubmission';
import type { DatabaseClient } from '@/lib/db';
import { createPlaceholderBeatmap } from './beatmapPlaceholders';

import { protectedMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { getCorrelationId } from '../logging/helpers';
import { logger } from '@/lib/logger';

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

interface SubmitTournamentContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

interface SubmitTournamentErrors {
  ACCOUNT_RESOLUTION_FAILED(): ORPCError<string, unknown>;
  NAME_ABBREVIATION_CONFLICT(options?: {
    message?: string;
  }): ORPCError<string, unknown>;
  MATCH_ASSIGNMENT_CONFLICT(options?: {
    message?: string;
  }): ORPCError<string, unknown>;
  TOURNAMENT_CREATION_FAILED(): ORPCError<string, unknown>;
  DUPLICATE_TOURNAMENT_DETAILS(): ORPCError<string, unknown>;
  SUBMISSION_FAILED(): ORPCError<string, unknown>;
}

export interface SubmitTournamentHandlerArgs {
  input: TournamentSubmissionInput;
  context: SubmitTournamentContext;
  errors: SubmitTournamentErrors;
}

export async function submitTournamentHandler({
  input,
  context,
  errors,
}: SubmitTournamentHandlerArgs) {
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

  const correlationId = getCorrelationId(context);

  try {
    const response = await db.transaction((tx) =>
      withAuditUserId(tx, submittingUserId, async () => {
        const existingWithNameAndAbbreviation =
          await tx.query.tournaments.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.tournaments.name, input.name),
              eq(schema.tournaments.abbreviation, input.abbreviation)
            ),
          });

        if (existingWithNameAndAbbreviation) {
          throw errors.NAME_ABBREVIATION_CONFLICT();
        }

        const [tournament] = await tx
          .insert(schema.tournaments)
          .values({
            name: input.name,
            abbreviation: input.abbreviation,
            forumUrl: input.forumUrl,
            rankRangeLowerBound: input.rankRangeLowerBound,
            ruleset: input.ruleset,
            lobbySize: input.lobbySize,
            rejectionReason,
            verificationStatus:
              rejectionReason === TournamentRejectionReason.None
                ? VerificationStatus.None
                : VerificationStatus.Rejected,
            submittedByUserId: submittingUserId,
            isLazer: input.isLazer,
          })
          .returning({ id: schema.tournaments.id });

        if (!tournament) {
          throw errors.TOURNAMENT_CREATION_FAILED();
        }

        const tournamentId = tournament.id;
        const fetches: JobPayload<JobQueue.OsuFetch>[] = [];

        const matchOsuIds = Array.from(new Set(input.ids)) as number[];

        const existingMatches = matchOsuIds.length
          ? await tx
              .select({
                osuId: schema.matches.osuId,
                tournamentId: schema.matches.tournamentId,
              })
              .from(schema.matches)
              .where(
                and(
                  inArray(schema.matches.osuId, matchOsuIds),
                  eq(schema.matches.isLazer, input.isLazer)
                )
              )
          : [];

        const mergedMatches = matchOsuIds.length
          ? await tx
              .select({ osuId: schema.matchMerges.osuId })
              .from(schema.matchMerges)
              .where(
                and(
                  inArray(schema.matchMerges.osuId, matchOsuIds),
                  eq(schema.matchMerges.isLazer, input.isLazer)
                )
              )
          : [];

        if (mergedMatches.length) {
          throw errors.MATCH_ASSIGNMENT_CONFLICT({
            message: `The following matches were merged into other matches: ${formatIdList(
              mergedMatches.map((match) => Number(match.osuId))
            )}.`,
          });
        }

        const conflictingMatches = existingMatches.filter(
          (match) =>
            match.tournamentId !== null && match.tournamentId !== tournamentId
        );

        if (conflictingMatches.length) {
          throw errors.MATCH_ASSIGNMENT_CONFLICT({
            message: `The following matches are already assigned to another tournament: ${formatIdList(
              conflictingMatches.map((match) => Number(match.osuId))
            )}.`,
          });
        }

        const matchesToUpdate = existingMatches.filter(
          (match) => match.tournamentId === null
        );

        for (const match of matchesToUpdate) {
          await tx
            .update(schema.matches)
            .set({
              tournamentId,
              submittedByUserId: submittingUserId,
            })
            .where(
              and(
                eq(schema.matches.osuId, match.osuId),
                eq(schema.matches.isLazer, input.isLazer)
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
              submittedByUserId: submittingUserId,
              verificationStatus: VerificationStatus.None,
              rejectionReason: 0,
              warningFlags: 0,
              isLazer: input.isLazer,
            }))
          );

          matchesToInsert.forEach((osuMatchId) =>
            fetches.push({
              type: 'match',
              osuMatchId,
              isLazer: input.isLazer,
            })
          );
        }

        const beatmapOsuIds = Array.from(new Set(input.beatmapIds)) as number[];

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
              createPlaceholderBeatmap(osuId, input.ruleset)
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
            .filter(
              Boolean
            ) as (typeof schema.joinPooledBeatmaps.$inferInsert)[];

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
                  eq(
                    schema.joinPooledBeatmaps.tournamentsPooledInId,
                    tournamentId
                  ),
                  inArray(
                    schema.joinPooledBeatmaps.pooledBeatmapsId,
                    beatmapIds
                  )
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

        const topicId = parseForumTopicId(input.forumUrl);
        if (topicId !== null) {
          fetches.push({ type: 'forumTopic', topicId });
        }

        // In this transaction, so the tournament and its fetches commit together.
        await enqueueJobs(
          tx,
          JobQueue.OsuFetch,
          fetches.map((payload) => ({
            payload,
            correlationId,
            tournamentId,
            requestedByUserId: submittingUserId,
            explicit: true,
          }))
        );

        return { id: tournamentId };
      })
    );

    return { id: response.id };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    if (isDatabaseError(error) && error.code === '23505') {
      const detail = error.detail ?? '';
      const constraint = error.constraint ?? '';

      if (
        constraint === 'ix_tournaments_name_abbreviation' ||
        detail.includes('(name, abbreviation)')
      ) {
        throw errors.NAME_ABBREVIATION_CONFLICT();
      }

      throw errors.DUPLICATE_TOURNAMENT_DETAILS();
    }

    logger.error('Failed to submit tournament', { error });

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
    SUBMISSION_FAILED: {
      status: 500,
      message:
        'Something went wrong while submitting the tournament. Please try again or contact the o!TR team.',
    },
  })
  .route({
    summary: 'Submit tournament for verification',
    tags: ['authenticated'],
    method: 'POST',
    path: '/tournaments:submit',
  })
  .handler(submitTournamentHandler);
