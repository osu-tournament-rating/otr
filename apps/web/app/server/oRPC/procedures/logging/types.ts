import type { Logger } from '@otr/core/logging';

export type AccessMethod = 'session' | 'api-key' | 'anonymous';

export interface ActorInfo {
  accessMethod: AccessMethod;
  userId: string | null;
  playerId: number | null;
  osuId: string | null;
  osuUsername: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
}

export interface RequestLoggingContext {
  correlationId: string;
  actor: ActorInfo;
  procedurePath: string;
  requestPath: string | null;
  /** browser or internal on /rpc, api on the REST API. */
  caller: 'browser' | 'internal' | 'api' | 'unknown';
  /** The caller's IP as a daily-rotating ID (`sourceId`), when known. */
  source: string | null;
  startTime: number;
  logger: Logger;
}
