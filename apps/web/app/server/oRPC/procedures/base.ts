import { ORPCError, os } from '@orpc/server';
import { APIError } from 'better-auth/api';
import * as schema from '@otr/core/db/schema';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  generateCorrelationId,
  extractCorrelationId,
} from '@otr/core/logging';
import { setActiveSpanAttributes, withSpan } from '@otr/core/tracing';
import { SpanKind } from '@opentelemetry/api';

import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { orpcProcedureCalls, orpcProcedureDuration } from '@/lib/metrics';

import type { RequestLoggingContext } from './logging/types';
import {
  resolveActor,
  formatUserDescriptor,
  formatProcedurePath,
} from './logging/helpers';
import { assertCurrentBuild } from './shared/currentBuild';
import { assertOutsideMaintenanceWindow } from './shared/maintenanceWindow';

type ApiKeyActor = {
  userId: string;
  playerId: number | null;
  osuId: number | null;
  osuUsername: string | null;
};

type VerifiedApiKeyContext = {
  apiKey?: VerifiedApiKey | null;
  apiKeyActor?: ApiKeyActor | null;
};

const base = os.$context<
  {
    headers: Headers;
    requestUrl?: string;
    /** The build a call through /rpc came from; null when it sent none. */
    clientBuild?: string | null;
  } & VerifiedApiKeyContext
>();

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type VerifiedApiKey = {
  id: string;
  userId: string;
  name: string | null;
  enabled: boolean;
};

type ApiKeyVerificationErrorPayload = {
  code?: string | null;
  message?: string | null;
  details?: JsonValue;
};

type ApiKeyVerificationResponse = {
  valid?: boolean;
  key?: VerifiedApiKey | null;
  error?: ApiKeyVerificationErrorPayload | null;
};

const maskApiKey = (value: string): string => {
  if (value.length <= 5) {
    return '*****';
  }

  return `${value.slice(0, 5)}...`;
};

type OrpcErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_SUPPORTED'
  | 'NOT_ACCEPTABLE'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNPROCESSABLE_CONTENT'
  | 'TOO_MANY_REQUESTS'
  | 'CLIENT_CLOSED_REQUEST'
  | 'INTERNAL_SERVER_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'BAD_GATEWAY'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT';

const STATUS_TO_ORPC_CODE = new Map<number, OrpcErrorCode>([
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [405, 'METHOD_NOT_SUPPORTED'],
  [406, 'NOT_ACCEPTABLE'],
  [408, 'TIMEOUT'],
  [409, 'CONFLICT'],
  [412, 'PRECONDITION_FAILED'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [422, 'UNPROCESSABLE_CONTENT'],
  [429, 'TOO_MANY_REQUESTS'],
  [499, 'CLIENT_CLOSED_REQUEST'],
  [500, 'INTERNAL_SERVER_ERROR'],
  [501, 'NOT_IMPLEMENTED'],
  [502, 'BAD_GATEWAY'],
  [503, 'SERVICE_UNAVAILABLE'],
  [504, 'GATEWAY_TIMEOUT'],
] as const);

const resolveOrpcCodeForStatus = (status: number): OrpcErrorCode => {
  const candidate = STATUS_TO_ORPC_CODE.get(status);
  if (candidate) {
    return candidate;
  }

  if (status >= 500) {
    return 'INTERNAL_SERVER_ERROR';
  }

  if (status >= 400) {
    return 'BAD_REQUEST';
  }

  return 'INTERNAL_SERVER_ERROR';
};

type BetterAuthErrorData = {
  status: number;
  message: string;
  cause: APIError;
};

const toOrpcErrorFromBetterAuth = (
  error: APIError
): ORPCError<string, BetterAuthErrorData> => {
  const status = Number.isInteger(error.status) ? Number(error.status) : 500;
  const code = resolveOrpcCodeForStatus(status);
  const payload: BetterAuthErrorData = {
    status,
    message: error.message,
    cause: error,
  };

  return new ORPCError(code, {
    status,
    message: error.message,
    cause: error,
    data: payload,
  });
};

const DEFAULT_SUCCESS_STATUS = 200;

const RATE_LIMIT_ERROR_CODES = new Set(['RATE_LIMITED', 'USAGE_EXCEEDED']);

const extractApiKeyVerificationError = (
  verification: ApiKeyVerificationResponse | null | undefined
): {
  code: string | null;
  message: string | null;
  details: JsonValue | undefined;
} => {
  const error = verification?.error;

  if (!error) {
    return {
      code: null,
      message: null,
      details: undefined,
    };
  }

  const { code, message, details } = error;

  return {
    code: typeof code === 'string' ? code : null,
    message: typeof message === 'string' ? message : null,
    details,
  };
};

const createVerificationErrorData = (
  code: string | null,
  details: JsonValue | undefined
): Record<string, JsonValue> | undefined => {
  const base: Record<string, JsonValue> = {};

  if (code) {
    base.code = code;
  }

  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return {
      ...base,
      ...(details as JsonObject),
    };
  }

  if (details !== undefined && details !== null) {
    return {
      ...base,
      details,
    };
  }

  return Object.keys(base).length > 0 ? base : undefined;
};

