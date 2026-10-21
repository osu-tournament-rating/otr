import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '../db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import type { PlayerFetchState } from '@otr/core/db/player-fetch-lease';

type DbExecutor = Pick<DatabaseClient, 'query' | 'insert' | 'update'>;
type UpdateExecutor = Pick<DatabaseClient, 'update'>;
type QueryExecutor = Pick<DatabaseClient, 'query'>;

export interface PlayerRecord {
  id: number;
  dataFetchStatus: number;
}

export const getOrCreatePlayerId = async (
  db: DbExecutor,
  osuPlayerId: number,
  overrides?: { username?: string; country?: string }
): Promise<number> => {
  const existing = await db.query.players.findFirst({
    where: eq(schema.players.osuId, osuPlayerId),
    columns: {
      id: true,
    },
  });

  if (existing) {
    if (overrides?.username || overrides?.country) {
      await db
        .update(schema.players)
        .set({
          ...(overrides.username ? { username: overrides.username } : {}),
          ...(overrides.country ? { country: overrides.country } : {}),
        })
        .where(eq(schema.players.id, existing.id));
    }

    return existing.id;
  }

  const [inserted] = await db
    .insert(schema.players)
    .values({
      osuId: osuPlayerId,
      username: overrides?.username ?? '',
      country: overrides?.country ?? '',
    })
    .returning({ id: schema.players.id });

  if (!inserted) {
    throw new Error('Failed to create player record');
  }

  return inserted.id;
};

export const ensurePlayerPlaceholder = async (
  db: DbExecutor,
  osuPlayerId: number,
  status: number,
  updatedIso: string
): Promise<PlayerRecord> => {
  const existing = await db.query.players.findFirst({
    where: eq(schema.players.osuId, osuPlayerId),
    columns: {
      id: true,
      dataFetchStatus: true,
    },
  });

  if (existing) {
    return existing;
  }

  const [inserted] = await db
    .insert(schema.players)
    .values({
      osuId: osuPlayerId,
      dataFetchStatus: status,
      ...(status === DataFetchStatus.Fetching
        ? { osuLastFetch: updatedIso }
        : {}),
      updated: updatedIso,
    })
    .onConflictDoNothing()
    .returning({
      id: schema.players.id,
      dataFetchStatus: schema.players.dataFetchStatus,
    });

  if (inserted) {
    return inserted;
  }

  const fallback = await db.query.players.findFirst({
    where: eq(schema.players.osuId, osuPlayerId),
    columns: {
      id: true,
      dataFetchStatus: true,
    },
  });

  if (!fallback) {
    throw new Error('Failed to upsert player placeholder');
  }

  return fallback;
};

/**
 * Whether a fetch that ended in `status` says the player is restricted on
 * osu!. osu! answers not found for a restricted player and never says so
 * outright, so not found marks them restricted and a successful fetch clears
 * it. Any other status leaves the flag as it was.
 */
const restrictedAfter = (status: number): { restricted?: boolean } => {
  if (status === DataFetchStatus.NotFound) {
    return { restricted: true };
  }

  if (status === DataFetchStatus.Fetched) {
    return { restricted: false };
  }

  return {};
};

export const updatePlayerStatus = async (
  db: UpdateExecutor,
  playerId: number,
  status: number,
  updatedIso: string
) => {
  await db
    .update(schema.players)
    .set({
      dataFetchStatus: status,
      osuLastFetch: updatedIso,
      updated: updatedIso,
      ...restrictedAfter(status),
    })
    .where(eq(schema.players.id, playerId));
};

export const getPlayerOsuFetchState = async (
  db: QueryExecutor,
  osuPlayerId: number
): Promise<PlayerFetchState | null> => {
  const player = await db.query.players.findFirst({
    where: eq(schema.players.osuId, osuPlayerId),
    columns: {
      dataFetchStatus: true,
      osuLastFetch: true,
    },
  });

  return player
    ? { status: player.dataFetchStatus, lastFetch: player.osuLastFetch }
    : null;
};
