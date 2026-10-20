import { createAuthEndpoint, APIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { E2E_FAKE_OSU_ID_FLOOR } from './e2e-auth';

/**
 * Test-only plugin: `POST /api/auth/e2e/sign-in` with `{ playerId, admin? }` mints a
 * signed session for an existing player, provisioning its `users`/`auth_users` rows
 * if the local database has none. `POST /api/auth/e2e/delete-player` with
 * `{ osuId }` removes a fake player the suite signed up, and everything that
 * hangs off it. Gated on {@link isE2eAuthEnabled}, which each endpoint rechecks
 * per request — Playwright runs a production build, so the gate cannot key off
 * NODE_ENV. Production's docker-compose.yml pins the flag off.
 */
export const isE2eAuthEnabled = () => process.env.E2E_TEST_AUTH === 'true';

export const e2eTestAuthPlugin = () =>
  ({
    id: 'otr-e2e-test-auth',
    endpoints: {
      e2eSignIn: createAuthEndpoint(
        '/e2e/sign-in',
        {
          method: 'POST',
          body: z.object({
            playerId: z.number().int().positive(),
            admin: z.boolean().optional(),
          }),
          metadata: {
            openapi: {
              operationId: 'e2eSignIn',
              description:
                'Test-only: mint a signed session for an existing player. Disabled outside e2e.',
            },
          },
        },
        async (ctx) => {
          if (!isE2eAuthEnabled()) {
            throw new APIError('NOT_FOUND', { message: 'Not found' });
          }

          const { playerId, admin = false } = ctx.body;

          let authUser = await db.query.auth_users.findFirst({
            where: eq(schema.auth_users.playerId, playerId),
          });

          if (!authUser) {
            const player = await db.query.players.findFirst({
              where: eq(schema.players.id, playerId),
            });

            if (!player) {
              throw new APIError('NOT_FOUND', {
                message: `No player with id ${playerId}.`,
              });
            }

            await db
              .insert(schema.users)
              .values({
                playerId,
                scopes: admin ? ['admin'] : ['whitelist'],
              })
              .onConflictDoNothing({ target: schema.users.playerId });

            [authUser] = await db
              .insert(schema.auth_users)
              .values({
                id: crypto.randomUUID(),
                name: player.username,
                email: `e2e-player-${playerId}@otr.local`,
                emailVerified: true,
                playerId,
              })
              .returning();
          }

          const session = await ctx.context.internalAdapter.createSession(
            authUser.id,
            false
          );

          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Failed to create session',
            });
          }

          await setSessionCookie(ctx, { session, user: authUser });

          return ctx.json({
            ok: true,
            userId: authUser.id,
            playerId,
          });
        }
      ),
      e2eDeletePlayer: createAuthEndpoint(
        '/e2e/delete-player',
        {
          method: 'POST',
          body: z.object({
            // Previews enable this plugin on a shared database, so it can
            // only reach the fake players the suite signs up.
            osuId: z.number().int().min(E2E_FAKE_OSU_ID_FLOOR),
          }),
          metadata: {
            openapi: {
              operationId: 'e2eDeletePlayer',
              description:
                'Test-only: delete a fake player the e2e suite signed up. Disabled outside e2e.',
            },
          },
        },
        async (ctx) => {
          if (!isE2eAuthEnabled()) {
            throw new APIError('NOT_FOUND', { message: 'Not found' });
          }

          const player = await db.query.players.findFirst({
            where: eq(schema.players.osuId, ctx.body.osuId),
          });

          if (player) {
            await db
              .delete(schema.users)
              .where(eq(schema.users.playerId, player.id));
            // Cascades to the auth user, its accounts, and its sessions.
            await db
              .delete(schema.players)
              .where(eq(schema.players.id, player.id));
          }

          return ctx.json({ ok: true, deleted: !!player });
        }
      ),
    },
  }) satisfies BetterAuthPlugin;