const handleInvalidApiKeyVerification = (
  verification: ApiKeyVerificationResponse | null | undefined
): never => {
  const { code, message, details } =
    extractApiKeyVerificationError(verification);
  const data = createVerificationErrorData(code, details);

  if (code && RATE_LIMIT_ERROR_CODES.has(code)) {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      status: 429,
      message: message ?? 'API key rate limit exceeded',
      data,
    });
  }

  if (code === 'KEY_DISABLED') {
    throw new ORPCError('FORBIDDEN', {
      status: 403,
      message: message ?? 'API key disabled',
      data,
    });
  }

  throw new ORPCError('UNAUTHORIZED', {
    status: 401,
    message: message ?? 'Invalid API key provided',
    data,
  });
};

type ProcedureRouteMeta = {
  ['~orpc']?: {
    route?: {
      successStatus?: number;
    };
  };
};

type StatusCarrier = {
  status?: number;
};

type MaybeStatus = StatusCarrier | Response | null | undefined;

const resolveSuccessStatus = (
  procedure: ProcedureRouteMeta | undefined
): number => {
  const candidate = procedure?.['~orpc']?.route?.successStatus;
  if (typeof candidate === 'number' && candidate >= 200 && candidate < 400) {
    return candidate;
  }

  return DEFAULT_SUCCESS_STATUS;
};

const resolveSuccessStatusFromResult = (
  result: MaybeStatus,
  fallbackStatus: number
): number => {
  if (!result) {
    return fallbackStatus;
  }

  if (result instanceof Response) {
    const status = result.status;
    return status >= 200 && status < 400 ? status : fallbackStatus;
  }

  const candidate = result.status;
  if (typeof candidate === 'number' && candidate >= 200 && candidate < 400) {
    return candidate;
  }

  return fallbackStatus;
};

type AnyOrpcError = ORPCError<string, JsonValue | undefined>;

type ProcedureError =
  | AnyOrpcError
  | APIError
  | (Error & StatusCarrier)
  | StatusCarrier
  | string
  | number
  | boolean
  | null
  | undefined;

const resolveErrorStatus = (error: ProcedureError): number => {
  if (!error) {
    return 500;
  }

  if (error instanceof ORPCError) {
    return error.status;
  }

  if (error instanceof APIError) {
    const status = Number(error.status);
    if (Number.isInteger(status)) {
      return status;
    }
  }

  if (error && typeof error === 'object') {
    const candidate = (error as StatusCarrier).status;
    if (typeof candidate === 'number' && candidate >= 400 && candidate < 600) {
      return candidate;
    }
  }

  return 500;
};

const describeError = (error: ProcedureError) => {
  if (!error) {
    return 'unknown';
  }

  if (error instanceof ORPCError) {
    return error.code ?? error.message ?? 'orpc-error';
  }

  if (error instanceof Error) {
    return error.name || error.message || 'error';
  }

  try {
    return String(error);
  } catch {
    return 'non-stringable-error';
  }
};

const extractApiKey = (headers?: Headers) => {
  if (!headers) {
    return null;
  }

  const authorization = headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  return null;
};

