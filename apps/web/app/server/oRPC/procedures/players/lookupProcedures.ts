import { asc, desc, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  PlayerLookupInputSchema,
  PlayerLookupResponseSchema,
} from '@/lib/orpc/schema/player';
import {
  buildPlayerSearchExpressions,
  parseOsuIdCandidate,
  parseSearchTerm,
} from '@/lib/orpc/queries/search';

import { adminProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';

/** Admin player picker. Matches site-wide search, plus a bare osu! id. */
export const lookupPlayers = adminProcedure
  .input(PlayerLookupInputSchema)
  .output(PlayerLookupResponseSchema)
  .route({
    summary: 'Look up players for admin pickers',
    tags: ['admin'],
    method: 'GET',
    path: '/players:lookup',
  })
  .handler(async ({ input, context }) => {
    ensureAdminSession(context.session);

    const osuIdCandidate = parseOsuIdCandidate(input.query);
    const parsed = parseSearchTerm(input.query);

    if (osuIdCandidate !== null) {
      const [row] = await context.db
        .select({
          id: schema.players.id,
          osuId: schema.players.osuId,
          username: schema.players.username,
        })
        .from(schema.players)
        .where(sql`${schema.players.osuId} = ${osuIdCandidate}`)
        .limit(1);

      // An unknown id is still offered: the admin pins it and the worker fetches.
      return PlayerLookupResponseSchema.parse({
        players: [
          row
            ? {
                osuId: Number(row.osuId),
                username: row.username,
                playerId: Number(row.id),
              }
            : {
                osuId: osuIdCandidate,
                username: `osu! user ${osuIdCandidate}`,
                playerId: null,
              },
        ],
      });
    }

    if (!parsed) {
      return PlayerLookupResponseSchema.parse({ players: [] });
    }

    const { condition, rank, currentUsernameMatched } =
      buildPlayerSearchExpressions(parsed);

    const rows = await context.db
      .select({
        id: schema.players.id,
        osuId: schema.players.osuId,
        username: schema.players.username,
      })
      .from(schema.players)
      .where(condition)
      .orderBy(
        desc(currentUsernameMatched),
        desc(rank),
        asc(schema.players.username)
      )
      .limit(input.limit);

    return PlayerLookupResponseSchema.parse({
      players: rows.map((row) => ({
        osuId: Number(row.osuId),
        username: row.username,
        playerId: Number(row.id),
      })),
    });
  });
