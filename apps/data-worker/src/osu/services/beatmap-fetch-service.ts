import { inArray, not } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import { withApiErrorHandling, withApiMetrics } from '../api-helpers';
import {
  convertBeatmapRankStatus,
  convertRuleset,
  normalizeDate,
} from '../conversions';
import {
  ensureBeatmapPlaceholder,
  updateBeatmapStatus,
} from '../beatmap-store';
import {
  claimPlayerFetchLease,
  getOrCreatePlayerId,
  getPlayerOsuFetchState,
} from '../player-store';
import { TournamentDataCompletionService } from './tournament-data-completion-service';
import type { DatabaseClient } from '../../db';
import {
  selectPlayersDueForOsuRefetch,
  type OsuRefetchCadence,
} from '../../players/osu-refetch-cadence';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import * as schema from '@otr/core/db/schema';
import type { JobExecutor } from '@otr/core/jobs';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

interface BeatmapFetchServiceOptions {
  db: DatabaseClient;
  api: API;
  rateLimiter: RateLimiter;
  logger: Logger;
  dataCompletion: TournamentDataCompletionService;
  /** A mapper is refetched only once this cadence has passed for them. */
  osuRefetchCadence: OsuRefetchCadence;
  /** Queues player fetches inside the transaction that claims their leases. */
  publishPlayerFetches: (
    db: JobExecutor,
    osuPlayerIds: number[]
  ) => Promise<void>;
  /** Absent while beatmap file storage is off. */
  publishBeatmapAttributes?: (payload: BeatmapAttributesJob) => Promise<void>;
}

interface BeatmapAttributesJob {
  beatmapId: number;
  checksum?: string;
}

/**
 * The osu! ids of everyone who mapped a difficulty. A guest difficulty can
 * have several owners, so `user_id` alone misses them; it is only the fallback
 * when osu! sends no owners.
 */
export const beatmapOwnerIds = (beatmap: {
  user_id?: number | null;
  owners?: ReadonlyArray<{ id: number }> | null;
}): number[] => {
  const ids = new Set<number>();

  for (const owner of beatmap.owners ?? []) {
    if (owner.id > 0) {
      ids.add(owner.id);
    }
  }

  if (ids.size === 0 && beatmap.user_id && beatmap.user_id > 0) {
    ids.add(beatmap.user_id);
  }

  return Array.from(ids);
};

export class BeatmapFetchService {
  private readonly db: DatabaseClient;
  private readonly api: API;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;
  private readonly dataCompletion: TournamentDataCompletionService;
  private readonly osuRefetchCadence: OsuRefetchCadence;
  private readonly publishPlayerFetches: (
    db: JobExecutor,
    osuPlayerIds: number[]
  ) => Promise<void>;
  private readonly publishBeatmapAttributes:
    ((payload: BeatmapAttributesJob) => Promise<void>) | undefined;

  constructor(options: BeatmapFetchServiceOptions) {
    this.db = options.db;
    this.api = options.api;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
    this.dataCompletion = options.dataCompletion;
    this.osuRefetchCadence = options.osuRefetchCadence;
    this.publishPlayerFetches = options.publishPlayerFetches;
    this.publishBeatmapAttributes = options.publishBeatmapAttributes;
  }