const withOptionalApiKey = base.middleware(async ({ context, next }) => {
  const candidate = extractApiKey(context.headers);

  if (!candidate) {
    return next({
      context: {
        ...context,
        apiKey: null,
        apiKeyActor: null,
      } as typeof context & VerifiedApiKeyContext,
    });
  }

  try {
    const verification = await auth.api.verifyApiKey({
      headers: context.headers,
      body: {
        key: candidate,
      },
    });

    const verifiedKey = verification?.key ?? null;

    if (!verification?.valid || !verifiedKey) {
      handleInvalidApiKeyVerification(
        verification as unknown as ApiKeyVerificationResponse
      );
    }

    const activeKey = verifiedKey as NonNullable<typeof verifiedKey>;

    if (activeKey.enabled === false) {
      throw new ORPCError('FORBIDDEN', {
        status: 403,
        message: 'API key disabled',
        data: { code: 'KEY_DISABLED' },
      });
    }

    // Better Auth's API key plugin (v1.6+) renamed `userId` to `referenceId`.
    const { id, referenceId, name, enabled } = activeKey;
    const userId = referenceId;
    let apiKeyActor: ApiKeyActor | null = null;

    try {
      const authUser = await db.query.auth_users.findFirst({
        columns: {
          id: true,
          name: true,
          playerId: true,
        },
        where: eq(schema.auth_users.id, userId),
        with: {
          player: {
            columns: {
              id: true,
              osuId: true,
              username: true,
            },
          },
        },
      });

      if (authUser) {
        const playerId = authUser.player?.id ?? authUser.playerId ?? null;

        apiKeyActor = {
          userId,
          playerId,
          osuId: authUser.player?.osuId ?? null,
          osuUsername:
            authUser.player?.username ?? (authUser.name ? authUser.name : null),
        };
      }
    } catch (apiKeyActorError) {
      const timestamp = new Date().toISOString();
      const description = describeError(apiKeyActorError as ProcedureError);
      console.error(
        `${timestamp} [oRPC]: api-key-owner-lookup-failed apiKey=${maskApiKey(
          id
        )} error=${description}`
      );
    }

    return next({
      context: {
        ...context,
        apiKey: {
          id,
          userId,
          name: name ?? null,
          enabled,
        },
        apiKeyActor,
      } as typeof context & VerifiedApiKeyContext,
    });
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    if (error instanceof APIError) {
      throw toOrpcErrorFromBetterAuth(error);
    }

    throw new ORPCError('UNAUTHORIZED', {
      status: 401,
      message: 'Invalid API key provided',
      cause: error instanceof Error ? error : undefined,
    });
  }
});

const withDatabase = base.middleware(async ({ context, next }) => {
  return next({
    context: {
      ...context,
      db,
    },
  });
});

const withAuth = base.middleware(async ({ context, next }) => {
  try {
    const session = await auth.api.getSession({ headers: context.headers });

    if (!session) {
      throw new ORPCError('UNAUTHORIZED', {
        status: 401,
        message: 'Invalid or expired session',
      });
    }

    return next({
      context: {
        ...context,
        session,
      },
    });
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    if (error instanceof APIError) {
      throw toOrpcErrorFromBetterAuth(error);
    }

    throw error;
  }
});

const withOptionalSession = base.middleware(async ({ context, next }) => {
  try {
    const session = await auth.api.getSession({ headers: context.headers });
    return next({
      context: {
        ...context,
        session: session ?? null,
      },
    });
  } catch {
    return next({
      context: {
        ...context,
        session: null,
      },
    });
  }
});

const rootLogger = createLogger('otr-web');

const extractRequestPath = (requestUrl?: string): string | null => {
  if (!requestUrl) {
    return null;
  }

  try {
    const url = new URL(requestUrl);
    const search = url.search;
    return search ? `${url.pathname}${search}` : url.pathname;
  } catch {
    return null;
  }
};

// Runs ahead of the rest of the chain so session lookups and database work all
// land inside the procedure span.
const withTracing = base.middleware(async ({ path, next }) => {
  const procedurePath = formatProcedurePath(path);

  return withSpan(
    procedurePath,
    {
      kind: SpanKind.SERVER,
      attributes: { 'rpc.system': 'orpc', 'rpc.method': procedurePath },
    },
    async () => next()
  );
});

const withLoggingContext = base.middleware(async ({ context, path, next }) => {
  const correlationId =
    extractCorrelationId(context.headers) ?? generateCorrelationId();
  const procedurePath = formatProcedurePath(path);
  const actor = resolveActor(context);
  const requestPath = extractRequestPath(context.requestUrl);

  setActiveSpanAttributes({
    'otr.correlation_id': correlationId,
    'otr.access_method': actor.accessMethod,
    'otr.player_id': actor.playerId ?? undefined,
    'otr.request_path': requestPath ?? undefined,
  });

  const logger = rootLogger.child({
    correlationId,
    procedure: procedurePath,
    path: requestPath,
  });

  const loggingContext: RequestLoggingContext = {
    correlationId,
    actor,
    procedurePath,
    requestPath,
    startTime: Date.now(),
    logger,
  };

  return next({
    context: {
      ...context,
      logging: loggingContext,
    },
  });
});

const formatInputForLogging = (input: unknown): string | null => {
  if (input === undefined || input === null) {
    return null;
  }
  try {
    const str = JSON.stringify(input);
    return str.length > 200 ? str.slice(0, 200) + '...' : str;
  } catch {
    return '[unserializable]';
  }
};

