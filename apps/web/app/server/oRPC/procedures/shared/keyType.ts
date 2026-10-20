import { eq } from 'drizzle-orm';
import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';

export const KeyTypeSchema = z.enum(['otr', 'osu', 'username']).default('otr');
export type KeyType = z.infer<typeof KeyTypeSchema>;

const INVALID_PLAYER_ID_MESSAGE =
  'Player ID is not a number. To look up a player by username, pass keyType=username.';

/**
 * The client error `resolvePlayerId` throws. A procedure that calls it
 * declares these with `.errors()`, so the API reference documents the 400.
 */
export const playerIdErrors = {
  INVALID_PLAYER_ID: { status: 400, message: INVALID_PLAYER_ID_MESSAGE },
} as const;

export async function resolvePlayerId(
  db: DatabaseClient,
  id: number | string,
  keyType: KeyType
): Promise<number> {
  if (keyType === 'username') {
    const username = String(id);
    const player = await db.query.players.findFirst({
      where: (players, { ilike }) => ilike(players.username, username),
      columns: { id: true },
    });
    if (!player) {
      throw new ORPCError('NOT_FOUND', { message: 'Player not found' });
    }
    return player.id;
  }

  // The public API passes every ID as text. Without this, a username reaches
  // Postgres as NaN and fails as a server error.
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId)) {
    throw new ORPCError('INVALID_PLAYER_ID', {
      status: 400,
      message: INVALID_PLAYER_ID_MESSAGE,
    });
  }

  if (keyType === 'otr') {
    const player = await db.query.players.findFirst({
      where: (players, { eq }) => eq(players.id, numericId),
      columns: { id: true },
    });
    if (!player) {
      throw new ORPCError('NOT_FOUND', { message: 'Player not found' });
    }
    return player.id;
  }

  const player = await db.query.players.findFirst({
    where: (players, { eq }) => eq(players.osuId, numericId),
    columns: { id: true },
  });
  if (!player) {
    throw new ORPCError('NOT_FOUND', { message: 'Player not found' });
  }
  return player.id;
}

export async function resolveMatchId(
  db: DatabaseClient,
  id: number,
  keyType: KeyType
): Promise<number> {
  const column = keyType === 'otr' ? schema.matches.id : schema.matches.osuId;
  const [match] = await db
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(eq(column, id))
    .limit(1);

  if (!match) {
    throw new ORPCError('NOT_FOUND', { message: 'Match not found' });
  }
  return match.id;
}

export async function resolveBeatmapId(
  db: DatabaseClient,
  id: number,
  keyType: KeyType
): Promise<number> {
  const column = keyType === 'otr' ? schema.beatmaps.id : schema.beatmaps.osuId;
  const [beatmap] = await db
    .select({ id: schema.beatmaps.id })
    .from(schema.beatmaps)
    .where(eq(column, id))
    .limit(1);

  if (!beatmap) {
    throw new ORPCError('NOT_FOUND', { message: 'Beatmap not found' });
  }
  return beatmap.id;
}
