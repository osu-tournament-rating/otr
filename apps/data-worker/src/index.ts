// Must be first so the tracer provider is live before anything else loads.
import './tracing';

import {
  enqueueJob,
  enqueueJobs,
  getJobQueueSummary,
  JobQueue,
} from '@otr/core/jobs';
import { withoutTracing } from '@otr/core/tracing';

import { databaseUrl, db } from './db';
import {
  apiRequestStats,
  setJobSummarySource,
  startMetricsServer,
} from './metrics';
import { dataWorkerEnv } from './env';
import { consoleLogger } from './logging/logger';
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
import { StrandedFetchSweep } from './jobs/stranded-fetch-sweep';
import { captureOsuRetryAfter } from './osu/retry-after';

const logger = consoleLogger;

const API_REQUEST_STATS_FLUSH_MS = 60_000;

const runner = new JobRunner({ db, logger: consoleLogger });

// osu!'s Retry-After on a 429 or 503 decides when a fetch job runs again.
globalThis.fetch = captureOsuRetryAfter(globalThis.fetch);

/**
 * Registers the attribute job handler and returns the sweep, or returns null
 * and leaves both off when nothing is configured, the settings are wrong, or
 * the store fails its probe. Runs after every other queue has started, so a
 * slow store holds up only the attribute queue.
 */
const registerBeatmapAttributes = async () => {
  const { config, error } = dataWorkerEnv.beatmapFiles;

  if (error) {
    logger.error(`Beatmap file storage is off: ${error}`);
    return null;
  }

  if (!config) {
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

  const worker = new BeatmapAttributesWorker({
    service: new BeatmapAttributesService({
      db,
      logger,
      store,
      downloader: new BeatmapFileDownloader({ logger }),
    }),
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });

  runner.register(worker.registration());
  logger.info('Beatmap file storage is on', { location: store.location });

  return new BeatmapAttributesScheduler({
    db,
    logger,
    maintenanceWindowEnabled: dataWorkerEnv.maintenanceWindowEnabled,
  });
};

startMetricsServer(() => runner.isHealthy());

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

  const beatmapService = new BeatmapFetchService({
    db,
    api: osuApiClient,
    rateLimiter: osuApiRateLimiter,
    logger,
    dataCompletion,
    osuRefetchCadence: dataWorkerEnv.playerAutoRefetch.osu,
    publishPlayerFetches: async (tx, osuPlayerIds) => {
      await enqueueJobs(
        tx,
        JobQueue.OsuFetch,
        osuPlayerIds.map((osuPlayerId) => ({
          payload: { type: 'player' as const, osuPlayerId },
        }))
      );
    },
    // With a store configured, jobs queue even while the store fails its
    // probe, and wait for a start that passes it.
    publishBeatmapAttributes: dataWorkerEnv.beatmapFiles.config
      ? async (payload) => {
          await enqueueJob(db, JobQueue.BeatmapAttributes, { payload });
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
    players: dataWorkerEnv.playerAutoRefetch.osu.enabled,
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

  // Every queue, including the attribute queue while beatmap file storage is
  // off, so jobs waiting for a handler still count toward the depth alert.
  setJobSummarySource({
    queues: Object.values(JobQueue),
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

  await playerRefetchScheduler.start();
  await forumPostBackfill.run();

  let beatmapAttributesScheduler: Awaited<
    ReturnType<typeof registerBeatmapAttributes>
  > = null;

  const shutdown = async () => {
    logger.info('Shutting down data worker services');
    clearInterval(apiRequestStatsFlush);
    // Everything that runs or queues jobs stops before the database listener.
    await Promise.allSettled([
      runner.stop(),
      jobPruner.stop(),
      strandedFetchSweep.stop(),
      playerRefetchScheduler.stop(),
      beatmapAttributesScheduler?.stop(),
    ]);
    await Promise.allSettled([
      jobListener.stop(),
      withoutTracing(() => apiRequestStats.flush(db)),
    ]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  beatmapAttributesScheduler = await registerBeatmapAttributes();
  beatmapAttributesScheduler?.start();
};

bootstrap().catch((error) => {
  logger.error('Failed to bootstrap data worker', { error });
  process.exit(1);
});
