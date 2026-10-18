import type {
  FetchOsuMessage,
  MessageMetadata,
  OsuApiPayload,
} from '@otr/core';

import type { Logger } from '../../logging/logger';
import type { QueueConsumer } from '@otr/core/queues';
import { deferIfMaintenanceWindow } from '../../maintenance/gate';
import type { BeatmapFetchService } from '../services/beatmap-fetch-service';
import type { ForumTopicFetchService } from '../services/forum-topic-fetch-service';
import type { MatchFetchService } from '../services/match-fetch-service';
import type { PlayerFetchService } from '../services/player-fetch-service';

type BeatmapFetchServiceContract = Pick<BeatmapFetchService, 'fetchAndPersist'>;
type MatchFetchServiceContract = Pick<MatchFetchService, 'fetchAndPersist'>;
type PlayerFetchServiceContract = Pick<PlayerFetchService, 'fetchAndPersist'>;
type ForumTopicFetchServiceContract = Pick<
  ForumTopicFetchService,
  'fetchAndPersist'
>;

interface OsuApiFetchWorkerOptions {
  queue: QueueConsumer<FetchOsuMessage>;
  beatmapService: BeatmapFetchServiceContract;
  matchService: MatchFetchServiceContract;
  playerService: PlayerFetchServiceContract;
  forumTopicService: ForumTopicFetchServiceContract;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
}

export class OsuApiFetchWorker {
  private readonly queue: QueueConsumer<FetchOsuMessage>;
  private readonly beatmapService: BeatmapFetchServiceContract;
  private readonly matchService: MatchFetchServiceContract;
  private readonly playerService: PlayerFetchServiceContract;
  private readonly forumTopicService: ForumTopicFetchServiceContract;
  private readonly logger: Logger;
  private readonly maintenanceWindowEnabled: boolean;

  constructor(options: OsuApiFetchWorkerOptions) {
    this.queue = options.queue;
    this.beatmapService = options.beatmapService;
    this.matchService = options.matchService;
    this.playerService = options.playerService;
    this.forumTopicService = options.forumTopicService;
    this.logger = options.logger;
    this.maintenanceWindowEnabled = options.maintenanceWindowEnabled;
  }

  async start() {
    await this.queue.start(async (message) => {
      const payload = message.payload;
      const msgLogger = this.logger.child({
        correlationId: message.metadata.correlationId,
        messageType: payload.type,
      });

      const deferred = await deferIfMaintenanceWindow({
        enabled: this.maintenanceWindowEnabled,
        message,
        logger: msgLogger,
      });
      if (deferred) {
        return;
      }

      msgLogger.info('processing osu! API fetch', { type: payload.type });

      try {
        await this.routeMessage(payload, message.metadata, msgLogger);
        await message.ack();
      } catch (error) {
        msgLogger.error('failed to process osu! API fetch', { error });
        throw error;
      }
    });
  }

  private async routeMessage(
    payload: OsuApiPayload,
    metadata: MessageMetadata,
    msgLogger: Logger
  ): Promise<void> {
    switch (payload.type) {
      case 'beatmap': {
        const { beatmapId, skipAutomationChecks } = payload;
        msgLogger.info('processing beatmap fetch', {
          beatmapId,
          skipAutomationChecks,
        });
        await this.beatmapService.fetchAndPersist(beatmapId, {
          skipAutomationChecks,
        });
        break;
      }

      case 'match': {
        const { osuMatchId, isLazer } = payload;
        msgLogger.info('processing match fetch', { osuMatchId, isLazer });
        const persisted = await this.matchService.fetchAndPersist(
          osuMatchId,
          isLazer
        );
        if (!persisted) {
          msgLogger.warn('match fetch completed without persistence');
        }
        break;
      }

      case 'player': {
        const { osuPlayerId } = payload;
        msgLogger.info('processing player fetch', { osuPlayerId });
        await this.playerService.fetchAndPersist(osuPlayerId);
        break;
      }

      case 'forumTopic': {
        const { topicId } = payload;
        msgLogger.info('processing forum topic fetch', { topicId });
        await this.forumTopicService.fetchAndPersist(
          topicId,
          metadata.requestedAt
        );
        break;
      }

      default: {
        const _exhaustive: never = payload;
        throw new Error(`Unknown message type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  async stop() {
    await this.queue.stop();
  }
}
