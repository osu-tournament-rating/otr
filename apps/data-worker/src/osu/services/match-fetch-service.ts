import { and, eq } from 'drizzle-orm';
import type { API, Match } from 'osu-api-v2-js';

import { TournamentDataCompletionService } from './tournament-data-completion-service';
import { RoomFetchService } from './room-fetch-service';
import {
  withApiErrorHandling,
  withApiMetrics,
  type ApiCallResult,
} from '../api-helpers';
import {
  calculateScoreWithMods,
  convertModsToFlags,
  convertRuleset,
  convertScoreGrade,
  convertScoringType,
  convertTeam,
  convertTeamType,
  normalizeDate,
} from '../conversions';
import { storeFetchedGames } from '../game-store';
import type {
  FetchedGame,
  FetchedMatch,
  FetchedMatchResult,
  PlayerMeta,
} from '../match-source';
import { getOrCreatePlayerId } from '../player-store';
import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import * as schema from '@otr/core/db/schema';
import type { JobExecutor } from '@otr/core/jobs';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Ruleset } from '@otr/core/osu/enums';
import {
  findMatchHoldingGames,
  mergeMatchesInto,
} from '@otr/core/db/match-merge';
import { coerceNumericEnumValue } from '@otr/core';
import { resolveRulesetWithTournament } from './ruleset-utils';

interface MatchFetchServiceOptions {
  db: DatabaseClient;
  api: API;
  rateLimiter: RateLimiter;
  logger: Logger;
  /** Queues beatmap fetches inside the transaction that stores the games using them. */
  publishBeatmapFetches: (
    db: JobExecutor,
    osuBeatmapIds: number[]
  ) => Promise<void>;
  dataCompletion: TournamentDataCompletionService;
}

type MatchGame = NonNullable<Match.Event['game']>;

interface MatchRow {
  id: number;
  tournamentId: number;
  verificationStatus: number;
  isLazer: boolean;
}

/** A match merged into the one being fetched, whose games it now holds. */
interface MergedSource {
  osuId: number;
  isLazer: boolean;
  match: FetchedMatch;
}

export class MatchFetchService {
  private readonly db: DatabaseClient;
  private readonly api: API;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;
  private readonly publishBeatmapFetches: (
    db: JobExecutor,
    osuBeatmapIds: number[]
  ) => Promise<void>;
  private readonly dataCompletion: TournamentDataCompletionService;
  private readonly roomFetchService: RoomFetchService;

  constructor(options: MatchFetchServiceOptions) {
    this.db = options.db;
    this.api = options.api;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
    this.publishBeatmapFetches = options.publishBeatmapFetches;
    this.dataCompletion = options.dataCompletion;
    this.roomFetchService = new RoomFetchService(options);
  }

