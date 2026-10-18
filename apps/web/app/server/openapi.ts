import { OpenAPIGenerator, type OpenAPI } from '@orpc/openapi';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import type { Context } from '@orpc/server';
import type {
  StandardHandlerOptions,
  StandardHandlerPlugin,
} from '@orpc/server/standard';
import {
  experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin,
  ZodToJsonSchemaConverter,
} from '@orpc/zod/zod4';
import { z } from 'zod';

import { router } from '@/app/server/oRPC/router';
import { LeaderboardEntrySchema } from '@/lib/orpc/schema/leaderboard';
import { MatchSchema } from '@/lib/orpc/schema/match';
import {
  PlayerBeatmapStatsSchema,
  PlayerBeatmapsResponseSchema,
} from '@/lib/orpc/schema/playerBeatmaps';
import { PlayerStatsSchema } from '@/lib/orpc/schema/playerStats';
import { PlayerSchema } from '@/lib/orpc/schema/player';
import {
  TournamentDetailSchema,
  TournamentListItemSchema,
} from '@/lib/orpc/schema/tournament';
import { UserSchema } from '@/lib/orpc/schema/user';
import { PlatformStatsSchema } from '@/lib/orpc/schema/stats';
import {
  AuditActionUserSchema,
  AuditAdminNoteSchema,
  AuditEntrySchema,
  AuditEventActionSchema,
  CascadeContextSchema,
  CascadeDescendantSchema,
  DescendantAuditCountsResponseSchema,
  DescendantAuditItemSchema,
  DescendantAuditResponseSchema,
  EntityTimelineEventSchema,
  EntityTimelineItemSchema,
  EntityTimelineResponseSchema,
  UnauditedSubmissionSchema,
} from '@/lib/orpc/schema/audit';
import {
  RatingAdjustmentTypeSchema,
  RulesetSchema,
  ScoreGradeSchema,
  ScoringTypeSchema,
  TeamSchema,
  TeamTypeSchema,
  VerificationStatusSchema,
} from '@/lib/orpc/schema/constants';

const INTEGER_DEFAULT_MIN_VALUES = new Set([
  Number.MIN_SAFE_INTEGER,
  -2147483648,
]);
const INTEGER_DEFAULT_MAX_VALUES = new Set([
  Number.MAX_SAFE_INTEGER,
  2147483647,
]);

type MutableJSONSchema = Record<string, unknown> & {
  enum?: unknown;
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
};

const asMutableSchema = (value: unknown): MutableJSONSchema | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as MutableJSONSchema)
    : null;

const sanitizeJsonSchema = (schema: unknown): void => {
  const root = asMutableSchema(schema);
  if (!root) {
    return;
  }

  const queue: MutableJSONSchema[] = [];
  const enqueue = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(enqueue);
    } else {
      const schemaCandidate = asMutableSchema(candidate);
      if (schemaCandidate) {
        queue.push(schemaCandidate);
      }
    }
  };

  enqueue(root);

  const childKeys = {
    direct: [
      'items',
      'additionalItems',
      'unevaluatedItems',
      'propertyNames',
      'additionalProperties',
      'unevaluatedProperties',
      'contains',
      'contentSchema',
      'if',
      'then',
      'else',
      'not',
    ],
    records: [
      'properties',
      'patternProperties',
      'definitions',
      '$defs',
      'dependentSchemas',
    ],
    arrays: ['allOf', 'anyOf', 'oneOf', 'prefixItems'],
  };

  while (queue.length > 0) {
    const node = queue.pop()!;

    const enumValues = Array.isArray(node.enum) ? node.enum : null;
    let prefersInteger = false;
    if (enumValues && enumValues.length > 0) {
      const numeric = enumValues.filter(
        (value: unknown): value is number => typeof value === 'number'
      );
      if (
        numeric.length > 0 &&
        numeric.length >= enumValues.length - numeric.length
      ) {
        node.enum = Array.from(new Set(numeric));
        prefersInteger = true;
      }
    }

    const rawType = node.type;
    const baseTypes = Array.isArray(rawType)
      ? rawType.filter(
          (value: unknown): value is string => typeof value === 'string'
        )
      : typeof rawType === 'string'
        ? [rawType]
        : [];

    const hasIntegerType = prefersInteger || baseTypes.includes('integer');

    if (hasIntegerType) {
      const normalized = baseTypes.filter(
        (value) => value !== 'string' && value !== 'number'
      );
      if (!normalized.includes('integer')) {
        normalized.push('integer');
      }
      node.type =
        normalized.length === 0
          ? 'integer'
          : normalized.length === 1
            ? normalized[0]
            : normalized;

      if (
        typeof node.minimum === 'number' &&
        INTEGER_DEFAULT_MIN_VALUES.has(node.minimum)
      ) {
        delete node.minimum;
      }

      if (
        typeof node.maximum === 'number' &&
        INTEGER_DEFAULT_MAX_VALUES.has(node.maximum)
      ) {
        delete node.maximum;
      }
    }

    for (const key of childKeys.direct) {
      enqueue(node[key]);
    }

    for (const key of childKeys.records) {
      const entries = node[key];
      if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        Object.values(entries as Record<string, unknown>).forEach(enqueue);
      }
    }

    for (const key of childKeys.arrays) {
      enqueue(node[key]);
    }
  }
};

