import { ORPCError } from '@orpc/server';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  AdminBanUserInputSchema,
  AdminBanUserResponseSchema,
  AdminBanUserLookupResponseSchema,
  type AdminPlayerSearchInput,
  AdminPlayerSearchInputSchema,
  AdminPlayerSearchResponseSchema,
  AdminUserApiKeysInputSchema,
} from '@/lib/orpc/schema/user';
import type { DatabaseClient } from '@/lib/db';
import { ApiKeyMetadataSchema } from '@/lib/orpc/schema/apiKey';
import {
  buildPlayerSearchExpressions,
  parseOsuIdCandidate,
  parseSearchTerm,
} from '@/lib/orpc/queries/search';

import { adminMutationProcedure, adminProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { toApiKeyMetadata } from '../apiKeyProcedures';

const AdminBanLookupInputSchema = AdminBanUserInputSchema.pick({
  playerId: true,
});

const normalizeTimestamp = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return null;
};

const ADMIN_PLAYER_SEARCH_LIMIT = 8;

/**
 * The admin user lookup's suggestions: signed-in players, matched like the
 * header search, plus an exact osu! id.
 */
export async function searchPlayersAdminHandler({
  context,
  input,
}: {
  context: {
    db: DatabaseClient;
    session: Parameters<typeof ensureAdminSession>[0];
  };
  input: AdminPlayerSearchInput;
}) {
  ensureAdminSession(context.session);

  const parsed = parseSearchTerm(input.query);
  const osuIdCandidate = parseOsuIdCandidate(input.query);

  if (!parsed) {
    return [];
  }

  const { condition, rank, currentUsernameMatched, matchedPreviousUsername } =
    buildPlayerSearchExpressions(parsed);
  const osuIdMatched =
    osuIdCandidate !== null
      ? eq(schema.players.osuId, osuIdCandidate)
      : undefined;

  const rows = await context.db
    .select({
      playerId: schema.players.id,
      username: schema.players.username,
      osuId: schema.players.osuId,
      banned: schema.auth_users.banned,
      banReason: schema.auth_users.banReason,
      matchedPreviousUsername,
    })
    .from(schema.auth_users)
    .innerJoin(
      schema.players,
      eq(schema.auth_users.playerId, schema.players.id)
    )
    .where(or(condition, osuIdMatched))
    .orderBy(
      ...(osuIdMatched ? [desc(osuIdMatched)] : []),
      desc(currentUsernameMatched),
      desc(rank),
      asc(schema.players.username)
    )
    .limit(ADMIN_PLAYER_SEARCH_LIMIT);

  return AdminPlayerSearchResponseSchema.parse(
    rows.map((row) => ({
      playerId: Number(row.playerId),
      username: row.username,
      osuId: Number(row.osuId),
      banned: Boolean(row.banned),
      banReason: row.banReason ?? null,
      matchedPreviousUsername: row.matchedPreviousUsername ?? null,
    }))
  );
}

export const searchPlayersAdmin = adminProcedure
  .input(AdminPlayerSearchInputSchema)
  .output(AdminPlayerSearchResponseSchema)
  .route({
    summary: 'Search players with authenticated accounts',
    tags: ['admin'],
    method: 'GET',
    path: '/users:search',
  })
  .handler(searchPlayersAdminHandler);

export const lookupAuthUserAdmin = adminProcedure
  .input(AdminBanLookupInputSchema)
  .output(AdminBanUserLookupResponseSchema)
  .route({
    summary: 'Lookup auth user by player id',
    tags: ['admin'],
    method: 'GET',
    path: '/users:lookup',
  })
  .handler(async ({ context, input }) => {
    ensureAdminSession(context.session);

    const authUser = await context.db.query.auth_users.findFirst({
      columns: {
        id: true,
        banned: true,
        banReason: true,
        banExpires: true,
      },
      where: eq(schema.auth_users.playerId, input.playerId),
    });

    if (!authUser) {
      return AdminBanUserLookupResponseSchema.parse({
        exists: false,
        authUser: null,
      });
    }

    return AdminBanUserLookupResponseSchema.parse({
      exists: true,
      authUser: {
        id: authUser.id,
        playerId: input.playerId,
        banned: Boolean(authUser.banned),
        banReason: authUser.banReason ?? null,
        banExpires: normalizeTimestamp(authUser.banExpires),
      },
    });
  });

export const listUserApiKeysAdmin = adminProcedure
  .input(AdminUserApiKeysInputSchema)
  .output(ApiKeyMetadataSchema.array())
  .route({
    summary: 'List active API keys for a player',
    tags: ['admin'],
    method: 'GET',
    path: '/users:api-keys',
  })
  .handler(async ({ context, input }) => {
    ensureAdminSession(context.session);

    const authUser = await context.db.query.auth_users.findFirst({
      columns: {
        id: true,
      },
      where: eq(schema.auth_users.playerId, input.playerId),
    });

    if (!authUser) {
      return [];
    }

    const records = await context.db.query.apiKeys.findMany({
      where: and(
        eq(schema.apiKeys.referenceId, authUser.id),
        eq(schema.apiKeys.enabled, true),
        or(
          isNull(schema.apiKeys.expiresAt),
          gt(schema.apiKeys.expiresAt, sql`CURRENT_TIMESTAMP`)
        )
      ),
      orderBy: desc(schema.apiKeys.createdAt),
    });

    return records.map((record) => toApiKeyMetadata(record));
  });

export const banUserAdmin = adminMutationProcedure
  .input(AdminBanUserInputSchema)
  .output(AdminBanUserResponseSchema)
  .route({
    summary: 'Ban user and revoke API access',
    tags: ['admin'],
    method: 'POST',
    path: '/users:ban',
  })
  .handler(async ({ context, input }) => {
    ensureAdminSession(context.session);

    const authUser = await context.db.query.auth_users.findFirst({
      columns: {
        id: true,
      },
      where: eq(schema.auth_users.playerId, input.playerId),
    });

    if (!authUser) {
      throw new ORPCError('NOT_FOUND', {
        message: 'No authentication user found for the provided player id',
      });
    }

    await context.db.transaction(async (tx) => {
      await tx
        .update(schema.auth_users)
        .set({
          banned: true,
          banReason: input.reason,
          banExpires: null,
        })
        .where(eq(schema.auth_users.id, authUser.id));

      await tx
        .update(schema.apiKeys)
        .set({ enabled: false })
        .where(eq(schema.apiKeys.referenceId, authUser.id));

      await tx
        .update(schema.auth_sessions)
        .set({
          expiresAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.auth_sessions.userId, authUser.id));
    });

    return { success: true };
  });
