// Must be first so the tracer provider is live before anything else loads.
import './tracing';

import {
  QueueConstants,
  type ProcessBeatmapAttributesMessage,
} from '@otr/core';
import { enqueueJobs, getJobQueueSummary, JobQueue } from '@otr/core/jobs';
import { withoutTracing } from '@otr/core/tracing';

import { databaseUrl, db } from './db';
import {
  apiRequestStats,
  setJobSummarySource,
  startMetricsServer,
} from './metrics';
import { dataWorkerEnv } from './env';
import { consoleLogger } from './logging/logger';
import { RabbitMqConsumer } from './queue/rabbitmq-consumer';
import { RabbitMqPublisher } from '@otr/core/queues';
import { FixedWindowRateLimiter } from './rate-limiter';
import {
  BeatmapFetchService,
  ForumTopicFetchService,
  MatchFetchService,
  OsuApiFetchWorker,
  PlayerFetchService,
  TournamentDataCompletionService,
  createOsuApiClient,
} from './osu';
import { OsuTrackClient } from './osu-track/client';
import { OsuTrackPlayerWorker } from './osu-track/worker';
import { processOsuTrackPlayerResults } from './osu-track/persistence';
import {
  GameAutomationChecks,
  MatchAutomationChecks,
  ScoreAutomationChecks,
  TournamentAutomationCheckService,
  TournamentAutomationCheckWorker,
  TournamentAutomationChecks,
} from './automation-checks';
import {
  TournamentStatsCalculator,
  TournamentStatsService,
  TournamentStatsWorker,
} from './stats';
import { PlayerRefetchScheduler } from './players/player-refetch-scheduler';
import { ForumPostBackfill } from './forum-posts/forum-post-backfill';
import {
  checkBeatmapFileStore,
  createBeatmapFileStore,
} from './beatmap-attributes/file-store';
import { BeatmapFileDownloader } from './beatmap-attributes/downloader';
import { BeatmapAttributesService } from './beatmap-attributes/beatmap-attributes-service';
import { BeatmapAttributesWorker } from './beatmap-attributes/beatmap-attributes-worker';
import { BeatmapAttributesScheduler } from './beatmap-attributes/beatmap-attributes-scheduler';
import { JobRunner } from './jobs/runner';
import { JobListener } from './jobs/listener';
import { JobPruner } from './jobs/pruner';
import {
  osuFetchJobFromMessage,
  osuTrackJobFromMessage,
  RabbitMqBridge,
  tournamentChecksJobFromMessage,
  tournamentStatsJobFromMessage,
} from './jobs/rabbitmq-bridge';
import { StrandedFetchSweep } from './jobs/stranded-fetch-sweep';
import { captureOsuRetryAfter } from './osu/retry-after';

const logger = consoleLogger;

// Every started consumer; the health check fails while any is unsubscribed.
const consumers: Array<{ readonly isConsuming: boolean }> = [];

const API_REQUEST_STATS_FLUSH_MS = 60_000;

const runner = new JobRunner({ db, logger: consoleLogger });

// osu!'s Retry-After on a 429 or 503 decides when a fetch job runs again.
globalThis.fetch = captureOsuRetryAfter(globalThis.fetch);

/**
 * Starts the attribute job consumer and the sweep, or returns null and leaves
 * them off when nothing is configured, the settings are wrong, or the store
 * fails its probe. The other consumers keep running in each of those cases.
 */
