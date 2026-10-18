import type { UserStatUpdate } from '@otr/core';
import {
  apiRequestStats,
  osuTrackApiRequests,
  osuTrackApiDuration,
} from '../metrics';

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const OSU_TRACK_BASE_URL = 'https://osutrack-api.ameo.dev';

export interface OsuTrackClientOptions {
  fetchImpl?: FetchFunction;
  defaultMode?: number;
}

export interface FetchUserStatsHistoryOptions {
  osuPlayerId: number;
  mode?: number;
  from?: string;
  to?: string;
}

interface RawUserStatUpdate {
  count300: number | string;
  count100: number | string;
  count50: number | string;
  playcount: number | string;
  ranked_score: number | string;
  total_score: number | string;
  pp_rank: number | string;
  level: number | string;
  pp_raw: number | string;
  accuracy: number | string;
  count_rank_ss: number | string;
  count_rank_s: number | string;
  count_rank_a: number | string;
  timestamp: string;
}

const toNumber = (value: number | string, field: string) => {
  const numeric = typeof value === 'string' ? Number(value) : value;

  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid numeric value for ${field}`);
  }

  return numeric;
};

const toDate = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid timestamp received from osu!track: ${value}`);
  }

  return date;
};

const mapUserStatUpdate = (raw: RawUserStatUpdate): UserStatUpdate => ({
  count300: toNumber(raw.count300, 'count300'),
  count100: toNumber(raw.count100, 'count100'),
  count50: toNumber(raw.count50, 'count50'),
  playCount: toNumber(raw.playcount, 'playcount'),
  rankedScore: toNumber(raw.ranked_score, 'ranked_score'),
  totalScore: toNumber(raw.total_score, 'total_score'),
  rank: toNumber(raw.pp_rank, 'pp_rank'),
  level: toNumber(raw.level, 'level'),
  pp: toNumber(raw.pp_raw, 'pp_raw'),
  accuracy: toNumber(raw.accuracy, 'accuracy'),
  countSs: toNumber(raw.count_rank_ss, 'count_rank_ss'),
  countS: toNumber(raw.count_rank_s, 'count_rank_s'),
  countA: toNumber(raw.count_rank_a, 'count_rank_a'),
  timestamp: toDate(raw.timestamp),
});

export class OsuTrackClient {
  private readonly fetchImpl: FetchFunction;
  private readonly defaultMode: number;

  constructor(options: OsuTrackClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultMode = options.defaultMode ?? 0;
  }

  async fetchUserStatsHistory(
    options: FetchUserStatsHistoryOptions
  ): Promise<UserStatUpdate[]> {
    const mode = options.mode ?? this.defaultMode;
    const url = new URL(`${OSU_TRACK_BASE_URL}/stats_history`);
    url.searchParams.set('user', String(options.osuPlayerId));
    url.searchParams.set('mode', String(mode));

    if (options.from) {
      url.searchParams.set('from', options.from);
    }

    if (options.to) {
      url.searchParams.set('to', options.to);
    }

    const start = Date.now();
    let status: 'success' | 'error' = 'error';

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `osu!track API request failed with status ${response.status}`
        );
      }

      const data = (await response.json()) as RawUserStatUpdate[] | null;

      status = 'success';

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map(mapUserStatUpdate);
    } finally {
      const durationMs = Date.now() - start;
      osuTrackApiRequests.labels({ status }).inc();
      osuTrackApiDuration.observe(durationMs / 1000);
      apiRequestStats.record('osutrack', 'statsHistory', status, durationMs);
    }
  }
}