  async fetchAndPersist(
    osuBeatmapId: number,
    options?: { skipAutomationChecks?: boolean }
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();

    const beatmapRecord = await ensureBeatmapPlaceholder(
      this.db,
      osuBeatmapId,
      DataFetchStatus.Fetching,
      nowIso
    );

    const beatmapId = beatmapRecord.id;

    if (beatmapRecord.dataFetchStatus !== DataFetchStatus.Fetching) {
      await updateBeatmapStatus(
        this.db,
        beatmapId,
        DataFetchStatus.Fetching,
        nowIso
      );
    }

    const beatmapResult = await this.rateLimiter.schedule(() =>
      withApiMetrics('getBeatmap', () =>
        withApiErrorHandling(() => this.api.getBeatmap(osuBeatmapId))
      )
    );

    if (beatmapResult.status === 'unauthorized') {
      this.logger.error(
        'Unauthorized fetching beatmap - check API credentials',
        {
          osuBeatmapId,
        }
      );
      await this.dataCompletion.updateBeatmapFetchStatus(
        beatmapId,
        DataFetchStatus.Error,
        { skipAutomationChecks: options?.skipAutomationChecks }
      );
      return false;
    }

    if (beatmapResult.status === 'not_found') {
      await this.dataCompletion.updateBeatmapFetchStatus(
        beatmapId,
        DataFetchStatus.NotFound,
        { skipAutomationChecks: options?.skipAutomationChecks }
      );
      this.logger.warn('Beatmap not found in osu! API', { osuBeatmapId });
      return false;
    }

    const apiBeatmap = beatmapResult.data;

    const beatmapsetResult = await this.rateLimiter.schedule(() =>
      withApiMetrics('getBeatmapset', () =>
        withApiErrorHandling(() =>
          this.api.getBeatmapset(apiBeatmap.beatmapset_id)
        )
      )
    );

    if (beatmapsetResult.status === 'unauthorized') {
      this.logger.error(
        'Unauthorized fetching beatmapset - check API credentials',
        {
          osuBeatmapId,
          beatmapsetId: apiBeatmap.beatmapset_id,
        }
      );
      await this.dataCompletion.updateBeatmapFetchStatus(
        beatmapId,
        DataFetchStatus.Error,
        { skipAutomationChecks: options?.skipAutomationChecks }
      );
      return false;
    }

    if (beatmapsetResult.status === 'not_found') {
      await this.dataCompletion.updateBeatmapFetchStatus(
        beatmapId,
        DataFetchStatus.NotFound,
        { skipAutomationChecks: options?.skipAutomationChecks }
      );
      this.logger.warn('Beatmapset not found for beatmap', {
        osuBeatmapId,
        beatmapsetId: apiBeatmap.beatmapset_id,
      });
      return false;
    }

    const apiBeatmapset = beatmapsetResult.data;

    const result = await this.db.transaction(async (tx) => {
      const creatorId = await getOrCreatePlayerId(tx, apiBeatmapset.user_id, {
        username: apiBeatmapset.creator,
      });

      const beatmapsetValues = {
        artist: apiBeatmapset.artist ?? '',
        title: apiBeatmapset.title ?? '',
        rankedStatus: convertBeatmapRankStatus(
          (apiBeatmapset.status ?? apiBeatmapset.ranked) as
            string | number | undefined
        ),
        rankedDate: normalizeDate(apiBeatmapset.ranked_date),
        submittedDate: normalizeDate(apiBeatmapset.submitted_date),
        creatorId,
        updated: nowIso,
      };

      const [beatmapsetRow] = await tx
        .insert(schema.beatmapsets)
        .values({
          osuId: apiBeatmapset.id,
          ...beatmapsetValues,
        })
        .onConflictDoUpdate({
          target: schema.beatmapsets.osuId,
          set: beatmapsetValues,
        })
        .returning({ id: schema.beatmapsets.id });

      const beatmapRows = Array.isArray(apiBeatmapset.beatmaps)
        ? apiBeatmapset.beatmaps
        : [apiBeatmap];

      const userIds = new Set<number>();
      for (const beatmap of beatmapRows) {
        for (const ownerId of beatmapOwnerIds(beatmap)) {
          userIds.add(ownerId);
        }
      }

      // A mapper is queued when they are new, or due on the refetch
      // scheduler's cadence. One fetched recently, or being fetched now, is
      // left to the scheduler.
      // The leases and the jobs commit with the beatmap, or not at all.
      // Players lock in id order and their jobs go in one batch, so this
      // transaction locks rows in the same order as anyone else's.
      const ownerIds = [...userIds].sort((a, b) => a - b);
      const due = new Map(
        (
          await selectPlayersDueForOsuRefetch(
            tx,
            this.osuRefetchCadence,
            ownerIds
          )
        ).map((player) => [player.osuPlayerId, player])
      );
      const playersToQueue: number[] = [];
      for (const userId of ownerIds) {
        const previous = due.get(userId);
        if (previous) {
          await claimPlayerFetchLease(tx, 'osu', userId, previous, nowIso);
        } else if (await getPlayerOsuFetchState(tx, userId)) {
          this.logger.debug('Skipping player enqueue - not due a refetch', {
            userId,
          });
          continue;
        }
        playersToQueue.push(userId);
      }
      await this.publishPlayerFetches(tx, playersToQueue);

      const affectedBeatmaps: BeatmapAttributesJob[] = [];

      for (const beatmap of beatmapRows) {
        const ruleset = convertRuleset(beatmap.mode_int ?? beatmap.mode);

        const beatmapValues = {
          ruleset,
          rankedStatus: convertBeatmapRankStatus(
            (beatmap.status ?? beatmap.ranked) as string | number | undefined
          ),
          diffName: beatmap.version ?? 'Unknown',
          totalLength: beatmap.total_length ?? 0,
          drainLength: beatmap.hit_length ?? 0,
          bpm: beatmap.bpm ?? 0,
          countCircle: beatmap.count_circles ?? 0,
          countSlider: beatmap.count_sliders ?? 0,
          countSpinner: beatmap.count_spinners ?? 0,
          cs: beatmap.cs ?? 0,
          hp: beatmap.drain ?? 0,
          od: beatmap.accuracy ?? 0,
          ar: beatmap.ar ?? 0,
          sr: beatmap.difficulty_rating ?? 0,
          maxCombo: beatmap.max_combo ?? null,
          beatmapsetId: beatmapsetRow.id,
          dataFetchStatus: DataFetchStatus.Fetched,
          updated: nowIso,
        };

        const [row] = await tx
          .insert(schema.beatmaps)
          .values({
            osuId: beatmap.id,
            ...beatmapValues,
          })
          .onConflictDoUpdate({
            target: schema.beatmaps.osuId,
            set: beatmapValues,
            setWhere: not(schema.beatmaps.manualOverride),
          })
          .returning({ id: schema.beatmaps.id });

        if (!row) {
          this.logger.info('Skipping manually configured beatmap', {
            osuBeatmapId: beatmap.id,
          });
          continue;
        }

        affectedBeatmaps.push({
          beatmapId: row.id,
          checksum: beatmap.checksum ?? undefined,
        });

        for (const ownerId of beatmapOwnerIds(beatmap)) {
          const beatmapCreatorId = await getOrCreatePlayerId(tx, ownerId);

          await tx
            .insert(schema.joinBeatmapCreators)
            .values({
              createdBeatmapsId: row.id,
              creatorsId: beatmapCreatorId,
            })
            .onConflictDoNothing();
        }
      }

      return {
        beatmapsetId: beatmapsetRow.id,
        affectedBeatmaps,
      };
    });

    this.logger.info('Beatmapset processed', {
      beatmapsetId: result.beatmapsetId,
      osuBeatmapId,
    });

    const beatmapIds = new Set<number>(
      result.affectedBeatmaps.map((beatmap) => beatmap.beatmapId)
    );
    beatmapIds.add(beatmapId);

    for (const id of beatmapIds) {
      await updateBeatmapStatus(this.db, id, DataFetchStatus.Fetched, nowIso);
      await this.dataCompletion.updateBeatmapFetchStatus(
        id,
        DataFetchStatus.Fetched,
        { skipAutomationChecks: options?.skipAutomationChecks }
      );
    }

    if (this.publishBeatmapAttributes) {
      await this.queueBeatmapAttributes(
        this.publishBeatmapAttributes,
        { beatmapId, checksum: apiBeatmap.checksum ?? undefined },
        result.affectedBeatmaps
      );
    }

    return true;
  }