const startBeatmapAttributes = async (
  publisher: RabbitMqPublisher<ProcessBeatmapAttributesMessage> | null
) => {
  const { config, error } = dataWorkerEnv.beatmapFiles;

  if (error) {
    logger.error(`Beatmap file storage is off: ${error}`);
    return null;
  }

  if (!config || !publisher) {
    logger.info(
      'Beatmap file storage is off: neither BEATMAP_FILES_BUCKET nor BEATMAP_FILES_DIR is set'
    );
    return null;
  }

  const store = createBeatmapFileStore(config);

  try {
    await checkBeatmapFileStore(store);
  } catch (probeError) {
    logger.error(
      'Beatmap file storage is off; jobs from beatmap fetches wait in the queue',
      { error: probeError }
    );
    return null;
  }

  const consumer = new RabbitMqConsumer<ProcessBeatmapAttributesMessage>({
    url: dataWorkerEnv.amqpUrl,
    queue: QueueConstants.attributes.beatmaps,
    // The service relies on one job at a time.
    prefetch: 1,
    logger,
  });

  const worker = new BeatmapAttributesWorker({
    queue: consumer,
    service: new BeatmapAttributesService({
      db,
      logger,
      store,
      downloader: new BeatmapFileDownloader({ logger }),
    }),
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });

  const scheduler = new BeatmapAttributesScheduler({
    db,
    logger,
    publisher,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });

  await worker.start();
  consumers.push(consumer);
  scheduler.start();

  logger.info('Beatmap file storage is on', { location: store.location });

  return { worker, scheduler };
};

startMetricsServer(
  () =>
    consumers.every((consumer) => consumer.isConsuming) && runner.isHealthy()
);

