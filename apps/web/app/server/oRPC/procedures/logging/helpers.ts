import type { ActorInfo } from './types';

type OsuIdValue = bigint | number | string | null | undefined;

type SessionSnapshot = {
  user?: { osuId?: OsuIdValue } | null;
  dbUser?: { id?: number | null } | null;
  dbPlayer?: {
    id?: number | null;
    osuId?: OsuIdValue;
    username?: string | null;
  } | null;
};

type ApiKeyActor = {
  userId: string;
  playerId: number | null;
  osuId: number | null;
  osuUsername: string | null;
};

type VerifiedApiKey = {
  id: string;
  userId: string;
  name: string | null;
  enabled: boolean;
};

interface ActorResolutionContext {
  apiKey?: VerifiedApiKey | null;
  apiKeyActor?: ApiKeyActor | null;
  session?: SessionSnapshot | null;
}

function normalizeOsuId(value: OsuIdValue): string | null {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  return null;
}

function maskApiKey(value: string): string {
  if (value.length <= 5) {
    return '*****';
  }

  return `${value.slice(0, 5)}...`;
}

export function resolveActor(context: ActorResolutionContext): ActorInfo {
  // The key was accepted even when looking up its owner failed, so the call
  // still counts as the key's, under its user ID
  if (context.apiKey) {
    const owner = context.apiKeyActor;

    return {
      accessMethod: 'api-key',
      userId: context.apiKey.userId,
      playerId: owner?.playerId ?? null,
      osuId: owner?.osuId ? String(owner.osuId) : null,
      osuUsername: owner?.osuUsername ?? null,
      apiKeyId: maskApiKey(context.apiKey.id),
      apiKeyName: context.apiKey.name,
    };
  }

  if (context.session) {
    const session = context.session;
    const osuId =
      normalizeOsuId(session.user?.osuId) ??
      normalizeOsuId(session.dbPlayer?.osuId);

    return {
      accessMethod: 'session',
      userId: session.dbUser?.id != null ? String(session.dbUser.id) : null,
      playerId: session.dbPlayer?.id ?? null,
      osuId,
      osuUsername: session.dbPlayer?.username ?? null,
      apiKeyId: null,
      apiKeyName: null,
    };
  }

  return {
    accessMethod: 'anonymous',
    userId: null,
    playerId: null,
    osuId: null,
    osuUsername: null,
    apiKeyId: null,
    apiKeyName: null,
  };
}

export function formatUserDescriptor(actor: ActorInfo): string {
  if (actor.osuUsername) {
    return actor.osuUsername;
  }

  if (actor.playerId != null) {
    return `player:${actor.playerId}`;
  }

  if (actor.osuId) {
    return `osu:${actor.osuId}`;
  }

  if (actor.userId) {
    return actor.accessMethod === 'api-key'
      ? `auth:${actor.userId}`
      : `user:${actor.userId}`;
  }

  return 'anonymous';
}

export function formatProcedurePath(path: readonly string[]): string {
  return path.length > 0 ? path.join('.') : 'unknown';
}

export function getCorrelationId(context: unknown): string | undefined {
  if (
    context &&
    typeof context === 'object' &&
    'logging' in context &&
    context.logging &&
    typeof context.logging === 'object' &&
    'correlationId' in context.logging
  ) {
    return context.logging.correlationId as string;
  }
  return undefined;
}
