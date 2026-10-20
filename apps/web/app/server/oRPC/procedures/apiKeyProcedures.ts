import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ORPCError } from '@orpc/server';
import { APIError } from 'better-auth/api';

import { auth } from '@/lib/auth/auth';
import {
  API_KEY_LIMIT_ERROR_CODE,
  API_KEY_LIMIT_MESSAGE,
} from '@/lib/auth/api-key-policy';
import {
  ApiKeyMetadataSchema,
  ApiKeyWithSecretSchema,
} from '@/lib/orpc/schema/apiKey';
import * as schema from '@otr/core/db/schema';

import { protectedMutationProcedure, protectedProcedure } from './base';
type RawApiKeyRecord = typeof schema.apiKeys.$inferSelect;

type ApiKeyResponse = Omit<
  RawApiKeyRecord,
  | 'createdAt'
  | 'updatedAt'
  | 'lastRequest'
  | 'lastRefillAt'
  | 'expiresAt'
  | 'metadata'
  | 'permissions'
> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  lastRequest: string | Date | null;
  lastRefillAt: string | Date | null;
  expiresAt: string | Date | null;
  metadata?: unknown;
  permissions?: unknown;
  key: string;
};

const FALLBACK_API_KEY_NAME = 'API key';
const API_KEY_PREFIX = 'otr-';
const API_KEY_METADATA_SECRET_FIELD = 'secret';

type ApiKeyMetadataPayload = {
  secret?: string;
  [key: string]: unknown;
};

const normalizeTimestamp = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return value === null || value === undefined ? null : String(value);
};

const parseApiKeyMetadata = (metadata: unknown): ApiKeyMetadataPayload => {
  if (!metadata) {
    return {};
  }

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as ApiKeyMetadataPayload)
        : {};
    } catch {
      return {};
    }
  }

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return { ...(metadata as ApiKeyMetadataPayload) };
  }

  return {};
};

const extractStoredSecret = (metadata: unknown): string | null => {
  const parsed = parseApiKeyMetadata(metadata);
  const candidate = parsed[API_KEY_METADATA_SECRET_FIELD];

  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const encodeApiKeyMetadata = (metadata: ApiKeyMetadataPayload) => {
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
};

const toMetadataShape = (record: RawApiKeyRecord | ApiKeyResponse) => {
  const {
    key: _omitKey,
    metadata: rawMetadata,
    permissions: _omitPermissions,
    createdAt,
    updatedAt,
    lastRequest,
    lastRefillAt,
    expiresAt,
    ...rest
  } = record as ApiKeyResponse;

  void _omitKey;
  void _omitPermissions;

  const recordWithMetadata = record as ApiKeyResponse;
  const storedSecret = extractStoredSecret(rawMetadata);
  const normalizedName =
    typeof recordWithMetadata.name === 'string'
      ? recordWithMetadata.name.trim()
      : '';

  return {
    ...rest,
    name: normalizedName.length > 0 ? normalizedName : FALLBACK_API_KEY_NAME,
    key: storedSecret ?? '',
    createdAt: normalizeTimestamp(createdAt),
    updatedAt: normalizeTimestamp(updatedAt),
    lastRequest: normalizeTimestamp(lastRequest),
    lastRefillAt: normalizeTimestamp(lastRefillAt),
    expiresAt: normalizeTimestamp(expiresAt),
  };
};

export const toApiKeyMetadata = (record: RawApiKeyRecord) =>
  ApiKeyMetadataSchema.parse(toMetadataShape(record));

export const getUserApiKeys = protectedProcedure
  .output(ApiKeyWithSecretSchema.array())
  .route({
    summary: 'List API keys',
    tags: ['authenticated'],
    method: 'GET',
    path: '/api-clients/keys',
  })
  .handler(async ({ context }) => {
    const records = await context.db.query.apiKeys.findMany({
      where: eq(schema.apiKeys.referenceId, context.session.user.id),
    });

    records.sort((a, b) => {
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bCreated - aCreated;
    });

    return records.map((record) =>
      ApiKeyWithSecretSchema.parse(toMetadataShape(record))
    );
  });

export const generateUserApiKey = protectedMutationProcedure
  .input(
    z.object({
      name: z
        .string()
        .trim()
        .min(1, 'Provide a name for this API key')
        .max(100),
    })
  )
  .output(ApiKeyWithSecretSchema)
  .route({
    summary: 'Create API key',
    tags: ['authenticated'],
    method: 'POST',
    path: '/api-clients/keys',
  })
  .handler(async ({ context, input }) => {
    const apiKeyName =
      input.name.trim().length > 0 ? input.name.trim() : FALLBACK_API_KEY_NAME;

    // The auth database adapter enforces the per-user key limit
    const created = await auth.api
      .createApiKey({
        headers: context.headers,
        body: {
          name: apiKeyName,
          prefix: API_KEY_PREFIX,
        },
      })
      .catch((error: unknown) => {
        if (
          error instanceof APIError &&
          error.body?.code === API_KEY_LIMIT_ERROR_CODE
        ) {
          throw new ORPCError('CONFLICT', { message: API_KEY_LIMIT_MESSAGE });
        }

        throw error;
      });

    if (created?.id) {
      const rawMetadata =
        typeof created === 'object' && created !== null && 'metadata' in created
          ? (created as { metadata?: unknown }).metadata
          : null;
      const combinedMetadata = parseApiKeyMetadata(rawMetadata);
      combinedMetadata[API_KEY_METADATA_SECRET_FIELD] = created.key;

      const encoded = encodeApiKeyMetadata(combinedMetadata);

      if (encoded) {
        await context.db
          .update(schema.apiKeys)
          .set({ metadata: encoded })
          .where(eq(schema.apiKeys.id, created.id));
      }
    }

    return ApiKeyWithSecretSchema.parse({
      ...toMetadataShape(created as unknown as ApiKeyResponse),
      key: created.key,
    });
  });

export const deleteUserApiKey = protectedMutationProcedure
  .input(
    z.object({
      keyId: z.string().min(1, 'API key id is required'),
    })
  )
  .output(
    z.object({
      success: z.boolean(),
    })
  )
  .route({
    summary: 'Delete API key',
    tags: ['authenticated'],
    method: 'DELETE',
    path: '/api-clients/keys/{keyId}',
  })
  .handler(async ({ context, input }) => {
    const keyRecord = await context.db.query.apiKeys.findFirst({
      where: and(
        eq(schema.apiKeys.id, input.keyId),
        eq(schema.apiKeys.referenceId, context.session.user.id)
      ),
    });

    if (!keyRecord) {
      throw new ORPCError('NOT_FOUND', {
        message: 'API key not found',
      });
    }

    const result = await auth.api.deleteApiKey({
      headers: context.headers,
      body: {
        keyId: input.keyId,
      },
    });

    if (!result?.success) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to delete API key',
      });
    }

    return { success: true };
  });