const schemaConverters = [
  new ZodToJsonSchemaConverter({
    interceptors: [
      ({ next }) => {
        const [required, jsonSchema] = next();
        sanitizeJsonSchema(jsonSchema);
        return [required, jsonSchema] as [typeof required, typeof jsonSchema];
      },
    ],
  }),
];

const isPublicProcedure = ({
  contract,
}: {
  contract: { ['~orpc']?: { route?: { tags?: readonly string[] } } };
}) =>
  Boolean(
    contract?.['~orpc']?.route?.tags?.some(
      (tag) => tag?.toLowerCase() === 'public'
    )
  );

const openAPIGenerator = new OpenAPIGenerator({
  schemaConverters,
});

const unwrapSchema = (schema: z.ZodType): z.ZodType =>
  schema instanceof z.ZodOptional ||
  schema instanceof z.ZodNullable ||
  schema instanceof z.ZodDefault
    ? unwrapSchema(schema.unwrap() as z.ZodType)
    : schema;

/**
 * A query string carries a list of one as a plain value, `?tiers=gold`, which
 * would fail a list's validation. This wraps such a value in a list.
 */
class QueryListPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  init(options: StandardHandlerOptions<T>) {
    options.clientInterceptors ??= [];
    options.clientInterceptors.unshift((interceptorOptions) => {
      const { inputSchema, route } = interceptorOptions.procedure['~orpc'];
      const { input } = interceptorOptions;

      // Only GET reads its input from the query string; a JSON body keeps
      // its own types
      if (
        route.method !== 'GET' ||
        !(inputSchema instanceof z.ZodObject) ||
        typeof input !== 'object' ||
        input === null
      ) {
        return interceptorOptions.next();
      }

      const shape = inputSchema.shape as Record<string, z.ZodType>;
      const wrapped = Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          typeof value === 'string' &&
          shape[key] &&
          unwrapSchema(shape[key]) instanceof z.ZodArray
            ? [value]
            : value,
        ])
      );

      return interceptorOptions.next({ ...interceptorOptions, input: wrapped });
    });
  }
}

export const createOpenAPIHandler = <T extends Context>(
  apiRouter: ConstructorParameters<typeof OpenAPIHandler<T>>[0]
) =>
  new OpenAPIHandler<T>(apiRouter, {
    // Each plugin puts its interceptor first, so QueryListPlugin wraps a lone
    // value before smart coercion converts the items of a list
    plugins: [new ZodSmartCoercionPlugin(), new QueryListPlugin()],
    filter: (args) => isPublicProcedure(args),
  });

export const openAPIHandler = createOpenAPIHandler(router);

const API_SECURITY_SCHEME_NAME = 'ApiKeyAuth';
const securityRequirement = [{ [API_SECURITY_SCHEME_NAME]: [] as string[] }];
const publicTags = [
  {
    name: 'public',
    description:
      'Public endpoints that do not require authentication when used from the website, accessible via public API',
  },
];

const buildServers = () => {
  const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL;

  if (!baseUrl) {
    return [
      {
        url: '/api',
        description: 'API Server',
      },
    ];
  }

  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return [
    {
      url: `${normalized}/api`,
      description: 'o!TR API',
    },
  ];
};