  /**
   * Fetches a match (or lazer room) from osu! and stores it with its games
   * and scores. The games of matches merged into it are fetched from their
   * own osu! matches and refreshed too.
   */
  async fetchAndPersist(
    osuMatchId: number,
    isLazer: boolean
  ): Promise<boolean> {
    const matchRow = await this.db.query.matches.findFirst({
      where: and(
        eq(schema.matches.osuId, osuMatchId),
        eq(schema.matches.isLazer, isLazer)
      ),
      columns: {
        id: true,
        tournamentId: true,
        verificationStatus: true,
        isLazer: true,
      },
      with: {
        tournament: {
          columns: {
            ruleset: true,
          },
        },
      },
    });

    if (!matchRow) {
      this.logger.error('Match record not found locally', { osuMatchId });
      return false;
    }

    const tournamentRuleset = coerceNumericEnumValue(
      Ruleset,
      matchRow.tournament?.ruleset
    );

    await this.db
      .update(schema.matches)
      .set({
        dataFetchStatus: DataFetchStatus.Fetching,
        updated: new Date().toISOString(),
      })
      .where(eq(schema.matches.id, matchRow.id));

    const result = await this.fetchMatch(
      osuMatchId,
      matchRow.isLazer,
      tournamentRuleset
    );

    if (result.status !== 'success') {
      await this.recordFetchFailure(osuMatchId, matchRow, result);
      return false;
    }

    const merged = await this.fetchMergedSources(matchRow, tournamentRuleset);
    if (merged === 'unauthorized') {
      await this.recordFetchFailure(osuMatchId, matchRow, {
        status: 'unauthorized',
      });
      return false;
    }

    const nowIso = new Date().toISOString();
    const primary = result.match;

    const mergedInto = await this.db.transaction(async (tx) => {
      // Another match holding these games means this match was merged into
      // it, so it takes its place in match_merges instead of taking the games.
      const holderMatchId = await findMatchHoldingGames(
        tx,
        matchRow.id,
        primary.listedGameOsuIds
      );

      if (holderMatchId != null) {
        await mergeMatchesInto(tx, holderMatchId, [
          {
            id: matchRow.id,
            osuId: osuMatchId,
            isLazer: matchRow.isLazer,
            name: primary.name ?? '',
            tournamentId: matchRow.tournamentId,
          },
        ]);
        return holderMatchId;
      }

      await tx
        .update(schema.matches)
        .set({
          name:
            primary.name ??
            `${matchRow.isLazer ? 'Room' : 'Match'} ${matchRow.id}`,
          startTime: primary.startTime,
          endTime: primary.endTime,
          dataFetchStatus: DataFetchStatus.Fetched,
          updated: nowIso,
        })
        .where(eq(schema.matches.id, matchRow.id));

      const sources = [primary, ...merged.map((source) => source.match)];
      const users = new Map<number, PlayerMeta>();
      for (const source of sources) {
        for (const [osuUserId, meta] of source.users) {
          users.set(osuUserId, meta);
        }
      }

      const playerIds = new Map<number, number>();
      for (const [osuUserId, meta] of users) {
        playerIds.set(
          osuUserId,
          await getOrCreatePlayerId(tx, osuUserId, meta)
        );
      }

      const beatmapsToQueue = await storeFetchedGames(tx, {
        match: matchRow,
        games: sources.flatMap((source) => source.games),
        playerIds,
        users,
        nowIso,
      });

      // Queued with the games, so a beatmap marked Fetching always has a job.
      // One batch, so its keys lock in the same order as anyone else's.
      await this.publishBeatmapFetches(tx, beatmapsToQueue);

      return null;
    });

    if (mergedInto != null) {
      this.logger.info(
        'Match games are held by another match; recorded it as merged',
        {
          osuMatchId,
          matchId: matchRow.id,
          mergedInto,
        }
      );
      await this.dataCompletion.checkAndTriggerAutomationChecksIfComplete(
        matchRow.tournamentId
      );
      return true;
    }

    await this.dataCompletion.updateMatchFetchStatus(
      matchRow.id,
      DataFetchStatus.Fetched
    );

    return true;
  }

  private fetchMatch(
    osuMatchId: number,
    isLazer: boolean,
    tournamentRuleset: Ruleset | undefined
  ): Promise<FetchedMatchResult> {
    return isLazer
      ? this.roomFetchService.fetchRoom(osuMatchId, tournamentRuleset)
      : this.fetchStableMatch(osuMatchId, tournamentRuleset);
  }

  /**
   * The matches merged into this one, read from osu!. One osu! no longer
   * serves is left out, and its games stay as they are.
   */
  private async fetchMergedSources(
    matchRow: MatchRow,
    tournamentRuleset: Ruleset | undefined
  ): Promise<MergedSource[] | 'unauthorized'> {
    const merges = await this.db
      .select({
        osuId: schema.matchMerges.osuId,
        isLazer: schema.matchMerges.isLazer,
      })
      .from(schema.matchMerges)
      .where(eq(schema.matchMerges.matchId, matchRow.id))
      .orderBy(schema.matchMerges.id);

    const sources: MergedSource[] = [];

    for (const merge of merges) {
      const result = await this.fetchMatch(
        merge.osuId,
        merge.isLazer,
        tournamentRuleset
      );

      if (result.status === 'unauthorized') {
        return 'unauthorized';
      }

      if (result.status !== 'success') {
        this.logger.warn('Skipped a merged match osu! did not serve', {
          matchId: matchRow.id,
          osuMatchId: merge.osuId,
          isLazer: merge.isLazer,
          status: result.status,
          ...(result.status === 'invalid' && { reason: result.reason }),
        });
        continue;
      }

      sources.push({ ...merge, match: result.match });
    }

    return sources;
  }

