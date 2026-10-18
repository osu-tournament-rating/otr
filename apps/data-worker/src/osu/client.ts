import { API, type Scope } from 'osu-api-v2-js';
import { dataWorkerEnv } from '../env';

export type {
  Beatmap,
  Beatmapset,
  Match,
  Multiplayer,
  Score,
  User,
  Scope,
} from 'osu-api-v2-js';
export { APIError } from 'osu-api-v2-js';

export interface CreateOsuApiClientOptions {
  scopes?: Scope[];
  server?: string;
}

export const createOsuApiClient = async (
  options: CreateOsuApiClientOptions = {}
) => {
  const api = await API.createAsync(
    dataWorkerEnv.osuClientId,
    dataWorkerEnv.osuClientSecret
  );

  if (options.server) {
    api.server = options.server;
  }

  if (options.scopes) {
    api.scopes = options.scopes;
  }

  // A 429 reaches the job, which waits as long as osu! asks; the client's own
  // retries wait a fixed 2 seconds.
  api.retry_on_status_codes = [];

  return api;
};
