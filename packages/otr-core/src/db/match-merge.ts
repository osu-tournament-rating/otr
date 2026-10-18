import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as relations from './relations';
import * as schema from './schema';
import { syncTournamentDateRange } from './sync-tournament-date-range';

type MergeClient = Pick<
  NodePgDatabase<typeof schema & typeof relations>,
  'select' | 'insert' | 'update' | 'delete' | 'query'
>;

/** A match a merge deletes, as its match_merges record keeps it. */
export interface MergedMatch {
  id: number;
  osuId: number;
  isLazer: boolean;
  name: string;
  tournamentId: number;
}

/**
 * Merges the children into the parent: moves their games, records each child
 * in match_merges against the parent, and deletes the children. Matches merged
 * into a child earlier now lead to the parent, which holds their games. A
 * game the parent already holds stays as it is, and the child's copy goes
 * with the child. Returns how many games moved.
 */
export async function mergeMatchesInto(
  db: MergeClient,
  parentMatchId: number,
  children: readonly MergedMatch[]
): Promise<number> {
  if (children.length === 0) {
    return 0;
  }

  const childIds = children.map((child) => child.id);

  const movedGames = await db
    .update(schema.games)
    .set({ matchId: parentMatchId })
    .where(
      and(
        inArray(schema.games.matchId, childIds),
        sql`not exists (select 1 from ${schema.games} as parent_game where parent_game.match_id = ${parentMatchId} and parent_game.osu_id = "games"."osu_id")`
      )
    )
    .returning({ id: schema.games.id });

  await db
    .update(schema.matchMerges)
    .set({ matchId: parentMatchId })
    .where(inArray(schema.matchMerges.matchId, childIds));

  await db.insert(schema.matchMerges).values(
    children.map((child) => ({
      matchId: parentMatchId,
      mergedMatchId: child.id,
      osuId: child.osuId,
      isLazer: child.isLazer,
      name: child.name,
    }))
  );

  await db.delete(schema.matches).where(inArray(schema.matches.id, childIds));

  const parent = await db.query.matches.findFirst({
    columns: { tournamentId: true },
    where: eq(schema.matches.id, parentMatchId),
  });
  const tournamentIds = new Set(children.map((child) => child.tournamentId));
  if (parent) {
    tournamentIds.add(parent.tournamentId);
  }
  for (const tournamentId of tournamentIds) {
    await syncTournamentDateRange(db, tournamentId);
  }

  return movedGames.length;
}

/**
 * The match, other than `matchId`, that already holds games with these osu!
 * game IDs, or null when no other match does. When several do, the one
 * holding the most of them.
 */
export async function findMatchHoldingGames(
  db: MergeClient,
  matchId: number,
  osuGameIds: readonly number[]
): Promise<number | null> {
  if (osuGameIds.length === 0) {
    return null;
  }

  const [holder] = await db
    .select({ matchId: schema.games.matchId, games: count() })
    .from(schema.games)
    .where(
      and(
        inArray(schema.games.osuId, [...osuGameIds]),
        ne(schema.games.matchId, matchId)
      )
    )
    .groupBy(schema.games.matchId)
    .orderBy(desc(count()), schema.games.matchId)
    .limit(1);

  return holder?.matchId ?? null;
}
