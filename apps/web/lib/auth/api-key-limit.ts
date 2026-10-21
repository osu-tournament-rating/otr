import type { BetterAuthOptions } from 'better-auth';
import type { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import type { DatabaseClient } from '@/lib/db';

import {
  API_KEY_LIMIT_ERROR_CODE,
  API_KEY_LIMIT_MESSAGE,
  MAX_API_KEYS_PER_USER,
} from './api-key-policy';

type AdapterFactory = ReturnType<typeof drizzleAdapter>;

/** Better Auth's name for the API key model, which the plugin creates keys with. */
const API_KEY_MODEL = 'apikey';

/**
 * Refuses to create a key for a user who already holds
 * {@link MAX_API_KEYS_PER_USER}, at the one place every key is created. The
 * count and the insert share a transaction that locks the user's row, so
 * requests that race for the last slot, from any server, get it once.
 *
 * `createAdapter` builds the adapter on a database client, which here is
 * either the pool or the transaction.
 */
export const limitApiKeysPerUser =
  (
    database: DatabaseClient,
    createAdapter: (client: DatabaseClient) => AdapterFactory
  ): AdapterFactory =>
  (options: BetterAuthOptions) => {
    const adapter = createAdapter(database)(options);
    const create = adapter.create;

    adapter.create = async (input) => {
      if (input.model !== API_KEY_MODEL) {
        return create(input);
      }

      const userId = (input.data as { referenceId?: unknown }).referenceId;

      if (typeof userId !== 'string' || userId.length === 0) {
        throw new APIError('BAD_REQUEST', {
          message: 'API key owner is required',
        });
      }

      return database.transaction(async (tx) => {
        await tx
          .select({ id: schema.auth_users.id })
          .from(schema.auth_users)
          .where(eq(schema.auth_users.id, userId))
          .for('no key update');

        const held = await tx.$count(
          schema.apiKeys,
          eq(schema.apiKeys.referenceId, userId)
        );

        if (held >= MAX_API_KEYS_PER_USER) {
          throw new APIError('CONFLICT', {
            code: API_KEY_LIMIT_ERROR_CODE,
            message: API_KEY_LIMIT_MESSAGE,
          });
        }

        return createAdapter(tx as unknown as DatabaseClient)(options).create(
          input
        );
      });
    };

    return adapter;
  };
