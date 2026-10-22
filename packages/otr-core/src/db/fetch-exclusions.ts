import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as relations from './relations';
import * as schema from './schema';

type ExclusionClient = Pick<
  NodePgDatabase<typeof schema & typeof relations>,
  'select' | 'insert' | 'update' | 'delete'
>;

interface MergedGame {
  id: number;
  osuId: number;
}

/**
 * Records a game merge in fetch_exclusions, so a refetch neither adds the
 * children back nor splits their scores off again: each child's osu! game
 * sends its scores to the parent, and games merged into a child earlier now
 * lead to the parent. A score deleted from a child stays excluded under the
 * child's osu! game, so a refetch never writes it over the score the parent
 * kept for that player. Call it after moving the children's scores to the
 * parent and before deleting the children, all in one transaction.
 */
export async function excludeMergedGames(
  db: ExclusionClient,
  parent: MergedGame & { matchId: number },
  children: readonly MergedGame[]
): Promise<void> {
  if (children.length === 0) {
    return;
  }

  const childIds = children.map((child) => child.id);
  const childOsuIds = children.map((child) => child.osuId);

  await db
    .update(schema.fetchExclusions)
    .set({ mergedIntoGameId: parent.id })
    .where(inArray(schema.fetchExclusions.mergedIntoGameId, childIds));

  await db
    .delete(schema.fetchExclusions)
    .where(
      and(
        eq(schema.fetchExclusions.matchId, parent.matchId),
        inArray(schema.fetchExclusions.osuGameId, childOsuIds),
        isNull(schema.fetchExclusions.playerId)
      )
    );

  await db
    .insert(schema.fetchExclusions)
    .values(
      children.map((child) => ({
        matchId: parent.matchId,
        osuGameId: child.osuId,
        mergedIntoGameId: parent.id,
      }))
    )
    .onConflictDoNothing();
}
