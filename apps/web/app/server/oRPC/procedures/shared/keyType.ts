import { eq } from 'drizzle-orm';
import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';

import { escapeLikePattern } from './likePattern';

export const KeyTypeSchema = z.enum(['otr', 'osu', 'username']).default('otr');
export type KeyType = z.infer<typeof KeyTypeSchema>;

export async function resolvePlayerId(
  db: DatabaseClient,
  id: number | string,
  keyType: KeyType
): Promise<number> {
  if (keyType === 'username') {
    // Escaped, so the name matches only itself, in any case
    const username = escapeLikePattern(String(id));
    const player = await db.query.players.findFirst({
      where: (players, { ilike }) => ilike(players.username, username),
      columns: { id: true },
    });
    if (!player) {
      throw new ORPCError('NOT_FOUND', { message: 'Player not found' });
    }
    return player.id;
  }

  const numericId = Number(id);
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