  private async recordFetchFailure(
    osuMatchId: number,
    matchRow: MatchRow,
    result: Exclude<FetchedMatchResult, { status: 'success' }>
  ) {
    const kind = matchRow.isLazer ? 'room' : 'match';

    if (result.status === 'not_found') {
      this.logger.warn(`osu! API returned no data for ${kind}`, {
        osuMatchId,
      });
      await this.dataCompletion.updateMatchFetchStatus(
        matchRow.id,
        DataFetchStatus.NotFound
      );
      return;
    }

    if (result.status === 'unauthorized') {
      this.logger.error(
        `Unauthorized fetching ${kind} - check API credentials`,
        { osuMatchId }
      );
    } else {
      this.logger.warn(result.reason, { osuMatchId });
    }

    await this.dataCompletion.updateMatchFetchStatus(
      matchRow.id,
      DataFetchStatus.Error
    );
  }

  private async fetchStableMatch(
    osuMatchId: number,
    tournamentRuleset: Ruleset | undefined
  ): Promise<FetchedMatchResult> {
    const matchResult = await this.fetchFullMatch(osuMatchId);

    if (matchResult.status !== 'success') {
      return matchResult;
    }

    const { initialMatch, allEvents, allUsers } = matchResult.data;
    const nowIso = new Date().toISOString();

    const games = (allEvents ?? [])
      .filter((event) => event?.detail?.type === 'other' && event.game != null)
      .map((event) =>
        this.convertStableGame(event.game!, tournamentRuleset, nowIso)
      );

    return {
      status: 'success',
      match: {
        name: initialMatch.match?.name ?? null,
        startTime: normalizeDate(initialMatch.match?.start_time),
        endTime: normalizeDate(initialMatch.match?.end_time),
        users: allUsers,
        games,
        listedGameOsuIds: games.map((game) => game.osuId),
      },
    };
  }

  private convertStableGame(
    game: MatchGame,
    tournamentRuleset: Ruleset | undefined,
    nowIso: string
  ): FetchedGame {
    const rawRuleset = convertRuleset(game.mode_int ?? game.mode);
    const ruleset = resolveRulesetWithTournament(
      rawRuleset,
      tournamentRuleset ?? rawRuleset
    );

    return {
      osuId: game.id,
      osuBeatmapId: game.beatmap_id,
      fields: {
        ruleset,
        scoringType: convertScoringType(game.scoring_type),
        teamType: convertTeamType(game.team_type),
        mods: convertModsToFlags(game.mods ?? []),
        lazerMods: null,
        startTime: normalizeDate(game.start_time) ?? nowIso,
        endTime: normalizeDate(game.end_time ?? game.start_time) ?? nowIso,
      },
      scores: (game.scores ?? [])
        .filter((score) => score.user_id != null)
        .map((score) => {
          const mods = convertModsToFlags(score.mods ?? []);
          const rawScore = score.total_score ?? 0;
          const adjustedScore = calculateScoreWithMods(rawScore, mods);
          const stats = score.statistics ?? {};

          return {
            osuUserId: score.user_id,
            fields: {
              rawScore,
              adjustedScore: adjustedScore === rawScore ? null : adjustedScore,
              accuracy: score.accuracy,
              pp: score.pp ?? null,
              maxCombo: score.max_combo ?? 0,
              statComboBreak: stats.combo_break ?? null,
              pass: score.passed ?? score.match?.pass ?? false,
              isPerfectCombo: score.is_perfect_combo,
              legacyPerfect: score.legacy_perfect,
              grade: convertScoreGrade(score.rank),
              mods,
              lazerMods: null,
              statGreat: stats.great ?? null,
              statOk: stats.ok ?? null,
              statMeh: stats.meh ?? null,
              statMiss: stats.miss ?? null,
              statGood: stats.good ?? null,
              statPerfect: stats.perfect ?? null,
              statSliderTailHit: stats.slider_tail_hit ?? null,
              statLargeTickHit: stats.large_tick_hit ?? null,
              statLargeTickMiss: stats.large_tick_miss ?? null,
              statSmallTickHit: stats.small_tick_hit ?? null,
              statSmallTickMiss: stats.small_tick_miss ?? null,
              statLargeBonus: stats.large_bonus ?? null,
              statSmallBonus: stats.small_bonus ?? null,
              statIgnoreHit: stats.ignore_hit ?? null,
              statIgnoreMiss: stats.ignore_miss ?? null,
              statLegacyComboIncrease: stats.legacy_combo_increase ?? null,
              legacyTotalScore: score.legacy_total_score,
              team: convertTeam(score.match?.team ?? 'none'),
              ruleset,
            },
          };
        }),
    };
  }

