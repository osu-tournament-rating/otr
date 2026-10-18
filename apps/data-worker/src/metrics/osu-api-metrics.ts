import { Counter, Histogram } from 'prom-client';
import { metricsRegistry } from './registry';

export const osuApiRequests = new Counter({
  name: 'data_worker_osu_api_requests_total',
  help: 'osu! API requests',
  labelNames: ['endpoint', 'status'] as const,
  registers: [metricsRegistry],
});

export const osuApiDuration = new Histogram({
  name: 'data_worker_osu_api_duration_seconds',
  help: 'osu! API request duration',
  labelNames: ['endpoint'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

export const osuTrackApiRequests = new Counter({
  name: 'data_worker_osutrack_api_requests_total',
  help: 'osu!track API requests',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const osuTrackApiDuration = new Histogram({
  name: 'data_worker_osutrack_api_duration_seconds',
  help: 'osu!track API request duration',
  labelNames: [] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

export type OsuApiEndpoint =
  | 'getMatch'
  | 'getUser'
  | 'getBeatmap'
  | 'getBeatmapset'
  | 'getRoomEvents'
  | 'getForumTopic';

export type OsuApiStatus = 'success' | 'not_found' | 'unauthorized' | 'error';
