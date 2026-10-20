import { eq } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import { withApiErrorHandling, withApiMetrics } from '../api-helpers';
import { ensurePlayerPlaceholder, updatePlayerStatus } from '../player-store';
import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import * as schema from '@otr/core/db/schema';
import {
  playerProfileValues,
  savePlayerRulesetData,
} from '@otr/core/db/player-profile';
import { Ruleset } from '@otr/core/osu/enums';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

const FETCHABLE_RULESETS = [
  Ruleset.Osu,
  Ruleset.Taiko,
  Ruleset.Catch,
  Ruleset.ManiaOther,
] as const;

interface PlayerFetchServiceOptions {
  db: DatabaseClient;
  api: API;
  rateLimiter: RateLimiter;
  logger: Logger;
}

export class PlayerFetchService {
  private readonly db: DatabaseClient;
  private readonly api: API;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;

  constructor(options: PlayerFetchServiceOptions) {
    this.db = options.db;
    this.api = options.api;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
  }

  async fetchAndPersist(osuPlayerId: number): Promise<boolean> {
    const nowIso = new Date().toISOString();

    const playerRecord = await ensurePlayerPlaceholder(
      this.db,
      osuPlayerId,
      DataFetchStatus.Fetching,
      nowIso
    );

    const playerId = playerRecord.id;

    if (playerRecord.dataFetchStatus !== DataFetchStatus.Fetching) {
      await updatePlayerStatus(
        this.db,
        playerId,
        DataFetchStatus.Fetching,
        nowIso
      );
    }

    let processed = false;

    for (const ruleset of FETCHABLE_RULESETS) {
      const apiRuleset = ruleset as number;
      const result = await this.rateLimiter.schedule(() =>
        withApiMetrics('getUser', () =>
          withApiErrorHandling(() => this.api.getUser(osuPlayerId, apiRuleset))
        )
      );

      if (result.status === 'unauthorized') {
        this.logger.error(
          'Unauthorized fetching player - check API credentials',
          {
            osuPlayerId,
            ruleset,
          }
        );
        await updatePlayerStatus(
          this.db,
          playerId,
          DataFetchStatus.Error,
          nowIso
        );
        return false;
      }

      if (result.status === 'not_found') {
        this.logger.warn('osu! API returned no data for player', {
          osuPlayerId,
          ruleset,
        });
        await updatePlayerStatus(
          this.db,
          playerId,
          DataFetchStatus.NotFound,
          nowIso
        );
        return false;
      }

      const apiUser = result.data;

      if (!processed) {
        await this.updatePlayerCore(playerId, apiUser, nowIso);
        processed = true;
      }

      if (!apiUser.statistics) {
        continue;
      }

      await savePlayerRulesetData(
        this.db,
        playerId,
        ruleset,
        apiUser.statistics,
        nowIso
      );
    }

    if (!processed) {
      this.logger.warn('osu! API returned no statistics for player', {
        osuPlayerId,
      });
      await updatePlayerStatus(
        this.db,
        playerId,
        DataFetchStatus.NotFound,
        nowIso
      );
      return false;
    }

    await updatePlayerStatus(
      this.db,
      playerId,
      DataFetchStatus.Fetched,
      nowIso
    );

    return true;
  }

  private async updatePlayerCore(
    playerId: number,
    apiUser: Awaited<ReturnType<API['getUser']>>,
    nowIso: string
  ) {
    await this.db
      .update(schema.players)
      .set({
        ...playerProfileValues(apiUser),
        osuLastFetch: nowIso,
        updated: nowIso,
      })
      .where(eq(schema.players.id, playerId));
  }
}
