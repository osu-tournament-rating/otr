import { and, eq, not } from 'drizzle-orm';
import type { API, Multiplayer } from 'osu-api-v2-js';

import {
  ensureBeatmapPlaceholder,
  updateBeatmapStatus,
} from '../beatmap-store';
import { TournamentDataCompletionService } from './tournament-data-completion-service';
import { withApiErrorHandling, withApiMetrics } from '../api-helpers';
import {
  calculateScoreWithMods,
  convertModsToFlags,
  convertScoreGrade,
  convertTeam,
  normalizeDate,
  normalizeLazerMods,
} from '../conversions';
import { getOrCreatePlayerId } from '../player-store';
import { resolveRulesetWithTournament } from './ruleset-utils';
import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import {
  GameRejectionReason,
  Ruleset,
  ScoringType,
  ScoreRejectionReason,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu/enums';
import {
  cascadeGameRejection,
  cascadeMatchRejection,
} from '@otr/core/db/rejection-cascade';
import {
  findMatchHoldingGames,
  mergeMatchesInto,
} from '@otr/core/db/match-merge';
import { coerceNumericEnumValue } from '@otr/core';

interface RoomFetchServiceOptions {
  db: DatabaseClient;
  api: API;
  rateLimiter: RateLimiter;
  logger: Logger;
  publishBeatmapFetch: (osuBeatmapId: number) => Promise<void>;
  dataCompletion: TournamentDataCompletionService;
}

interface MatchRow {
  id: number;
  tournamentId: number;
  dataFetchStatus: number;
  verificationStatus: number;
  isLazer: boolean;
  tournament?: { id: number; ruleset: number } | null;
}

export class RoomFetchService {
  private readonly db: DatabaseClient;
  private readonly api: API;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;
  private readonly publishBeatmapFetch: (osuBeatmapId: number) => Promise<void>;
  private readonly dataCompletion: TournamentDataCompletionService;

  constructor(options: RoomFetchServiceOptions) {
    this.db = options.db;
    this.api = options.api;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
    this.publishBeatmapFetch = options.publishBeatmapFetch;
    this.dataCompletion = options.dataCompletion;
  }

  async fetchAndPersistRoom(
    roomId: number,
    matchRow: MatchRow
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const tournamentRuleset = coerceNumericEnumValue(
      Ruleset,
      matchRow.tournament?.ruleset
    );

    await this.db
      .update(schema.matches)
      .set({ dataFetchStatus: DataFetchStatus.Fetching, updated: nowIso })
      .where(eq(schema.matches.id, matchRow.id));

    const roomResult = await this.rateLimiter.schedule(() =>
      withApiMetrics('getRoomEvents', () =>
        withApiErrorHandling(() => this.api.getRoomEvents(roomId))
      )
    );

    if (roomResult.status === 'unauthorized') {
      this.logger.error('Unauthorized fetching room - check API credentials', {
        roomId,
      });
      await this.dataCompletion.updateMatchFetchStatus(
        matchRow.id,
        DataFetchStatus.Error
      );
      return false;
    }

    if (roomResult.status === 'not_found') {
      await this.dataCompletion.updateMatchFetchStatus(
        matchRow.id,
        DataFetchStatus.NotFound
      );
      this.logger.warn('osu! API returned no data for room', { roomId });
      return false;
    }

    const { room, events, playlist_items, users } = roomResult.data;

    if (!room || !events) {
      this.logger.warn('Invalid room data structure', { roomId });
      await this.dataCompletion.updateMatchFetchStatus(
        matchRow.id,
        DataFetchStatus.Error
      );
      return false;
    }

    const disbandedEvent = events.find(
      (e: Multiplayer.Room.Event) => e.event_type === 'room_disbanded'
    );
    if (!disbandedEvent) {
      this.logger.warn('Room is still in progress (no room_disbanded event)', {
        roomId,
      });
      await this.dataCompletion.updateMatchFetchStatus(
        matchRow.id,
        DataFetchStatus.Error
      );
      return false;
    }

    if (room.type !== 'team_versus' && room.type !== 'head_to_head') {
      this.logger.warn(
        'Unsupported room type (only realtime tournaments supported)',
        {
          roomId,
          roomType: room.type,
        }
      );
      await this.dataCompletion.updateMatchFetchStatus(
        matchRow.id,
        DataFetchStatus.Error
      );
      return false;
    }

    const beatmapsToQueue = new Map<number, { beatmapDbId: number }>();

    const mergedInto = await this.db.transaction(async (tx) => {
      // Another match holding these games means this room was merged into
      // it, so it takes its place in match_merges instead of taking the games.
      const holderMatchId = await findMatchHoldingGames(
        tx,
        matchRow.id,
        (playlist_items ?? []).map((playlistItem) => playlistItem.id)
      );

      if (holderMatchId != null) {
        await mergeMatchesInto(tx, holderMatchId, [
          {
            id: matchRow.id,
            osuId: roomId,
            isLazer: true,
            name: room.name ?? '',
            tournamentId: matchRow.tournamentId,
          },
        ]);
        return holderMatchId;
      }

      await tx
        .update(schema.matches)
        .set({
          name: room.name ?? `Room ${matchRow.id}`,
          startTime: normalizeDate(room.starts_at) ?? null,
          endTime: normalizeDate(room.ends_at) ?? null,
          dataFetchStatus: DataFetchStatus.Fetched,
          updated: nowIso,
        })
        .where(eq(schema.matches.id, matchRow.id));

      const userMap = new Map<
        number,
        { username?: string; country?: string }
      >();
      for (const user of users ?? []) {
        const meta = {
          username: user.username,
          country: user.country_code,
        };
        userMap.set(user.id, meta);
        await getOrCreatePlayerId(tx, user.id, meta);
      }

      const isMatchRejected =
        matchRow.verificationStatus === VerificationStatus.Rejected;
      const rejectedGameIds = new Set<number>();

      for (const playlistItem of playlist_items ?? []) {
        const rawRuleset = coerceNumericEnumValue(
          Ruleset,
          playlistItem.ruleset_id,
          Ruleset.Osu
        );
        const ruleset = resolveRulesetWithTournament(
          rawRuleset,
          tournamentRuleset ?? rawRuleset
        );

        const mods = convertModsToFlags(playlistItem.required_mods ?? []);
        const lazerMods = normalizeLazerMods(playlistItem.required_mods ?? []);

        const beatmapRecord = await ensureBeatmapPlaceholder(
          tx,
          playlistItem.beatmap_id,
          DataFetchStatus.NotFetched,
          nowIso
        );

        if (beatmapRecord.dataFetchStatus === DataFetchStatus.NotFetched) {
          const [marked] = await tx
            .update(schema.beatmaps)
            .set({
              dataFetchStatus: DataFetchStatus.Fetching,
              updated: nowIso,
            })
            .where(
              and(
                eq(schema.beatmaps.id, beatmapRecord.id),
                eq(schema.beatmaps.dataFetchStatus, DataFetchStatus.NotFetched),
                not(schema.beatmaps.manualOverride)
              )
            )
            .returning({ id: schema.beatmaps.id });

          if (marked) {
            beatmapsToQueue.set(playlistItem.beatmap_id, {
              beatmapDbId: beatmapRecord.id,
            });
          }
        }

        const gameStartedEvent = events.find(
          (e: Multiplayer.Room.Event) =>
            e.event_type === 'game_started' &&
            e.playlist_item_id === playlistItem.id
        );
        const gameCompletedEvent = events.find(
          (e: Multiplayer.Room.Event) =>
            e.event_type === 'game_completed' &&
            e.playlist_item_id === playlistItem.id
        );

        if (!gameStartedEvent || !gameCompletedEvent) {
          this.logger.warn('Playlist item missing start/complete events', {
            playlistItemId: playlistItem.id,
            roomId,
          });
          continue;
        }

        const existingGame = await tx.query.games.findFirst({
          where: and(
            eq(schema.games.matchId, matchRow.id),
            eq(schema.games.osuId, playlistItem.id)
          ),
          columns: {
            id: true,
            verificationStatus: true,
          },
        });

        const scoringType = ScoringType.Lazer;
        const teamType =
          room.type === 'team_versus'
            ? TeamType.TeamVs
            : room.type === 'head_to_head'
              ? TeamType.HeadToHead
              : undefined;

        if (teamType === undefined) {
          throw new Error(`Unsupported room type: ${room.type}`);
        }

        const gameValues = {
          matchId: matchRow.id,
          beatmapId: beatmapRecord.id,
          ruleset,
          scoringType,
          teamType,
          mods,
          lazerMods,
          startTime: normalizeDate(gameStartedEvent.created_at) ?? nowIso,
          endTime: normalizeDate(gameCompletedEvent.created_at) ?? nowIso,
          updated: nowIso,
        };

        let gameId: number;
        let gameVerificationStatus = existingGame?.verificationStatus;

        if (existingGame) {
          await tx
            .update(schema.games)
            .set(gameValues)
            .where(eq(schema.games.id, existingGame.id));
          gameId = existingGame.id;
        } else {
          let verificationStatus = VerificationStatus.None;
          let rejectionReason = 0;

          if (matchRow.verificationStatus === VerificationStatus.Rejected) {
            verificationStatus = VerificationStatus.Rejected;
            rejectionReason = GameRejectionReason.RejectedMatch;
          }

          const [insertedGame] = await tx
            .insert(schema.games)
            .values({
              osuId: playlistItem.id,
              ...gameValues,
              verificationStatus,
              rejectionReason,
              warningFlags: 0,
            })
            .returning({
              id: schema.games.id,
              verificationStatus: schema.games.verificationStatus,
            });

          gameId = insertedGame.id;
          gameVerificationStatus = insertedGame.verificationStatus;

          if (verificationStatus === VerificationStatus.Rejected) {
            rejectedGameIds.add(gameId);
          }
        }

        await this.processRoomScores(
          tx,
          playlistItem.scores ?? [],
          playlistItem,
          gameId,
          ruleset,
          userMap,
          matchRow.verificationStatus,
          gameVerificationStatus ?? VerificationStatus.None
        );
      }

      if (isMatchRejected) {
        await cascadeMatchRejection(tx, [matchRow.id], {
          updatedAt: nowIso,
        });
      } else if (rejectedGameIds.size > 0) {
        await cascadeGameRejection(tx, Array.from(rejectedGameIds), {
          updatedAt: nowIso,
        });
      }

      return null;
    });

    if (mergedInto != null) {
      this.logger.info(
        'Room games are held by another match; recorded it as merged',
        {
          roomId,
          matchId: matchRow.id,
          mergedInto,
        }
      );
      await this.dataCompletion.checkAndTriggerAutomationChecksIfComplete(
        matchRow.tournamentId
      );
      return true;
    }

    for (const [osuBeatmapId, { beatmapDbId }] of beatmapsToQueue) {
      try {
        await this.publishBeatmapFetch(osuBeatmapId);
      } catch (error) {
        await updateBeatmapStatus(
          this.db,
          beatmapDbId,
          DataFetchStatus.NotFetched,
          new Date().toISOString()
        );
        throw error;
      }
    }

    await this.dataCompletion.updateMatchFetchStatus(
      matchRow.id,
      DataFetchStatus.Fetched
    );
    return true;
  }

  private async processRoomScores(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    scores: Multiplayer.Room.PlaylistItem.Score[],
    playlistItem: Multiplayer.Room.PlaylistItem.WithDetailsScores,
    gameId: number,
    ruleset: Ruleset,
    userMap: Map<number, { username?: string; country?: string }>,
    matchVerificationStatus: number,
    gameVerificationStatus: number
  ): Promise<void> {
    for (const score of scores) {
      const osuUserId = score.user_id;
      const meta = userMap.get(osuUserId);
      if (!meta) {
        this.logger.warn('Score for unknown user', { osuUserId, gameId });
        continue;
      }

      const playerId = await getOrCreatePlayerId(tx, osuUserId, meta);

      const stats = score.statistics;
      const teamColor = playlistItem.details.teams?.[osuUserId];
      const team = convertTeam(teamColor);
      const grade = convertScoreGrade(score.rank);
      const mods = convertModsToFlags(score.mods ?? []);
      const lazerMods = normalizeLazerMods(score.mods ?? []);
      const rawScore = score.total_score ?? 0;
      const adjustedScore = calculateScoreWithMods(rawScore, mods);

      const baseValues = {
        rawScore,
        adjustedScore: adjustedScore === rawScore ? null : adjustedScore,
        placement: 0,
        accuracy: score.accuracy,
        pp: score.pp,
        maxCombo: score.max_combo,
        pass: score.passed,
        isPerfectCombo: score.is_perfect_combo ?? false,
        legacyPerfect: score.legacy_perfect ?? false,
        grade,
        mods,
        lazerMods,
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
        statComboBreak: stats.combo_break ?? null,
        legacyTotalScore: score.legacy_total_score,
        team,
        ruleset,
      };

      const existing = await tx.query.gameScores.findFirst({
        where: and(
          eq(schema.gameScores.gameId, gameId),
          eq(schema.gameScores.playerId, playerId)
        ),
        columns: {
          id: true,
          verificationStatus: true,
        },
      });

      if (existing) {
        let verificationStatus = existing.verificationStatus;
        let rejectionReason = 0;

        if (
          matchVerificationStatus === VerificationStatus.Rejected ||
          gameVerificationStatus === VerificationStatus.Rejected
        ) {
          verificationStatus = VerificationStatus.Rejected;
          rejectionReason = ScoreRejectionReason.RejectedGame;
        }

        await tx
          .update(schema.gameScores)
          .set({
            ...baseValues,
            updated: new Date().toISOString(),
            verificationStatus,
            rejectionReason,
          })
          .where(eq(schema.gameScores.id, existing.id));

        continue;
      }

      let verificationStatus = VerificationStatus.None;
      let rejectionReason = 0;

      if (
        matchVerificationStatus === VerificationStatus.Rejected ||
        gameVerificationStatus === VerificationStatus.Rejected
      ) {
        verificationStatus = VerificationStatus.Rejected;
        rejectionReason = ScoreRejectionReason.RejectedGame;
      }

      await tx.insert(schema.gameScores).values({
        gameId,
        playerId,
        ...baseValues,
        verificationStatus,
        rejectionReason,
      });
    }
  }
}