const bootstrap = async () => {
  const osuApiClient = await createOsuApiClient();

  const osuApiRateLimiter = new FixedWindowRateLimiter({
    requests: dataWorkerEnv.osuApiRateLimit.requests,
    windowMs: dataWorkerEnv.osuApiRateLimit.windowSeconds * 1000,
    logger,
    label: 'osu-api',
  });

  const osuTrackRateLimiter = new FixedWindowRateLimiter({
    requests: dataWorkerEnv.osuTrackRateLimit.requests,
    windowMs: dataWorkerEnv.osuTrackRateLimit.windowSeconds * 1000,
    logger,
    label: 'osu-track',
  });

  const dataCompletion = new TournamentDataCompletionService({ db, logger });

  // Exists before the osu! consumer starts, so no beatmap fetch drops its
  // job. With a store configured, jobs queue even while the store fails its
  // probe, and wait for a start that passes it.
  const beatmapAttributesPublisher = dataWorkerEnv.beatmapFiles.config
    ? new RabbitMqPublisher<ProcessBeatmapAttributesMessage>({
        url: dataWorkerEnv.amqpUrl,
        queue: QueueConstants.attributes.beatmaps,
      })
    : null;
  let beatmapAttributes: Awaited<ReturnType<typeof startBeatmapAttributes>> =
    null;

  const beatmapService = new BeatmapFetchService({
    db,
    api: osuApiClient,
    rateLimiter: osuApiRateLimiter,
    logger,
    dataCompletion,
    publishPlayerFetches: async (tx, osuPlayerIds) => {
      await enqueueJobs(
        tx,
        JobQueue.OsuFetch,
        osuPlayerIds.map((osuPlayerId) => ({
          payload: { type: 'player' as const, osuPlayerId },
        }))
      );
    },
    publishBeatmapAttributes: beatmapAttributesPublisher
      ? async (payload) => {
          await beatmapAttributesPublisher.publish(payload);
        }
      : undefined,
  });

  const matchService = new MatchFetchService({
    db,
    api: osuApiClient,
    rateLimiter: osuApiRateLimiter,
    logger,
    dataCompletion,
    publishBeatmapFetches: async (tx, osuBeatmapIds) => {
      await enqueueJobs(
        tx,
        JobQueue.OsuFetch,
        osuBeatmapIds.map((beatmapId) => ({
          payload: { type: 'beatmap' as const, beatmapId },
        }))
      );
    },
  });

  const playerService = new PlayerFetchService({
    db,
    api: osuApiClient,
    rateLimiter: osuApiRateLimiter,
    logger,
  });

  const forumTopicService = new ForumTopicFetchService({
    db,
    api: osuApiClient,
    rateLimiter: osuApiRateLimiter,
    logger,
  });

  const forumPostBackfill = new ForumPostBackfill({ db, logger });

  const playerRefetchScheduler = new PlayerRefetchScheduler({
    db,
    logger,
    config: dataWorkerEnv.playerAutoRefetch,
  });

  const automationService = new TournamentAutomationCheckService({
    db,
    logger,
    tournamentChecks: new TournamentAutomationChecks(),
    matchChecks: new MatchAutomationChecks(),
    gameChecks: new GameAutomationChecks(),
    scoreChecks: new ScoreAutomationChecks(),
  });

  const statsCalculator = new TournamentStatsCalculator();
  const statsService = new TournamentStatsService({
    db,
    logger,
    calculator: statsCalculator,
  });

  const osuWorker = new OsuApiFetchWorker({
    beatmapService,
    matchService,
    playerService,
    forumTopicService,
    dataCompletion,
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });
  runner.register(osuWorker.registration());

  const strandedFetchSweep = new StrandedFetchSweep({
    db,
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });

  const osuTrackClient = new OsuTrackClient({});

  const osuTrackWorker = new OsuTrackPlayerWorker({
    client: osuTrackClient,
    rateLimiter: osuTrackRateLimiter,
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
    onPlayer: async ({ osuPlayerId, results }) => {
      await processOsuTrackPlayerResults({
        db,
        logger,
        osuPlayerId,
        results,
      });
    },
  });
  runner.register(osuTrackWorker.registration());

  const automationWorker = new TournamentAutomationCheckWorker({
    service: automationService,
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });
  runner.register(automationWorker.registration());

  const statsWorker = new TournamentStatsWorker({
    service: statsService,
    logger,
  });

  runner.register(statsWorker.registration());

  const jobListener = new JobListener({
    connectionString: databaseUrl,
    logger,
    onReady: (queue) => runner.wake(queue),
  });

  const jobPruner = new JobPruner({
    db,
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });

  // Moves messages for queues that now run from the jobs table.
  const rabbitMqBridge = new RabbitMqBridge({
    url: dataWorkerEnv.amqpUrl,
    db,
    logger,
    queues: [
      {
        queue: JobQueue.TournamentStats,
        toJob: tournamentStatsJobFromMessage,
      },
      { queue: JobQueue.OsuFetch, toJob: osuFetchJobFromMessage },
      { queue: JobQueue.OsuTrackFetch, toJob: osuTrackJobFromMessage },
      {
        queue: JobQueue.TournamentChecks,
        toJob: tournamentChecksJobFromMessage,
      },
    ],
  });

  setJobSummarySource({
    queues: runner.queues,
    read: () => withoutTracing(() => getJobQueueSummary(db)),
  });

  const apiRequestStatsFlush = setInterval(() => {
    void withoutTracing(() => apiRequestStats.flush(db)).catch((error) => {
      logger.error('Failed to save API request totals', { error });
    });
  }, API_REQUEST_STATS_FLUSH_MS);

  logger.info('Starting data worker services');

  await jobListener.start();
  runner.start();
  jobPruner.start();
  strandedFetchSweep.start();
  await rabbitMqBridge.start();
  consumers.push(rabbitMqBridge);

  await playerRefetchScheduler.start();
  await forumPostBackfill.run();

  const shutdown = async () => {
    logger.info('Shutting down data worker services');
    clearInterval(apiRequestStatsFlush);
    await Promise.allSettled([
      runner.stop(),
      jobPruner.stop(),
      strandedFetchSweep.stop(),
      rabbitMqBridge.stop(),
      playerRefetchScheduler.stop(),
      beatmapAttributes?.worker.stop(),
      beatmapAttributes?.scheduler.stop(),
    ]);
    // Closed after the job runner and the sweep stop, since both publish to it.
    await beatmapAttributesPublisher?.close();
    await Promise.allSettled([
      jobListener.stop(),
      withoutTracing(() => apiRequestStats.flush(db)),
    ]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  beatmapAttributes = await startBeatmapAttributes(beatmapAttributesPublisher);
};

bootstrap().catch((error) => {
  logger.error('Failed to bootstrap data worker', { error });
  process.exit(1);
});
