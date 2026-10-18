import { and, eq } from 'drizzle-orm';
import type { OsuApiPayload } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue } from '@otr/core/jobs';

import { PermanentJobError, RetryableJobError } from '../../jobs/errors';
import { pauseForMaintenanceWindow } from '../../jobs/maintenance';
import type {
  ClaimedJob,
  JobTransaction,
  QueueRegistration,
} from '../../jobs/types';
import type { Logger } from '../../logging/logger';
import { osuRetryAfterMs, trackOsuRetryAfter } from '../retry-after';
import type { BeatmapFetchService } from '../services/beatmap-fetch-service';
import type { ForumTopicFetchService } from '../services/forum-topic-fetch-service';
import type { MatchFetchService } from '../services/match-fetch-service';
import type { PlayerFetchService } from '../services/player-fetch-service';
import type { TournamentDataCompletionService } from '../services/tournament-data-completion-service';

type BeatmapFetchServiceContract = Pick<BeatmapFetchService, 'fetchAndPersist'>;
type MatchFetchServiceContract = Pick<MatchFetchService, 'fetchAndPersist'>;
type PlayerFetchServiceContract = Pick<PlayerFetchService, 'fetchAndPersist'>;
type ForumTopicFetchServiceContract = Pick<
  ForumTopicFetchService,
  'fetchAndPersist'
>;
type DataCompletionContract = Pick<
  TournamentDataCompletionService,
  | 'updateMatchFetchStatus'
  | 'updateBeatmapFetchStatus'
  | 'recheckTournaments'
  | 'tournamentsUsingBeatmap'
>;

interface OsuApiFetchWorkerOptions {
  beatmapService: BeatmapFetchServiceContract;
  matchService: MatchFetchServiceContract;
  playerService: PlayerFetchServiceContract;
  forumTopicService: ForumTopicFetchServiceContract;
  dataCompletion: DataCompletionContract;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
}

const UNFINISHED: number[] = [
  DataFetchStatus.NotFetched,
  DataFetchStatus.Fetching,
];

/** Runs data.osu jobs: match, beatmap, player and forum topic fetches. */
export class OsuApiFetchWorker {
  private readonly options: OsuApiFetchWorkerOptions;
  private readonly maintenancePause: (now: Date) => Date | null;
  // When osu! last asked for a wait to end, in ms since the epoch.
  private osuWaitUntil = 0;

  constructor(options: OsuApiFetchWorkerOptions) {
    this.options = options;
    this.maintenancePause = pauseForMaintenanceWindow(
      options.maintenanceWindowEnabled
    );
  }

  registration(): QueueRegistration<JobQueue.OsuFetch> {
    return {
      queue: JobQueue.OsuFetch,
      handler: (job) => this.handle(job),
      pausedUntil: (now) => this.pausedUntil(now),
      onGiveUp: (job, tx) => this.giveUp(job, tx),
    };
  }

  /**
   * The maintenance window, or a wait osu! asked for: the whole queue waits,
   * not only the job that was told to, since every job calls osu!.
   */
  pausedUntil(now: Date): Date | null {
    const maintenance = this.maintenancePause(now);
    const osuWait =
      this.osuWaitUntil > now.getTime() ? new Date(this.osuWaitUntil) : null;

    if (!maintenance || !osuWait) {
      return maintenance ?? osuWait;
    }
    return maintenance > osuWait ? maintenance : osuWait;
  }

  async handle(job: ClaimedJob<JobQueue.OsuFetch>) {
    const payload = job.payload;
    const jobLogger = this.options.logger.child({
      correlationId: job.correlationId,
      messageType: payload.type,
    });

    jobLogger.info('processing osu! API fetch', { type: payload.type });

    // The wait osu! asked for is readable only inside the tracked call.
    await trackOsuRetryAfter(async () => {
      try {
        await this.route(payload, job, jobLogger);
      } catch (error) {
        const jobError = asJobError(error);
        if (jobError instanceof RetryableJobError && jobError.delayMs) {
          this.osuWaitUntil = Math.max(
            this.osuWaitUntil,
            Date.now() + jobError.delayMs
          );
        }
        throw jobError;
      }
    });
  }