  private async fetchFullMatch(osuMatchId: number): Promise<
    ApiCallResult<{
      initialMatch: Match;
      allEvents: NonNullable<Match['events']>;
      allUsers: Map<number, PlayerMeta>;
    }>
  > {
    const initialResult = await this.rateLimiter.schedule(() =>
      withApiMetrics('getMatch', () =>
        withApiErrorHandling(() => this.api.getMatch(osuMatchId))
      )
    );

    if (initialResult.status !== 'success') {
      return initialResult;
    }

    const initialMatch = initialResult.data;

    const allEventsById = new Map<
      number,
      NonNullable<Match['events']>[number]
    >();
    const allUsers = new Map<number, PlayerMeta>();

    const addPage = (page: Match | null) => {
      if (!page) return { added: 0 };
      let added = 0;
      for (const user of page.users ?? []) {
        allUsers.set(user.id, {
          username: user.username,
          country: user.country_code,
        });
      }
      for (const event of page.events ?? []) {
        if (!allEventsById.has(event.id)) {
          allEventsById.set(event.id, event);
          added += 1;
        }
      }
      return { added };
    };

    addPage(initialMatch);

    const firstEventId = initialMatch.first_event_id;
    const latestEventId = initialMatch.latest_event_id;

    const limit = 100;
    let minSeenId = Infinity;
    let maxSeenId = -Infinity;
    for (const id of allEventsById.keys()) {
      if (id < minSeenId) minSeenId = id;
      if (id > maxSeenId) maxSeenId = id;
    }

    const hasFirst = () => allEventsById.has(firstEventId);
    const hasLatest = () => allEventsById.has(latestEventId);

    // Expand queries towards the start and end until both bounds are included
    while (!hasFirst() || !hasLatest()) {
      let progressed = false;

      if (!hasFirst()) {
        const query = Number.isFinite(minSeenId)
          ? { before: minSeenId, limit }
          : { after: firstEventId - 1, limit };

        const pageResult = await this.rateLimiter.schedule(() =>
          withApiMetrics('getMatch', () =>
            withApiErrorHandling(() => this.api.getMatch(osuMatchId, query))
          )
        );
        if (pageResult.status !== 'success') {
          return pageResult;
        }
        const page = pageResult.data;
        const { added } = addPage(page);
        if (added > 0) {
          progressed = true;
          for (const id of page?.events?.map((e) => e.id) ?? []) {
            if (id < minSeenId) minSeenId = id;
            if (id > maxSeenId) maxSeenId = id;
          }
        }
      }

      if (!hasLatest()) {
        const query = Number.isFinite(maxSeenId)
          ? { after: maxSeenId, limit }
          : { before: latestEventId + 1, limit };

        const pageResult = await this.rateLimiter.schedule(() =>
          withApiMetrics('getMatch', () =>
            withApiErrorHandling(() => this.api.getMatch(osuMatchId, query))
          )
        );
        if (pageResult.status !== 'success') {
          return pageResult;
        }
        const page = pageResult.data;
        const { added } = addPage(page);
        if (added > 0) {
          progressed = true;
          for (const id of page?.events?.map((e) => e.id) ?? []) {
            if (id < minSeenId) minSeenId = id;
            if (id > maxSeenId) maxSeenId = id;
          }
        }
      }

      // Avoid infinite loops in abnormal cases
      if (!progressed) {
        break;
      }
    }

    const allEvents = Array.from(allEventsById.values()).sort(
      (a, b) => a.id - b.id
    );

    return { status: 'success', data: { initialMatch, allEvents, allUsers } };
  }
}
