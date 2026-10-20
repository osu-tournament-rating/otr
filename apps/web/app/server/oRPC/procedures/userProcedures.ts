import { ORPCError } from '@orpc/server';
import { APIError } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import * as schema from '@otr/core/db/schema';
import {
  CurrentUserSchema,
  PublicUserSchema,
  SESSION_NOT_FRESH_ERROR_CODE,
  UpdateUserSettingsInputSchema,
  UserSettingsSchema,
  type UpdateUserSettingsInput,
  type UserSettings,
} from '@/lib/orpc/schema/user';
import { auth } from '@/lib/auth/auth';
import { db, type DatabaseClient } from '@/lib/db';
import { getRulesetSettings } from '@/lib/db/ruleset-settings';

import { protectedMutationProcedure, protectedProcedure } from './base';

export const getUser = protectedProcedure
  .input(
    z.object({
      id: z.number().int().positive(),
    })
  )
  .output(PublicUserSchema)
  .route({
    summary: 'Get user details',
    tags: ['authenticated'],
    method: 'GET',
    path: '/users/{id}',
  })
  .handler(async ({ input, context }) => {
    const user = await context.db.query.users.findFirst({
      columns: { id: true },
      where: eq(schema.users.id, input.id),
      with: {
        player: {
          columns: { id: true, osuId: true, username: true, country: true },
        },
      },
    });

    if (!user) {
      throw new ORPCError('NOT_FOUND', {
        message: 'User not found',
      });
    }

    return user;
  });

export const getCurrentUser = protectedProcedure
  .output(CurrentUserSchema)
  .route({
    summary: 'Get current user',
    tags: ['authenticated'],
    method: 'GET',
    path: '/users/me',
  })
  .handler(async ({ context }) => {
    const { osuId } = context.session.user;

    if (!osuId) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Authenticated user does not have an associated osu! id',
      });
    }

    const player = await context.db.query.players.findFirst({
      where: eq(schema.players.osuId, osuId),
    });

    if (!player) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Player not found for the current session',
      });
    }

    const user = await context.db.query.users.findFirst({
      where: eq(schema.users.playerId, player.id),
    });

    return CurrentUserSchema.parse({
      player: {
        id: player.id,
        username: player.username,
        osuId: player.osuId,
        country: player.country,
      },
      scopes: user?.scopes ?? [],
      userId: user?.id ?? null,
    });
  });

export const deleteMyAccount = protectedMutationProcedure
  .route({
    summary: 'Permanently delete user account data',
    tags: ['authenticated'],
    method: 'DELETE',
    path: '/users/me',
  })
  .handler(async ({ context }) => {
    const { user } = context.session;

    if (!user?.id) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'No authenticated user found',
      });
    }

    const result = await auth.api
      .deleteUser({
        headers: context.headers,
        body: {},
      })
      .catch((error: unknown) => {
        // Better Auth deletes an account only within a day of signing in
        if (
          error instanceof APIError &&
          error.body?.code === 'SESSION_EXPIRED'
        ) {
          throw new ORPCError('FORBIDDEN', {
            message:
              'Deleting your account needs a log in from the last day. Log out and log back in, then try again.',
            data: { code: SESSION_NOT_FRESH_ERROR_CODE },
          });
        }

        throw error;
      });

    if (!result) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to delete account',
      });
    }

    return { success: true };
  });

export const deleteMyFriends = protectedMutationProcedure
  .route({
    summary: 'Delete all friends for the current user',
    tags: ['authenticated'],
    method: 'DELETE',
    path: '/users/me/friends',
  })
  .handler(async ({ context }) => {
    const { user } = context.session;

    if (!user?.id) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'No authenticated user found',
      });
    }

    const authUser = await context.db.query.auth_users.findFirst({
      where: eq(schema.auth_users.id, user.id),
      columns: {
        playerId: true,
      },
    });

    if (!authUser?.playerId) {
      throw new ORPCError('NOT_FOUND', {
        message: 'User not found',
      });
    }

    await db
      .delete(schema.playerFriends)
      .where(eq(schema.playerFriends.playerId, authUser.playerId));

    return { success: true };
  });

interface UserSettingsContext {
  db: DatabaseClient;
  session: {
    dbUser?: { id: number; playerId: number } | null;
  } | null;
}

function requireDbUser(context: UserSettingsContext) {
  const user = context.session?.dbUser;
  if (!user) {
    throw new ORPCError('NOT_FOUND', { message: 'User not found' });
  }
  return user;
}

export async function getUserSettingsHandler({
  context,
}: {
  context: UserSettingsContext;
}): Promise<UserSettings> {
  const user = requireDbUser(context);
  const settings = await getRulesetSettings(context.db, user.playerId);

  if (!settings) {
    throw new ORPCError('NOT_FOUND', { message: 'Player not found' });
  }

  return settings;
}

export const getUserSettings = protectedProcedure
  .output(UserSettingsSchema)
  .route({
    summary: 'Get the current user’s settings',
    tags: ['authenticated'],
    method: 'GET',
    path: '/users/me/settings',
  })
  .handler(getUserSettingsHandler);

/**
 * Saves the settings `input` names and leaves the others alone. The first
 * save creates the user's settings row.
 */
export async function updateUserSettingsHandler({
  input,
  context,
}: {
  input: UpdateUserSettingsInput;
  context: UserSettingsContext;
}) {
  const user = requireDbUser(context);
  const changes = {
    ...(input.profileRuleset !== undefined && {
      profileRuleset: input.profileRuleset,
    }),
    ...(input.browsingRuleset !== undefined && {
      browsingRuleset: input.browsingRuleset,
    }),
  };

  await context.db
    .insert(schema.userSettings)
    .values({ userId: user.id, ...changes })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: { ...changes, updated: sql`CURRENT_TIMESTAMP` },
    });

  return { success: true };
}

export const updateUserSettings = protectedMutationProcedure
  .input(UpdateUserSettingsInputSchema)
  .output(z.object({ success: z.boolean() }))
  .route({
    summary: 'Update the current user’s settings',
    tags: ['authenticated'],
    method: 'PATCH',
    path: '/users/me/settings',
  })
  .handler(updateUserSettingsHandler);