  /**
   * Queues the requested beatmap, and any other beatmap of the set whose
   * stored file osu! has since replaced. The rest of the set gets its files
   * from the sweep. Failures are logged and never fail the fetch.
   */
  private async queueBeatmapAttributes(
    publish: (payload: BeatmapAttributesJob) => Promise<void>,
    requested: BeatmapAttributesJob,
    affected: BeatmapAttributesJob[]
  ) {
    const jobs = [requested];
    const others = affected.filter(
      (beatmap) =>
        beatmap.beatmapId !== requested.beatmapId &&
        beatmap.checksum !== undefined
    );

    if (others.length > 0) {
      try {
        const files = await this.db.query.beatmapFiles.findMany({
          where: inArray(
            schema.beatmapFiles.beatmapId,
            others.map((beatmap) => beatmap.beatmapId)
          ),
          columns: { beatmapId: true, checksum: true },
        });
        const stored = new Map(
          files.map((file) => [file.beatmapId, file.checksum])
        );

        for (const beatmap of others) {
          if (
            stored.has(beatmap.beatmapId) &&
            stored.get(beatmap.beatmapId) !== beatmap.checksum
          ) {
            jobs.push(beatmap);
          }
        }
      } catch (error) {
        this.logger.error('Failed to read stored beatmap files', {
          beatmapIds: others.map((beatmap) => beatmap.beatmapId),
          error,
        });
      }
    }

    for (const job of jobs) {
      try {
        await publish(job);
      } catch (error) {
        this.logger.error('Failed to enqueue beatmap attributes', {
          beatmapId: job.beatmapId,
          error,
        });
      }
    }
  }
}
