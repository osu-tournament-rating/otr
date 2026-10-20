import type { API, Multiplayer } from 'osu-api-v2-js';

import {
  withApiErrorHandling,
  withApiMetrics,
  type ApiCallResult,
} from '../api-helpers';
import {
  calculateScoreWithMods,
  convertModsToFlags,
  convertScoreGrade,
  convertTeam,
  normalizeDate,
  normalizeLazerMods,
} from '../conversions';
import type {
  FetchedGame,
  FetchedMatchResult,
  FetchedScore,
  PlayerMeta,
} from '../match-source';
import { resolveRulesetWithTournament } from './ruleset-utils';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import { Ruleset, ScoringType, TeamType } from '@otr/core/osu/enums';
import { coerceNumericEnumValue } from '@otr/core';

interface RoomFetchServiceOptions {
  api: API;
  rateLimiter: RateLimiter;
  logger: Logger;
}

type RoomEvents = Awaited<ReturnType<API['getRoomEvents']>>;

/** The most room events osu! returns at once, and what each page asks for. */
const ROOM_EVENTS_PAGE_SIZE = 100;

/** The team type of a realtime room type; undefined for any other. */
const roomTeamType = (roomType: string | undefined): TeamType | undefined => {
  switch (roomType) {
    case 'head_to_head':
      return TeamType.HeadToHead;
    case 'team_versus':
      return TeamType.TeamVs;
    default:
      return undefined;
  }
};

/** Reads lazer realtime rooms from the osu! API as o!TR stores them. */
export class RoomFetchService {
  private readonly api: API;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;

  constructor(options: RoomFetchServiceOptions) {
    this.api = options.api;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
  }

  /**
   * A finished realtime room with every game played in it. Rooms still in
   * progress and playlist rooms are `invalid`.
   */
  async fetchRoom(
    roomId: number,
    tournamentRuleset: Ruleset | undefined
  ): Promise<FetchedMatchResult> {
    const result = await this.fetchAllRoomEvents(roomId);
    if (result.status !== 'success') {
      return result;
    }

    const { room, events, playlist_items, users } = result.data;

    if (!room || !events) {
      return { status: 'invalid', reason: 'Invalid room data structure' };
    }

    if (!events.some((event) => event.event_type === 'room_disbanded')) {
      return {
        status: 'invalid',
        reason: 'Room is still in progress (no room_disbanded event)',
      };
    }

    const roomType = roomTeamType(room.type);
    if (roomType === undefined) {
      return {
        status: 'invalid',
        reason: `Unsupported room type ${room.type} (only realtime tournaments supported)`,
      };
    }

    const userMap = new Map<number, PlayerMeta>();
    for (const user of users ?? []) {
      userMap.set(user.id, {
        username: user.username,
        country: user.country_code,
      });
    }

    const games: FetchedGame[] = [];

    for (const playlistItem of playlist_items ?? []) {
      const gameStartedEvent = events.find(
        (event) =>
          event.event_type === 'game_started' &&
          event.playlist_item_id === playlistItem.id
      );
      const gameCompletedEvent = events.find(
        (event) =>
          event.event_type === 'game_completed' &&
          event.playlist_item_id === playlistItem.id
      );

      if (!gameStartedEvent || !gameCompletedEvent) {
        this.logger.warn('Playlist item missing start/complete events', {
          playlistItemId: playlistItem.id,
          roomId,
        });
        continue;
      }

      const rawRuleset = coerceNumericEnumValue(
        Ruleset,
        playlistItem.ruleset_id,
        Ruleset.Osu
      );
      const ruleset = resolveRulesetWithTournament(
        rawRuleset,
        tournamentRuleset ?? rawRuleset
      );
      const requiredMods = playlistItem.required_mods ?? [];
      const nowIso = new Date().toISOString();

      games.push({
        osuId: playlistItem.id,
        osuBeatmapId: playlistItem.beatmap_id,
        fields: {
          ruleset,
          scoringType: ScoringType.Lazer,
          teamType: roomType,
          mods: convertModsToFlags(requiredMods),
          lazerMods: normalizeLazerMods(requiredMods),
          startTime: normalizeDate(gameStartedEvent.created_at) ?? nowIso,
          endTime: normalizeDate(gameCompletedEvent.created_at) ?? nowIso,
        },
        scores: this.convertScores(
          playlistItem,
          ruleset,
          userMap,
          playlistItem.id
        ),
      });
    }

    return {
      status: 'success',
      match: {
        name: room.name ?? null,
        startTime: normalizeDate(room.starts_at),
        endTime: normalizeDate(room.ends_at),
        users: userMap,
        games,
        listedGameOsuIds: (playlist_items ?? []).map((item) => item.id),
      },
    };
  }

