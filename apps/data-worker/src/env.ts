import { loadRootEnv } from '../../../lib/env/load-root-env';
import { parseBeatmapFilesEnv } from './beatmap-attributes/env';

loadRootEnv();

const requireEnv = (name: keyof NodeJS.ProcessEnv) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const parseIntegerEnv = (name: keyof NodeJS.ProcessEnv) => {
  const raw = requireEnv(name);
  const value = Number.parseInt(raw, 10);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a valid integer`);
  }

  return value;
};

const parsePositiveIntegerEnv = (name: keyof NodeJS.ProcessEnv) => {
  const value = parseIntegerEnv(name);

  if (value <= 0) {
    throw new Error(`${String(name)} must be a positive integer`);
  }

  return value;
};

const parseBooleanEnv = (name: keyof NodeJS.ProcessEnv) => {
  const raw = requireEnv(name).trim().toLowerCase();

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  throw new Error(`${String(name)} must be either "true" or "false"`);
};

const parseBooleanEnvWithDefault = (
  name: keyof NodeJS.ProcessEnv,
  defaultValue: boolean
) => {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error(`${String(name)} must be either "true" or "false"`);
};

const osuClientId = parseIntegerEnv('DATA_WORKER_OSU_CLIENT_ID');

const parseRateLimit = (
  requestsKey: keyof NodeJS.ProcessEnv,
  windowSecondsKey: keyof NodeJS.ProcessEnv
) => {
  const requests = parseIntegerEnv(requestsKey);
  const windowSeconds = parseIntegerEnv(windowSecondsKey);

  if (requests <= 0) {
    throw new Error(`${String(requestsKey)} must be a positive integer`);
  }

  if (windowSeconds <= 0) {
    throw new Error(`${String(windowSecondsKey)} must be a positive integer`);
  }

  return {
    requests,
    windowSeconds,
  } as const;
};

const osuApiRateLimit = parseRateLimit(
  'OSU_API_RATE_LIMIT_REQUESTS',
  'OSU_API_RATE_LIMIT_WINDOW_SECONDS'
);

const osuTrackRateLimit = parseRateLimit(
  'OSUTRACK_API_RATE_LIMIT_REQUESTS',
  'OSUTRACK_API_RATE_LIMIT_WINDOW_SECONDS'
);

const playerOsuAutoRefetch = {
  enabled: parseBooleanEnv('PLAYER_OSU_AUTO_REFETCH_ENABLED'),
  intervalMinutes: parsePositiveIntegerEnv(
    'PLAYER_OSU_REFETCH_INTERVAL_MINUTES'
  ),
  outdatedDays: parsePositiveIntegerEnv('PLAYER_OSU_REFETCH_OUTDATED_DAYS'),
} as const;

const playerOsuTrackAutoRefetch = {
  enabled: parseBooleanEnv('PLAYER_OSUTRACK_AUTO_REFETCH_ENABLED'),
  intervalMinutes: parsePositiveIntegerEnv(
    'PLAYER_OSUTRACK_REFETCH_INTERVAL_MINUTES'
  ),
  outdatedDays: parsePositiveIntegerEnv(
    'PLAYER_OSUTRACK_REFETCH_OUTDATED_DAYS'
  ),
} as const;

export const dataWorkerEnv = {
  osuClientId,
  osuClientSecret: requireEnv('DATA_WORKER_OSU_CLIENT_SECRET'),
  osuApiRateLimit,
  osuTrackRateLimit,
  maintenanceWindowEnabled: parseBooleanEnvWithDefault(
    'MAINTENANCE_WINDOW_ENABLED',
    true
  ),
  playerAutoRefetch: {
    osu: playerOsuAutoRefetch,
    osuTrack: playerOsuTrackAutoRefetch,
  },
  // Unlike the settings above, a bad value here does not throw: it turns the
  // feature off and the rest of the worker keeps running.
  beatmapFiles: parseBeatmapFilesEnv(process.env),
} as const;

export type DataWorkerEnv = typeof dataWorkerEnv;