  private async route(
    payload: OsuApiPayload,
    job: ClaimedJob<JobQueue.OsuFetch>,
    jobLogger: Logger
  ) {
    switch (payload.type) {
      case 'beatmap': {
        const { beatmapId, skipAutomationChecks } = payload;
        jobLogger.info('processing beatmap fetch', {
          beatmapId,
          skipAutomationChecks,
        });
        await this.options.beatmapService.fetchAndPersist(beatmapId, {
          skipAutomationChecks,
        });
        return;
      }

      case 'match': {
        const { osuMatchId, isLazer } = payload;
        jobLogger.info('processing match fetch', { osuMatchId, isLazer });
        const persisted = await this.options.matchService.fetchAndPersist(
          osuMatchId,
          isLazer
        );
        if (!persisted) {
          jobLogger.warn('match fetch completed without persistence');
        }
        return;
      }

      case 'player': {
        const { osuPlayerId } = payload;
        jobLogger.info('processing player fetch', { osuPlayerId });
        await this.options.playerService.fetchAndPersist(osuPlayerId);
        return;
      }

      case 'forumTopic': {
        const { topicId } = payload;
        jobLogger.info('processing forum topic fetch', { topicId });
        // A request merged into this job came before it ran, so the job's
        // creation is the oldest request a fresh fetch satisfies.
        await this.options.forumTopicService.fetchAndPersist(
          topicId,
          job.created
        );
        return;
      }

      default: {
        throw new PermanentJobError(
          `Unknown osu! fetch: ${JSON.stringify(payload)}`
        );
      }
    }
  }

  /**
   * Marks what the job fetched as errored, so nothing waits on it forever and
   * its tournament can still get automated checks. Data that was already
   * saved, when only the check after it failed, gets that check here.
   */
  private async giveUp(job: ClaimedJob<JobQueue.OsuFetch>, tx: JobTransaction) {
    const payload = job.payload;
    const { dataCompletion } = this.options;

    switch (payload.type) {
      case 'match': {
        const matches = await tx
          .select({
            id: schema.matches.id,
            tournamentId: schema.matches.tournamentId,
            status: schema.matches.dataFetchStatus,
          })
          .from(schema.matches)
          .where(
            and(
              eq(schema.matches.osuId, payload.osuMatchId),
              eq(schema.matches.isLazer, payload.isLazer)
            )
          );
        for (const match of matches) {
          if (UNFINISHED.includes(match.status)) {
            await dataCompletion.updateMatchFetchStatus(
              match.id,
              DataFetchStatus.Error,
              tx
            );
          } else {
            await dataCompletion.recheckTournaments([match.tournamentId], tx);
          }
        }
        return;
      }

      case 'beatmap': {
        const beatmaps = await tx
          .select({
            id: schema.beatmaps.id,
            status: schema.beatmaps.dataFetchStatus,
            manualOverride: schema.beatmaps.manualOverride,
          })
          .from(schema.beatmaps)
          .where(eq(schema.beatmaps.osuId, payload.beatmapId));
        for (const beatmap of beatmaps) {
          if (UNFINISHED.includes(beatmap.status) && !beatmap.manualOverride) {
            await dataCompletion.updateBeatmapFetchStatus(
              beatmap.id,
              DataFetchStatus.Error,
              { skipAutomationChecks: payload.skipAutomationChecks },
              tx
            );
          } else if (!payload.skipAutomationChecks) {
            await dataCompletion.recheckTournaments(
              [
                ...(await dataCompletion.tournamentsUsingBeatmap(
                  beatmap.id,
                  tx
                )),
              ],
              tx
            );
          }
        }
        return;
      }

      case 'player': {
        // Frees the refetch scheduler's lease, so it tries again later.
        await tx
          .update(schema.players)
          .set({
            dataFetchStatus: DataFetchStatus.Error,
            updated: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.players.osuId, payload.osuPlayerId),
              eq(schema.players.dataFetchStatus, DataFetchStatus.Fetching)
            )
          );
        return;
      }

      default:
        return;
    }
  }
}

/**
 * osu! asking us to wait becomes a retry no sooner than it asked. The client
 * loses the status when a 429 or 503 body isn't JSON, but a captured wait
 * only ever comes from one of those responses.
 */
const asJobError = (error: unknown) => {
  // The osu! client's APIError carries the response status.
  const status = (error as { response?: { status_code?: unknown } } | null)
    ?.response?.status_code;
  const waitMs = osuRetryAfterMs();

  if (status === 429 || status === 503 || waitMs !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return new RetryableJobError(
      `osu! asked to retry later${status ? ` (${status})` : ''}: ${message}`,
      waitMs
    );
  }

  return error;
};
