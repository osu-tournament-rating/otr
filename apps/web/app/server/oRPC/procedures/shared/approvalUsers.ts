import { eq, inArray } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import type { ApprovalUser } from '@/lib/orpc/schema/approval';
import type { DatabaseClient } from '@/lib/db';

/**
 * The requesters and reviewers named in the approval queues, by user ID.
 * A deleted account is absent, and shows as "Deleted user".
 */
export async function loadApprovalUsers(
  db: Pick<DatabaseClient, 'select'>,
  userIds: readonly (number | null)[]
): Promise<Map<number, ApprovalUser>> {
  const ids = Array.from(
    new Set(userIds.filter((id): id is number => id !== null))
  );

  if (ids.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      id: schema.users.id,
      playerId: schema.players.id,
      osuId: schema.players.osuId,
      username: schema.players.username,
      country: schema.players.country,
    })
    .from(schema.users)
    .innerJoin(schema.players, eq(schema.players.id, schema.users.playerId))
    .where(inArray(schema.users.id, ids));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        player: {
          id: row.playerId,
          osuId: Number(row.osuId),
          username: row.username,
          country: row.country,
        },
      },
    ])
  );
}