  private convertScores(
    playlistItem: Multiplayer.Room.PlaylistItem.WithDetailsScores,
    ruleset: Ruleset,
    userMap: ReadonlyMap<number, PlayerMeta>,
    gameOsuId: number
  ): FetchedScore[] {
    const scores: FetchedScore[] = [];

    for (const score of playlistItem.scores ?? []) {
      if (!userMap.has(score.user_id)) {
        this.logger.warn('Score for unknown user', {
          osuUserId: score.user_id,
          playlistItemId: gameOsuId,
        });
        continue;
      }

      scores.push({
        osuUserId: score.user_id,
        fields: convertRoomScore(
          score,
          playlistItem.details?.teams?.[score.user_id],
          ruleset
        ),
      });
    }

    return scores;
  }

  /**
   * Every event of a room with the playlist items and users they mention.
   * osu! returns the newest 100 events, so this pages back until it has the
   * room's first event: in a long match with many players and referees, the
   * joins, leaves and host changes push the earliest games past the first
   * page.
   */
  private async fetchAllRoomEvents(
    roomId: number
  ): Promise<ApiCallResult<RoomEvents>> {
    const firstPage = await this.requestRoomEvents(() =>
      this.api.getRoomEvents(roomId)
    );
    if (firstPage.status !== 'success') {
      return firstPage;
    }

    const events = new Map<number, Multiplayer.Room.Event>();
    const playlistItems = new Map<
      number,
      Multiplayer.Room.PlaylistItem.WithDetailsScores
    >();
    const users = new Map<number, RoomEvents['users'][number]>();

    const addPage = (page: RoomEvents) => {
      let added = 0;
      for (const event of page.events ?? []) {
        if (!events.has(event.id)) {
          events.set(event.id, event);
          added += 1;
        }
      }
      for (const playlistItem of page.playlist_items ?? []) {
        if (!playlistItems.has(playlistItem.id)) {
          playlistItems.set(playlistItem.id, playlistItem);
        }
      }
      for (const user of page.users ?? []) {
        users.set(user.id, user);
      }
      return added;
    };

    let pageSize = addPage(firstPage.data);
    const firstEventId = firstPage.data.first_event_id;
    const hasFirstEvent = () =>
      firstEventId == null
        ? pageSize < ROOM_EVENTS_PAGE_SIZE
        : events.has(firstEventId);

    while (events.size > 0 && !hasFirstEvent()) {
      const before = Math.min(...events.keys());
      const page = await this.requestRoomEvents(
        () =>
          this.api.request('get', ['rooms', roomId, 'events'], {
            before,
            limit: ROOM_EVENTS_PAGE_SIZE,
          }) as Promise<RoomEvents>
      );
      if (page.status !== 'success') {
        return page;
      }

      pageSize = page.data.events?.length ?? 0;
      // A page with nothing new would repeat forever.
      if (addPage(page.data) === 0) {
        break;
      }
    }

    return {
      status: 'success',
      data: {
        ...firstPage.data,
        events: [...events.values()].sort((a, b) => a.id - b.id),
        playlist_items: [...playlistItems.values()],
        users: [...users.values()],
      },
    };
  }

  private requestRoomEvents(
    request: () => Promise<RoomEvents>
  ): Promise<ApiCallResult<RoomEvents>> {
    return this.rateLimiter.schedule(() =>
      withApiMetrics('getRoomEvents', () => withApiErrorHandling(request))
    );
  }
}

/** A lazer room score's fields as stored. */
export function convertRoomScore(
  score: Multiplayer.Room.PlaylistItem.Score,
  teamColor: string | null | undefined,
  ruleset: Ruleset
): FetchedScore['fields'] {
  const stats = score.statistics ?? {};
  const mods = convertModsToFlags(score.mods ?? []);
  const rawScore = score.total_score ?? 0;
  const adjustedScore = calculateScoreWithMods(rawScore, mods);

  return {
    rawScore,
    adjustedScore: adjustedScore === rawScore ? null : adjustedScore,
    accuracy: score.accuracy,
    pp: score.pp ?? null,
    maxCombo: score.max_combo,
    pass: score.passed,
    isPerfectCombo: score.is_perfect_combo ?? false,
    legacyPerfect: score.legacy_perfect ?? false,
    grade: convertScoreGrade(score.rank),
    mods,
    lazerMods: normalizeLazerMods(score.mods ?? []),
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
    team: convertTeam(teamColor),
    ruleset,
  };
}