const withRequestLogging = base.middleware(
  async ({ context, next, procedure }, input: unknown) => {
    const { logging } = context as typeof context & {
      logging: RequestLoggingContext;
    };
    const successStatus = resolveSuccessStatus(procedure);
    const inputStr = formatInputForLogging(input);

    try {
      const result = await next();
      const resultWithStatus = result as MaybeStatus;
      const durationMs = Date.now() - logging.startTime;
      const statusCode = resolveSuccessStatusFromResult(
        resultWithStatus,
        successStatus
      );

      logging.logger.info('procedure completed', {
        accessMethod: logging.actor.accessMethod,
        user: formatUserDescriptor(logging.actor),
        playerId: logging.actor.playerId,
        code: statusCode,
        duration: `${Math.round(durationMs)}ms`,
        status: 'ok',
        input: inputStr,
      });

      return result;
    } catch (error) {
      const procedureError = error as ProcedureError;
      const durationMs = Date.now() - logging.startTime;
      const statusCode = resolveErrorStatus(procedureError);

      const logContext = {
        accessMethod: logging.actor.accessMethod,
        user: formatUserDescriptor(logging.actor),
        playerId: logging.actor.playerId,
        code: statusCode,
        duration: `${Math.round(durationMs)}ms`,
        status: 'error',
        error: describeError(procedureError),
        input: inputStr,
      };

      if (statusCode === 404) {
        logging.logger.debug('procedure not found', logContext);
      } else {
        logging.logger.warn('procedure failed', logContext);
      }

      throw error;
    }
  }
);

const withMetrics = base.middleware(async (options) => {
  const { context, path, next, procedure } = options;
  const procedureName = formatProcedurePath(path);
  const start = Date.now();
  const loggingContext = context as typeof context & {
    logging?: RequestLoggingContext;
  };
  const accessMethod = loggingContext.logging?.actor?.accessMethod ?? 'unknown';

  try {
    const result = await next();
    orpcProcedureCalls
      .labels({
        procedure: procedureName,
        status: 'success',
        code: String(resolveSuccessStatus(procedure)),
        accessMethod,
      })
      .inc();
    orpcProcedureDuration
      .labels({ procedure: procedureName, accessMethod })
      .observe((Date.now() - start) / 1000);
    return result;
  } catch (error) {
    orpcProcedureCalls
      .labels({
        procedure: procedureName,
        status: 'error',
        code: String(resolveErrorStatus(error as ProcedureError)),
        accessMethod,
      })
      .inc();
    orpcProcedureDuration
      .labels({ procedure: procedureName, accessMethod })
      .observe((Date.now() - start) / 1000);
    throw error;
  }
});

// Raised by the verification inheritance constraint triggers (0029); drizzle
// wraps the driver error, so walk the cause chain
function verificationInheritanceMessage(error: unknown): string | null {
  for (let current = error; current;) {
    if (typeof current !== 'object') {
      return null;
    }

    const { code, constraint, message, cause } = current as Record<
      string,
      unknown
    >;

    if (
      code === '23514' &&
      typeof constraint === 'string' &&
      constraint.endsWith('_verification_inheritance') &&
      typeof message === 'string'
    ) {
      return message;
    }

    current = cause;
  }

  return null;
}

const withErrorBoundary = base.middleware(async ({ path, next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    const inheritanceMessage = verificationInheritanceMessage(error);

    if (inheritanceMessage) {
      throw new ORPCError('BAD_REQUEST', { message: inheritanceMessage });
    }

    const procedurePath = formatProcedurePath(path);
    console.error(`[orpc] ${procedurePath} failed with unhandled error`, error);

    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'An unexpected error occurred',
    });
  }
});

export const publicProcedure = base
  .use(withTracing)
  .use(withDatabase)
  .use(withOptionalApiKey)
  .use(withOptionalSession)
  .use(withLoggingContext)
  .use(withMetrics)
  .use(withRequestLogging)
  .use(withErrorBoundary);

export const protectedProcedure = base
  .use(withTracing)
  .use(withDatabase)
  .use(withAuth)
  .use(withLoggingContext)
  .use(withMetrics)
  .use(withRequestLogging)
  .use(withErrorBoundary);

// Keeps the public archives consistent with what the processor runs against (#763)
export const withMaintenanceWindowGuard = base.middleware(
  async ({ context, next }) => {
    await assertOutsideMaintenanceWindow(context.headers, {
      subject: 'Admin changes',
    });
    return next();
  }
);

// A page from another release sends input shaped by its own code
export const withCurrentBuildGuard = base.middleware(
  async ({ context, next }) => {
    assertCurrentBuild(context.clientBuild);
    return next();
  }
);

/** A signed-in user's write, refused from a page of another release. */
export const protectedMutationProcedure = protectedProcedure.use(
  withCurrentBuildGuard
);

export const adminMutationProcedure = protectedMutationProcedure.use(
  withMaintenanceWindowGuard
);