/**
 * oRPC gives every query parameter that is not a plain type, such as a list or
 * an enum reference, the deepObject style, which OpenAPI defines only for
 * objects. Clients then send a list in forms the API does not read. Such a
 * parameter takes the default style instead, one repeated key per value.
 */
const dropDeepObjectFromNonObjectQueries = (spec: OpenAPI.Document) => {
  const schemas = spec.components?.schemas ?? {};
  const isObjectSchema = (schema: unknown): boolean => {
    const node = asMutableSchema(schema);
    if (typeof node?.$ref === 'string') {
      return isObjectSchema(schemas[node.$ref.split('/').pop()!]);
    }
    return node?.type === 'object';
  };

  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      const parameters = asMutableSchema(operation)?.parameters;
      if (!Array.isArray(parameters)) {
        continue;
      }

      for (const parameter of parameters.map(asMutableSchema)) {
        if (
          parameter?.in === 'query' &&
          parameter.style === 'deepObject' &&
          !isObjectSchema(parameter.schema)
        ) {
          delete parameter.style;
          delete parameter.explode;
        }
      }
    }
  }

  return spec;
};

export const generatePublicOpenAPISpec = async () => {
  const spec = await openAPIGenerator.generate(router, {
    info: {
      title: 'o!TR API',
      version: '1.0.0',
      description: `osu! Tournament Rating API

> **API Stability Notice:** The o!TR public API is still evolving and is not considered fully stable. Breaking changes may be introduced at any time without advance notice. Past breaking changes are recorded in the [API changelog](https://docs.otr.stagec.net/changelogs/website-changelog#breaking-api-changes).`,
    },
    servers: buildServers(),
    tags: publicTags,
    security: securityRequirement,
    components: {
      securitySchemes: {
        [API_SECURITY_SCHEME_NAME]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
          description:
            'Send an o!TR API key using the Authorization: Bearer <key> header.',
        },
      },
    },
    commonSchemas: {
      Ruleset: { schema: RulesetSchema },
      ScoringType: { schema: ScoringTypeSchema },
      TeamType: { schema: TeamTypeSchema },
      Team: { schema: TeamSchema },
      ScoreGrade: { schema: ScoreGradeSchema },
      RatingAdjustmentType: { schema: RatingAdjustmentTypeSchema },
      VerificationStatus: { schema: VerificationStatusSchema },
      User: {
        schema: UserSchema,
      },
      Player: {
        schema: PlayerSchema,
      },
      Match: {
        schema: MatchSchema,
      },
      Tournament: {
        schema: TournamentDetailSchema,
      },
      TournamentListItem: {
        schema: TournamentListItemSchema,
      },
      LeaderboardEntry: {
        schema: LeaderboardEntrySchema,
      },
      PlayerBeatmap: {
        schema: PlayerBeatmapStatsSchema,
      },
      PlayerBeatmapResponse: {
        schema: PlayerBeatmapsResponseSchema,
      },
      PlayerStats: {
        schema: PlayerStatsSchema,
      },
      PlatformStats: {
        schema: PlatformStatsSchema,
      },
      AuditActionUser: { schema: AuditActionUserSchema },
      AuditEntry: { schema: AuditEntrySchema },
      AuditAdminNote: { schema: AuditAdminNoteSchema },
      AuditEventAction: { schema: AuditEventActionSchema },
      CascadeDescendant: { schema: CascadeDescendantSchema },
      CascadeContext: { schema: CascadeContextSchema },
      EntityTimelineEvent: { schema: EntityTimelineEventSchema },
      EntityTimelineItem: { schema: EntityTimelineItemSchema },
      EntityTimelineResponse: { schema: EntityTimelineResponseSchema },
      UnauditedSubmission: { schema: UnauditedSubmissionSchema },
      DescendantAuditItem: { schema: DescendantAuditItemSchema },
      DescendantAuditResponse: { schema: DescendantAuditResponseSchema },
      DescendantAuditCountsResponse: {
        schema: DescendantAuditCountsResponseSchema,
      },
    },
    filter: (args) => isPublicProcedure(args),
  });

  return dropDeepObjectFromNonObjectQueries(spec);
};
