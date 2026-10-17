import { eq } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import { withApiErrorHandling, withApiMetrics } from '../api-helpers';
import { ensurePlayerPlaceholder, updatePlayerStatus } from '../player-store';
import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu/enums';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

const FETCHABLE_RULESETS = [
  Ruleset.Osu,
  Ruleset.Taiko,
  Ruleset.Catch,
  Ruleset.ManiaOther,
] as const;

const MANIA_VARIANT_MAP: Record<string, Ruleset> = {
  '4k': Ruleset.Mania4k,
  '7k': Ruleset.Mania7k,
};

type RulesetConfig = (typeof FETCHABLE_RULESETS)[number];

const normalizePreviousUsernames = (
  values: readonly string[] | null | undefined,
  currentUsername: string
): string[] => {
  const seen = new Set([currentUsername.trim().toLowerCase()]);
  const names: string[] = [];

  for (const value of values ?? []) {
    const name = value?.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
  }

  return names;
};

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

      await this.updateRulesetData(playerId, ruleset, apiUser, nowIso);
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
    const updatedCountry = apiUser.country?.code ?? apiUser.country_code ?? '';
    const username = apiUser.username ?? '';

    await this.db
      .update(schema.players)
      .set({
        username,
        previousUsernames: normalizePreviousUsernames(
          apiUser.previous_usernames,
          username
        ),
        country: updatedCountry,
        osuLastFetch: nowIso,
        updated: nowIso,
      })
      .where(eq(schema.players.id, playerId));
  }

  private async updateRulesetData(
    playerId: number,
    ruleset: RulesetConfig,
    apiUser: Awaited<ReturnType<API['getUser']>>,
    nowIso: string
  ) {
    const stats = apiUser.statistics;

    if (ruleset === Ruleset.ManiaOther) {
      await this.upsertRulesetData({
        playerId,
        ruleset,
        pp: stats?.pp ?? 0,
        globalRank: stats?.global_rank ?? null,
        updated: nowIso,
      });

      const variants = (
        stats as unknown as {
          variants?: Array<Record<string, unknown>>;
        }
      )?.variants;

      if (Array.isArray(variants)) {
        for (const variant of variants) {
          const hasRanking =
            (variant as { is_ranked?: boolean }).is_ranked ||
            (variant as { global_rank?: unknown }).global_rank !== undefined;

          if (!hasRanking) {
            continue;
          }

          const mappedRuleset =
            MANIA_VARIANT_MAP[
              String(
                (variant as { variant?: string }).variant ?? ''
              ).toLowerCase()
            ];

          if (!mappedRuleset) {
            continue;
          }

          await this.upsertRulesetData({
            playerId,
            ruleset: mappedRuleset,
            pp: Number((variant as { pp?: number }).pp ?? 0),
            globalRank:
              (variant as { global_rank?: number | null }).global_rank ?? null,
            updated: nowIso,
          });
        }
      }

      return;
    }

    await this.upsertRulesetData({
      playerId,
      ruleset,
      pp: stats?.pp ?? 0,
      globalRank: stats?.global_rank ?? null,
      updated: nowIso,
    });
  }

  private async upsertRulesetData(options: {
    playerId: number;
    ruleset: Ruleset;
    pp: number;
    globalRank: number | null;
    updated: string;
  }) {
    await this.db
      .insert(schema.playerOsuRulesetData)
      .values({
        playerId: options.playerId,
        ruleset: options.ruleset,
        pp: options.pp,
        globalRank: options.globalRank,
        updated: options.updated,
      })
      .onConflictDoUpdate({
        target: [
          schema.playerOsuRulesetData.playerId,
          schema.playerOsuRulesetData.ruleset,
        ],
        set: {
          pp: options.pp,
          globalRank: options.globalRank,
          updated: options.updated,
        },
      });
  }
}
