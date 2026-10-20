import { and, desc, eq, isNotNull, lt, or, sql, inArray } from 'drizzle-orm';
import { ORPCError } from '@orpc/server';
import * as schema from '@otr/core/db/schema';
import { AuditEntityType, AuditActionType } from '@otr/core/osu';

import {
  AuditEntityNameInputSchema,
  AuditEntityNameResponseSchema,
  EntityAuditInputSchema,
  EntityTimelineResponseSchema,
  EventFeedInputSchema,
  EventFeedResponseSchema,
  EventDetailsInputSchema,
  EventDetailsResponseSchema,
  type AuditEntry,
  type AuditAdminNote,
  type AuditEvent,
  type AuditEventActionCount,
  type CascadeContext,
  type EntityTimelineItem,
  type EntityTimelineEvent,
} from '@/lib/orpc/schema/audit';
import type { DatabaseClient } from '@/lib/db';

import { publicProcedure } from './base';
import {
  getAuditTable,
  getAdminNotesTable,
  getAdminNotesTableNameString,
  getParentEntityJoinInfo,
  buildAuditEventKeyExpression,
  getTableNameString,
  getUnauditedSubmission,
  ALL_AUDIT_TABLES,
  camelizeChangesKeys,
  mergeTimelineItems,
  assembleEvents,
  getImmediateChildType,
  buildChildSummary,
  buildOutcomeBreakdown,
  countChildLevels,
  getCascadeCountParent,
  buildFieldChangeConditions,
  buildReferencedUsers,
  extractUserIdsFromChanges,
  resolveEntityNames,
  resolveEntityNamesBatched,
  resolveUserIds,
  resolveTournamentNames,
  decodeEventFeedCursor,
  encodeEventFeedCursor,
  type BreakdownRow,
  type ReferencedUser,
  type GroupedAuditRow,
} from './audit/helpers';
import { classifyAction } from '@/lib/audit-actions';

type AuditRow = {
  id: number;
  eventId: number | null;
  created: string;
  referenceIdLock: number;
  referenceId: number | null;
  actionUserId: number | null;
  actionType: number;
  changes: unknown;
  userId: number | null;
  playerId: number | null;
  osuId: number | null;
  username: string | null;
};

type InternalAuditEntry = AuditEntry & {
  eventId: number | null;
};

const SAFE_FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateFieldNames(fieldNames: string[]): string[] {
  return fieldNames.filter((name) => SAFE_FIELD_NAME_RE.test(name));
}

function mapAuditRow(
  row: AuditRow,
  entityType: AuditEntityType,
  userMap?: Map<number, ReferencedUser>,
  precomputedChanges?: Record<string, unknown> | null
): InternalAuditEntry {
  const changes =
    precomputedChanges !== undefined
      ? precomputedChanges
      : camelizeChangesKeys(row.changes as Record<string, unknown> | null);

  const referencedUsers = userMap
    ? buildReferencedUsers(changes, userMap)
    : undefined;

  return {
    id: row.id,
    eventId: row.eventId,
    entityType,
    referenceIdLock: row.referenceIdLock,
    referenceId: row.referenceId,
    actionUserId: row.actionUserId,
    actionType: row.actionType as AuditActionType,
    changes,
    created: row.created,
    actionUser: row.userId
      ? {
          id: row.userId,
          playerId: row.playerId,
          osuId: row.osuId,
          username: row.username,
        }
      : null,
    referencedUsers,
  };
}

type AdminNoteRow = {
  id: number;
  note: string;
  created: string;
  updated: string | null;
  userId: number | null;
  playerId: number | null;
  osuId: number | null;
  username: string | null;
};

function mapAdminNoteRow(row: AdminNoteRow): AuditAdminNote {
  return {
    id: row.id,
    note: row.note,
    created: row.created,
    updated: row.updated,
    adminUser: row.userId
      ? {
          id: row.userId,
          playerId: row.playerId,
          osuId: row.osuId,
          username: row.username,
        }
      : null,
  };
}

async function queryAuditEntries(
  db: DatabaseClient,
  entityType: AuditEntityType,
  options: {
    referenceIdLock?: number;
    ids?: number[];
    cursor?: number;
    limit: number;
    offset?: number;
    actionUserIdNotNull?: boolean;
    actionUserId?: number;
    actionTypes?: AuditActionType[];
    dateFrom?: string;
    dateTo?: string;
    /** Matches any of these fields. */
    fieldNames?: string[];
    entityId?: number;
    changeValue?: string;
    cursorTimestamp?: string;
  }
): Promise<InternalAuditEntry[]> {
  const table = getAuditTable(entityType);

  const conditions = [];

  if (options.referenceIdLock !== undefined) {
    conditions.push(eq(table.referenceIdLock, options.referenceIdLock));
  }

  if (options.ids !== undefined && options.ids.length > 0) {
    conditions.push(inArray(table.id, options.ids));
  }

  if (options.cursor !== undefined) {
    conditions.push(lt(table.id, options.cursor));
  }

  if (options.actionUserIdNotNull) {
    conditions.push(isNotNull(table.actionUserId));
  }

  if (options.actionUserId !== undefined) {
    conditions.push(eq(table.actionUserId, options.actionUserId));
  }

  if (options.actionTypes && options.actionTypes.length > 0) {
    conditions.push(inArray(table.actionType, options.actionTypes));
  }

  if (options.dateFrom) {
    conditions.push(sql`${table.created} >= ${options.dateFrom}::timestamptz`);
  }

  if (options.dateTo) {
    conditions.push(sql`${table.created} <= ${options.dateTo}::timestamptz`);
  }

  if (options.fieldNames && options.fieldNames.length > 0) {
    const safeFieldNames = validateFieldNames(options.fieldNames);
    if (safeFieldNames.length === 0) {
      return [];
    }
    const fieldConditions = buildFieldChangeConditions(
      sql`${table.changes}`,
      safeFieldNames
    );
    conditions.push(or(...fieldConditions)!);

    if (options.changeValue && safeFieldNames.length === 1) {
      conditions.push(
        sql`${table.changes} @> ${JSON.stringify({
          [safeFieldNames[0]]: {
            newValue: tryParseJsonValue(options.changeValue),
          },
        })}::jsonb`
      );
    }
  }

  if (options.entityId !== undefined) {
    conditions.push(eq(table.referenceIdLock, options.entityId));
  }

  if (options.cursorTimestamp) {
    conditions.push(
      sql`${table.created} < ${options.cursorTimestamp}::timestamptz`
    );
  }

  let query = db
    .select({
      id: table.id,
      eventId: table.eventId,
      created: table.created,
      referenceIdLock: table.referenceIdLock,
      referenceId: table.referenceId,
      actionUserId: table.actionUserId,
      actionType: table.actionType,
      changes: table.changes,
      userId: schema.users.id,
      playerId: schema.players.id,
      osuId: schema.players.osuId,
      username: schema.players.username,
    })
    .from(table)
    .leftJoin(schema.users, eq(schema.users.id, table.actionUserId))
    .leftJoin(schema.players, eq(schema.players.id, schema.users.playerId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(table.id))
    .limit(options.limit)
    .$dynamic();

  if (options.offset !== undefined) {
    query = query.offset(options.offset);
  }

  const rows = await query;

  const allUserIds: number[] = [];
  const camelizedChanges: (Record<string, unknown> | null)[] = [];
  for (const row of rows) {
    const changes = camelizeChangesKeys(
      row.changes as Record<string, unknown> | null
    );
    camelizedChanges.push(changes);
    const ids = extractUserIdsFromChanges(
      changes as Record<
        string,
        { originalValue?: unknown; newValue?: unknown }
      > | null
    );
    allUserIds.push(...ids);
  }

  const userMap = await resolveUserIds(db, allUserIds);

  return (rows as AuditRow[]).map((row, i) =>
    mapAuditRow(row, entityType, userMap, camelizedChanges[i])
  );
}

function tryParseJsonValue(value: string): unknown {
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '') return num;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

type GroupedEventRow = {
  event_key: string;
  event_id: string | null;
  event_created: string;
  entity_type: number;
  action_user_id: number | null;
  created: string;
  action_types: number[];
  parent_entity_id: number | null;
  count: number;
  entry_count: number;
  verification_status_counts: string[];
  changed_fields: string[];
  sample_changes: unknown;
  sample_entity_id: number;
};

/** Distinct verification status per entity as `status:count` pairs; `unchanged` and `null` lose to a real status. */
const verificationStatusCountsExpr = sql`
  ARRAY(
    SELECT entity_statuses.status || ':' || COUNT(*)::text
    FROM (
      -- Both array_agg calls share ORDER BY a.id so unnest pairs status with entity.
      SELECT DISTINCT ON (grouped_statuses.entity_id)
        grouped_statuses.status
      FROM unnest(
        array_agg(
          CASE
            WHEN normalized_changes.verification_status_change IS NULL THEN
              'unchanged'
            ELSE
              COALESCE(
                normalized_changes.verification_status_change ->> 'newValue',
                normalized_changes.verification_status_change ->> 'NewValue',
                normalized_changes.verification_status_change ->> 'new_value',
                'null'
              )
          END
          ORDER BY a.id
        ),
        array_agg(a.reference_id_lock ORDER BY a.id)
      ) WITH ORDINALITY AS grouped_statuses(status, entity_id, position)
      ORDER BY
        grouped_statuses.entity_id,
        grouped_statuses.status IN ('unchanged', 'null'),
        grouped_statuses.position DESC
    ) entity_statuses
    GROUP BY entity_statuses.status
    ORDER BY entity_statuses.status
  )`;

const normalizedChangesJoin = sql`
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      a.changes -> 'verification_status',
      a.changes -> 'verificationStatus',
      a.changes -> 'VerificationStatus'
    ) AS verification_status_change
  ) normalized_changes`;

type CascadeSiblingRow = {
  entity_type: number;
  cnt: number;
  sample_id: number;
  sample_changes: unknown;
  action_types: number[];
  verification_status_counts: string[];
};

function toBreakdownRow(row: CascadeSiblingRow): BreakdownRow {
  return {
    actionTypes: row.action_types as AuditActionType[],
    entryCount: row.cnt,
    verificationStatusCounts: row.verification_status_counts ?? [],
  };
}

export const getEntityAuditTimeline = publicProcedure
  .input(EntityAuditInputSchema)
  .output(EntityTimelineResponseSchema)
  .route({
    summary: 'Get audit timeline for a specific entity',
    description: [
      'Returns the full audit history and admin notes for a single entity, sorted in reverse chronological order.',
      '',
      '**Entity types** (`entityType` parameter):',
      '- `0` — Tournament',
      '- `1` — Match',
      '- `2` — Game',
      '- `3` — Score',
      '',
      'Each timeline item is either an `audit` entry (a recorded change) or a `note` (an admin comment).',
      'Audit entries that were part of a bulk cascade operation include a `cascadeContext` object describing',
      'the top-level entity that triggered the change and a human-readable child summary (e.g. "also affected 85 of 118 matches").',
      '',
      'Creations were not audited before October 2025. For a tournament with no audit entry for its creation,',
      '`unauditedSubmission` carries its submission time and submitter from the tournament itself; otherwise it is null.',
      '',
      '**Pagination** — offset-based with `page` and `pageSize` parameters.',
      'The response includes `page`, `pageSize`, `pages` (total page count), and `total` (total item count).',
      '',
      '**Examples**',
      '```',
      'GET /audit/timeline?entityType=0&entityId=42',
      'GET /audit/timeline?entityType=1&entityId=100&pageSize=25',
      'GET /audit/timeline?entityType=0&entityId=42&page=2&pageSize=50',
      '```',
    ].join('\n'),
    tags: ['public'],
    method: 'GET',
    path: '/audit/timeline',
  })
  .handler(async ({ input, context }) => {
    const { entityType, entityId, showSystem } = input;
    const DEFAULT_PAGE_SIZE = 50;
    const MAX_PAGE_SIZE = 100;

    const page = Math.max(input.page ?? 1, 1);
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    );

    const auditTableName = getTableNameString(entityType);
    const notesTableName = getAdminNotesTableNameString(entityType);

    // System rows carry no action user; they are noise unless explicitly requested.
    const auditScope = showSystem
      ? sql`reference_id_lock = ${entityId}`
      : sql`reference_id_lock = ${entityId} AND action_user_id IS NOT NULL`;

    const countResult = await context.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM ${sql.raw(auditTableName)} WHERE ${auditScope}) AS audit_count,
        (SELECT COUNT(*)::int FROM ${sql.raw(notesTableName)} WHERE reference_id = ${entityId}) AS note_count
    `);
    const { audit_count: auditCount, note_count: noteCount } = countResult
      .rows[0] as { audit_count: number; note_count: number };

    const total = auditCount + noteCount;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, pages);
    const offset = Math.max(0, (currentPage - 1) * pageSize);

    const pageItemResult = await context.db.execute(sql`
      SELECT item_id, item_type FROM (
        SELECT id AS item_id, 'audit'::text AS item_type, created
        FROM ${sql.raw(auditTableName)}
        WHERE ${auditScope}
        UNION ALL
        SELECT id AS item_id, 'note'::text AS item_type, created
        FROM ${sql.raw(notesTableName)}
        WHERE reference_id = ${entityId}
      ) merged
      ORDER BY created DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    const pageItemRows = pageItemResult.rows as {
      item_id: number;
      item_type: string;
    }[];
    const auditIds = pageItemRows
      .filter((r) => r.item_type === 'audit')
      .map((r) => r.item_id);
    const noteIds = pageItemRows
      .filter((r) => r.item_type === 'note')
      .map((r) => r.item_id);

    const [trimmedEntries, noteRows, unauditedSubmission] = await Promise.all([
      auditIds.length > 0
        ? queryAuditEntries(context.db, entityType, {
            ids: auditIds,
            limit: auditIds.length,
          })
        : Promise.resolve([] as InternalAuditEntry[]),
      noteIds.length > 0
        ? (async () => {
            const notesTable = getAdminNotesTable(entityType);
            return context.db
              .select({
                id: notesTable.id,
                note: notesTable.note,
                created: notesTable.created,
                updated: notesTable.updated,
                userId: schema.users.id,
                playerId: schema.players.id,
                osuId: schema.players.osuId,
                username: schema.players.username,
              })
              .from(notesTable)
              .leftJoin(
                schema.users,
                eq(schema.users.id, notesTable.adminUserId)
              )
              .leftJoin(
                schema.players,
                eq(schema.players.id, schema.users.playerId)
              )
              .where(inArray(notesTable.id, noteIds));
          })()
        : Promise.resolve([] as AdminNoteRow[]),
      entityType === AuditEntityType.Tournament
        ? getUnauditedSubmission(context.db, entityId)
        : Promise.resolve(null),
    ]);

    const cascadePairs = new Map<
      string,
      {
        eventId: number | null;
        actionUserId: number | null;
        actionType: AuditActionType;
        created: string;
      }
    >();
    for (const entry of trimmedEntries) {
      if (!entry.changes) continue;
      const changes = entry.changes as Record<string, unknown>;
      if (changes.verificationStatus || changes.verification_status) {
        const key =
          entry.eventId !== null
            ? `event:${entry.eventId}`
            : `legacy:${entry.actionUserId}:${entry.created}:${entry.actionType}`;
        if (!cascadePairs.has(key)) {
          cascadePairs.set(key, {
            eventId: entry.eventId,
            actionUserId: entry.actionUserId,
            actionType: entry.actionType,
            created: entry.created,
          });
        }
      }
    }

    const cascadeContextMap = new Map<string, CascadeContext>();

    if (cascadePairs.size > 0) {
      const { fromClause, parentIdExpr } = getParentEntityJoinInfo(entityType);

      const parentResult = await context.db.execute(sql`
        SELECT ${sql.raw(parentIdExpr)} AS parent_id
        FROM ${sql.raw(fromClause)}
        WHERE a.reference_id_lock = ${entityId}
        LIMIT 1
      `);
      const parentTournamentId =
        (parentResult.rows[0] as { parent_id: number | null } | undefined)
          ?.parent_id ?? null;

      if (parentTournamentId !== null) {
        const pairEntries = Array.from(cascadePairs.entries());
        const siblingResults = await Promise.all(
          pairEntries.map(
            ([, { eventId, actionUserId, actionType, created }]) => {
              const siblingQueries = ALL_AUDIT_TABLES.map(
                ({ entityType: et }) => {
                  const info = getParentEntityJoinInfo(et);
                  const userCondition =
                    actionUserId !== null
                      ? sql`a.action_user_id = ${actionUserId}`
                      : sql`a.action_user_id IS NULL`;
                  const eventIdentityCondition =
                    eventId !== null
                      ? sql`a.event_id = ${eventId}
                        AND a.created = ${created}::timestamptz`
                      : sql`${userCondition}
                        AND a.created = ${created}::timestamptz
                        AND a.action_type = ${actionType}`;
                  return sql`
                SELECT
                  ${et}::int AS entity_type,
                  COUNT(DISTINCT a.reference_id_lock)::int AS cnt,
                  (array_agg(a.reference_id_lock ORDER BY a.id DESC))[1] AS sample_id,
                  (array_agg(a.changes ORDER BY a.id DESC))[1] AS sample_changes,
                  ARRAY_AGG(DISTINCT a.action_type ORDER BY a.action_type) AS action_types,
                  ${verificationStatusCountsExpr} AS verification_status_counts
                FROM ${sql.raw(info.fromClause)}
                ${normalizedChangesJoin}
                WHERE ${eventIdentityCondition}
                  AND ${sql.raw(info.parentIdExpr)} = ${parentTournamentId}
                GROUP BY entity_type
              `;
                }
              );
              return context.db.execute(
                sql`${sql.join(siblingQueries, sql` UNION ALL `)}`
              );
            }
          )
        );

        type CascadeInfo = {
          key: string;
          eventId: number | null;
          actionUserId: number | null;
          created: string;
          topEntityType: AuditEntityType;
          topEntityId: number;
          action: ReturnType<typeof classifyAction>;
          childType: AuditEntityType | null;
          childAffectedCount: number;
          descendantCounts: {
            entityType: AuditEntityType;
            count: number;
            actionBreakdown: AuditEventActionCount[] | null;
          }[];
        };
        const cascadeInfos: CascadeInfo[] = [];

        for (let i = 0; i < pairEntries.length; i++) {
          const [key, { eventId, actionUserId, actionType, created }] =
            pairEntries[i];
          const siblingRows = siblingResults[i].rows as CascadeSiblingRow[];

          if (siblingRows.length <= 1) continue;

          siblingRows.sort((a, b) => a.entity_type - b.entity_type);
          const topRow = siblingRows[0]!;
          const topRowType = topRow.entity_type as AuditEntityType;
          const topChanges = camelizeChangesKeys(
            topRow.sample_changes as Record<string, unknown> | null
          );
          const action = classifyAction(actionType, topChanges);

          const spansTopLevel = topRow.cnt > 1;
          const topEntityType = spansTopLevel
            ? AuditEntityType.Tournament
            : topRowType;
          const topEntityId = spansTopLevel
            ? parentTournamentId
            : topRow.sample_id;

          const descendantCounts = siblingRows
            .filter((row) => row.entity_type > topEntityType && row.cnt > 0)
            .map((row) => ({
              entityType: row.entity_type as AuditEntityType,
              count: row.cnt,
              actionBreakdown: buildOutcomeBreakdown(
                [toBreakdownRow(row)],
                action
              ),
            }));

          const childType = getImmediateChildType(topEntityType);
          const childAffectedCount =
            descendantCounts.find((d) => d.entityType === childType)?.count ??
            0;

          cascadeInfos.push({
            key,
            eventId,
            actionUserId,
            created,
            topEntityType,
            topEntityId,
            action,
            childType,
            childAffectedCount,
            descendantCounts,
          });
        }

        const childTotal = await countChildLevels(
          context.db,
          cascadeInfos.flatMap((info) =>
            info.descendantCounts.map((descendant) => ({
              parentType: info.topEntityType,
              parentId: info.topEntityId,
              childType: descendant.entityType,
            }))
          )
        );

        const entityNameMaps = await resolveEntityNamesBatched(
          context.db,
          cascadeInfos.map((info) => ({
            entityType: info.topEntityType,
            entityId: info.topEntityId,
          }))
        );

        for (const info of cascadeInfos) {
          const topEntityName =
            entityNameMaps.get(info.topEntityType)?.get(info.topEntityId) ??
            null;
          const totalChildCount =
            info.childType !== null
              ? childTotal(info.topEntityType, info.topEntityId, info.childType)
              : null;

          const childSummary =
            info.childType !== null && info.childAffectedCount > 0
              ? buildChildSummary(
                  info.childType,
                  info.childAffectedCount,
                  totalChildCount
                )
              : null;

          cascadeContextMap.set(info.key, {
            topEntityType: info.topEntityType,
            topEntityId: info.topEntityId,
            topEntityName,
            action: info.action,
            childSummary,
            descendants: info.descendantCounts.map(
              ({ entityType, count, actionBreakdown }) => ({
                entityType,
                affectedCount: count,
                totalCount: childTotal(
                  info.topEntityType,
                  info.topEntityId,
                  entityType
                ),
                actionBreakdown,
              })
            ),
            eventId: info.eventId,
            actionUserId: info.actionUserId,
            created: info.created,
          });
        }
      }
    }

    const auditItems: EntityTimelineItem[] = trimmedEntries.map((entry) => {
      const key =
        entry.eventId !== null
          ? `event:${entry.eventId}`
          : `legacy:${entry.actionUserId}:${entry.created}:${entry.actionType}`;
      const ctx = cascadeContextMap.get(key) ?? null;
      const { eventId: _eventId, ...publicEntry } = entry;

      return {
        type: 'audit' as const,
        data: {
          entry: publicEntry,
          cascadeContext: ctx,
        } satisfies EntityTimelineEvent,
      };
    });

    const noteItems: EntityTimelineItem[] = (noteRows as AdminNoteRow[]).map(
      (row) => ({
        type: 'note' as const,
        data: mapAdminNoteRow(row),
      })
    );

    const items = mergeTimelineItems(auditItems, noteItems);

    return {
      page: currentPage,
      pageSize,
      pages,
      total,
      items,
      unauditedSubmission,
    };
  });

export const getAuditEventFeed = publicProcedure
  .input(EventFeedInputSchema)
  .output(EventFeedResponseSchema)
  .route({
    summary: 'Get audit event feed (grouped by transaction)',
    tags: ['audit'],
    method: 'GET',
    path: '/audit/events',
  })
  .handler(async ({ input, context }) => {
    const {
      cursor,
      limit,
      entityTypes,
      actionTypes,
      dateFrom,
      dateTo,
      adminUserId,
      fieldsChanged,
      entityId,
      showSystem,
    } = input;
    let decodedCursor: ReturnType<typeof decodeEventFeedCursor> | null = null;
    if (cursor) {
      try {
        decodedCursor = decodeEventFeedCursor(cursor);
      } catch {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Invalid audit event cursor',
        });
      }
    }

    const fieldsByEntityType = new Map<AuditEntityType, string[]>();
    if (fieldsChanged && fieldsChanged.length > 0) {
      for (const { entityType, fieldName } of fieldsChanged) {
        const existing = fieldsByEntityType.get(entityType) || [];
        fieldsByEntityType.set(entityType, [...existing, fieldName]);
      }
    }

    let tablesToQuery: { entityType: AuditEntityType }[];
    if (fieldsByEntityType.size > 0) {
      let targetTypes = Array.from(fieldsByEntityType.keys());
      if (entityTypes && entityTypes.length > 0) {
        targetTypes = targetTypes.filter((et) => entityTypes.includes(et));
      }
      tablesToQuery = targetTypes.map((entityType) => ({ entityType }));
    } else if (entityTypes && entityTypes.length > 0) {
      tablesToQuery = entityTypes.map((entityType) => ({ entityType }));
    } else {
      tablesToQuery = [...ALL_AUDIT_TABLES];
    }

    if (tablesToQuery.length === 0) {
      return { events: [], nextCursor: null, hasMore: false };
    }

    // Bound each table to its newest matching timestamps before the JSON aggregation
    const tableQueryParts = tablesToQuery.map(({ entityType }) => {
      const { fromClause, parentIdExpr } = getParentEntityJoinInfo(entityType);
      const eventKeyExpr = buildAuditEventKeyExpression(parentIdExpr);

      const conditions: ReturnType<typeof sql>[] = [];

      if (!showSystem) {
        conditions.push(sql`a.action_user_id IS NOT NULL`);
      }

      if (adminUserId !== undefined) {
        conditions.push(sql`a.action_user_id = ${adminUserId}`);
      }

      if (decodedCursor) {
        conditions.push(
          decodedCursor.eventKey !== null
            ? sql`(
                a.created < ${decodedCursor.created}::timestamptz
                OR (
                  a.created = ${decodedCursor.created}::timestamptz
                  AND ${eventKeyExpr} < ${decodedCursor.eventKey}
                )
              )`
            : sql`a.created < ${decodedCursor.created}::timestamptz`
        );
      }

      if (actionTypes && actionTypes.length > 0) {
        if (actionTypes.length === 1) {
          conditions.push(sql`a.action_type = ${actionTypes[0]}`);
        } else {
          conditions.push(
            sql`a.action_type IN (${sql.join(
              actionTypes.map((a) => sql`${a}`),
              sql`, `
            )})`
          );
        }
      }

      if (dateFrom) {
        conditions.push(sql`a.created >= ${dateFrom}::timestamptz`);
      }

      if (dateTo) {
        conditions.push(sql`a.created <= ${dateTo}::timestamptz`);
      }

      if (entityId !== undefined) {
        conditions.push(sql`a.reference_id_lock = ${entityId}`);
      }

      const rawFieldNames = fieldsByEntityType.get(entityType);
      const entityFieldNames = rawFieldNames
        ? validateFieldNames(rawFieldNames)
        : undefined;
      if (entityFieldNames && entityFieldNames.length > 0) {
        const fieldConditions = buildFieldChangeConditions(
          sql.raw('a.changes'),
          entityFieldNames
        );
        conditions.push(or(...fieldConditions)!);
      }

      const whereClause =
        conditions.length > 0
          ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
          : sql``;
      const boundedWhereClause =
        conditions.length > 0
          ? sql`WHERE ${sql.join(conditions, sql` AND `)}
              AND a.created IN (SELECT created FROM candidate_timestamps)`
          : sql`WHERE a.created IN (SELECT created FROM candidate_timestamps)`;

      const candidateTimestampQuery = sql`
        SELECT recent.created
        FROM (
          SELECT DISTINCT a.created
          FROM ${sql.raw(fromClause)}
          ${whereClause}
          ORDER BY a.created DESC
          LIMIT ${limit + 1}
        ) recent
      `;

      const groupedQuery = sql`
        SELECT
          ${eventKeyExpr} AS event_key,
          a.event_id::text AS event_id,
          ${entityType}::int AS entity_type,
          a.action_user_id,
          a.created,
          ARRAY_AGG(DISTINCT a.action_type ORDER BY a.action_type) AS action_types,
          ${sql.raw(parentIdExpr)} AS parent_entity_id,
          COUNT(DISTINCT a.reference_id_lock)::int AS count,
          COUNT(*)::int AS entry_count,
          ${verificationStatusCountsExpr} AS verification_status_counts,
          ARRAY(
            SELECT DISTINCT field_name
            FROM unnest(array_agg(a.changes)) AS grouped_changes(change)
            CROSS JOIN LATERAL jsonb_object_keys(
              COALESCE(grouped_changes.change, '{}'::jsonb)
            ) AS fields(field_name)
            ORDER BY field_name
          ) AS changed_fields,
          (array_agg(a.changes ORDER BY a.id DESC))[1] AS sample_changes,
          (array_agg(a.reference_id_lock ORDER BY a.id DESC))[1] AS sample_entity_id
        FROM ${sql.raw(fromClause)}
        ${normalizedChangesJoin}
        ${boundedWhereClause}
        GROUP BY
          ${eventKeyExpr},
          a.event_id,
          a.action_user_id,
          a.created,
          parent_entity_id
      `;

      return { candidateTimestampQuery, groupedQuery };
    });

    const candidateTimestampQueries = tableQueryParts.map(
      ({ candidateTimestampQuery }) => candidateTimestampQuery
    );
    const groupedQueries = tableQueryParts.map(
      ({ groupedQuery }) => groupedQuery
    );

    const cursorCondition = decodedCursor
      ? decodedCursor.eventKey !== null
        ? sql`WHERE
            created < ${decodedCursor.created}::timestamptz
            OR (
              created = ${decodedCursor.created}::timestamptz
              AND event_key < ${decodedCursor.eventKey}
            )`
        : sql`WHERE created < ${decodedCursor.created}::timestamptz`
      : sql``;

    const query = sql`
      WITH candidate_timestamps AS MATERIALIZED (
        ${sql.join(candidateTimestampQueries, sql` UNION ALL `)}
      ),
      grouped_rows AS MATERIALIZED (
        ${sql.join(groupedQueries, sql` UNION ALL `)}
      ),
      event_candidates AS (
        SELECT event_key, MAX(created) AS created
        FROM grouped_rows
        GROUP BY event_key
      ),
      paged_events AS (
        SELECT event_key, created
        FROM event_candidates
        ${cursorCondition}
        ORDER BY created DESC, event_key DESC
        LIMIT ${limit + 1}
      )
      SELECT
        grouped_rows.*,
        paged_events.created AS event_created
      FROM paged_events
      JOIN grouped_rows USING (event_key)
      ORDER BY
        paged_events.created DESC,
        paged_events.event_key DESC,
        grouped_rows.entity_type,
        grouped_rows.parent_entity_id NULLS LAST
    `;

    // The planner expects about a thousand game and score rows per candidate
    // timestamp, often far more than there are. It then hashes every score,
    // game and match to find the rows' tournaments, and its cost estimate
    // crosses the JIT threshold, which spent a second compiling. Looking each
    // row's tournament up by its key stays proportional to the rows found.
    const result = await context.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL jit = off`);
      await tx.execute(sql`SET LOCAL enable_hashjoin = off`);
      await tx.execute(sql`SET LOCAL enable_mergejoin = off`);
      return tx.execute(query);
    });
    const rows = result.rows as GroupedEventRow[];
    const pagedEventKeys = [...new Set(rows.map((row) => row.event_key))];
    const hasMore = pagedEventKeys.length > limit;
    const selectedEventKeys = pagedEventKeys.slice(0, limit);
    const selectedEventKeySet = new Set(selectedEventKeys);
    const trimmedRows = rows.filter((row) =>
      selectedEventKeySet.has(row.event_key)
    );

    const groupedRows: GroupedAuditRow[] = trimmedRows.map((row) => ({
      eventKey: row.event_key,
      eventId: row.event_id === null ? null : Number(row.event_id),
      actionUserId: row.action_user_id,
      created: row.created,
      actionTypes: row.action_types as AuditActionType[],
      entityType: row.entity_type as AuditEntityType,
      parentEntityId: row.parent_entity_id,
      entryCount: row.count,
      auditEntryCount: row.entry_count,
      verificationStatusCounts: row.verification_status_counts ?? [],
      changedFields: row.changed_fields ?? [],
      sampleChanges: row.sample_changes as Record<string, unknown> | null,
      sampleEntityId: row.sample_entity_id,
    }));

    // Only safe once every row belonging to the selected events is loaded
    const assembledEvents = assembleEvents(groupedRows);

    const actionUserIds = [
      ...new Set(
        assembledEvents
          .map((e) => e.actionUserId)
          .filter((id): id is number => id !== null)
      ),
    ];
    const userMap =
      actionUserIds.length > 0
        ? await resolveUserIds(context.db, actionUserIds)
        : new Map<number, ReferencedUser>();

    const parentTournamentIds = [
      ...new Set(
        assembledEvents
          .map((e) => e.parentEntityId)
          .filter((id): id is number => id !== null)
      ),
    ];
    const tournamentNameMap =
      parentTournamentIds.length > 0
        ? await resolveTournamentNames(context.db, parentTournamentIds)
        : new Map<number, string>();

    const entityNameMaps = await resolveEntityNamesBatched(
      context.db,
      assembledEvents.map((e) => ({
        entityType: e.topEntityType,
        entityId: e.topEntityId,
      }))
    );

    const cascadeCountParents = new Map<
      string,
      { entityType: AuditEntityType; entityId: number }
    >();
    for (const event of assembledEvents) {
      if (
        !event.isCascade ||
        event.childEntityType === null ||
        event.childAffectedCount === 0
      )
        continue;
      const countParent = getCascadeCountParent(
        event.topEntityType,
        event.topEntityId,
        event.topEntityCount,
        event.parentEntityId
      );
      if (countParent !== null) {
        cascadeCountParents.set(event.eventKey, countParent);
      }
    }

    const childTotal = await countChildLevels(
      context.db,
      assembledEvents.flatMap((event) => {
        const countParent = cascadeCountParents.get(event.eventKey);
        if (countParent === undefined || event.childEntityType === null) {
          return [];
        }
        return [
          {
            parentType: countParent.entityType,
            parentId: countParent.entityId,
            childType: event.childEntityType,
          },
        ];
      })
    );

    const allRefUserIds: number[] = [];
    for (const event of assembledEvents) {
      if (event.sampleChanges) {
        const ids = extractUserIdsFromChanges(
          event.sampleChanges as Record<
            string,
            { originalValue?: unknown; newValue?: unknown }
          >
        );
        allRefUserIds.push(...ids);
      }
    }
    const refUserMap = await resolveUserIds(context.db, allRefUserIds);

    const events: AuditEvent[] = assembledEvents.map((event) => {
      const actionUser = event.actionUserId
        ? (userMap.get(event.actionUserId) ?? null)
        : null;

      const topEntityNameMap = entityNameMaps.get(event.topEntityType);
      const topEntityName = topEntityNameMap?.get(event.topEntityId) ?? null;

      let parentTournament: AuditEvent['parentTournament'] = null;
      if (
        event.topEntityType !== AuditEntityType.Tournament &&
        event.parentEntityId !== null
      ) {
        parentTournament = {
          id: event.parentEntityId,
          name: tournamentNameMap.get(event.parentEntityId) ?? null,
        };
      }

      let childLevel: AuditEvent['childLevel'] = null;
      if (event.childEntityType !== null && event.childAffectedCount > 0) {
        const countParent = cascadeCountParents.get(event.eventKey);
        const totalCount = countParent
          ? childTotal(
              countParent.entityType,
              countParent.entityId,
              event.childEntityType
            )
          : null;
        childLevel = {
          entityType: event.childEntityType,
          affectedCount: event.childAffectedCount,
          totalCount,
          actionBreakdown: event.childActionBreakdown,
        };
      }

      const referencedUsers = buildReferencedUsers(
        event.sampleChanges,
        refUserMap
      );

      return {
        eventKey: event.eventKey,
        eventId: event.eventId,
        action: event.action,
        actionBreakdown: event.actionBreakdown,
        actionUserId: event.actionUserId,
        actionUser: actionUser
          ? {
              id: actionUser.id,
              playerId: actionUser.playerId,
              osuId: actionUser.osuId,
              username: actionUser.username,
            }
          : null,
        created: event.created,
        isSystem: event.isSystem,
        topEntity: {
          entityType: event.topEntityType,
          entityId: event.topEntityId,
          entityName: topEntityName,
          count: event.topEntityCount,
          entryCount: event.topEntryCount,
        },
        childLevel,
        isCascade: event.isCascade,
        parentTournament,
        changedFields: event.changedFields,
        sampleChanges: event.sampleChanges,
        referencedUsers,
      };
    });

    const lastEventKey = selectedEventKeys[selectedEventKeys.length - 1];
    const lastEventRow = lastEventKey
      ? trimmedRows.find((row) => row.event_key === lastEventKey)
      : undefined;
    const nextCursor =
      hasMore && lastEventKey && lastEventRow
        ? encodeEventFeedCursor({
            created: lastEventRow.event_created,
            eventKey: lastEventKey,
          })
        : null;

    return { events, nextCursor, hasMore };
  });

export const getEventDetails = publicProcedure
  .input(EventDetailsInputSchema)
  .output(EventDetailsResponseSchema)
  .route({
    summary: 'Get individual entries for an audit event',
    tags: ['audit'],
    method: 'GET',
    path: '/audit/event-details',
  })
  .handler(async ({ input, context }) => {
    const {
      eventKey,
      eventId,
      actionUserId,
      created,
      entityType,
      cursor,
      limit,
    } = input;

    const tablesToQuery =
      entityType !== undefined ? [{ entityType }] : [...ALL_AUDIT_TABLES];

    const tableQueries = tablesToQuery.map(({ entityType: et }) => {
      const { fromClause, parentIdExpr } = getParentEntityJoinInfo(et);
      const eventKeyExpr = buildAuditEventKeyExpression(parentIdExpr);
      const userCondition =
        actionUserId !== null
          ? sql`a.action_user_id = ${actionUserId}`
          : sql`a.action_user_id IS NULL`;

      const conditions = eventId
        ? [
            sql`a.event_id = ${eventId}`,
            sql`a.created = ${created}::timestamptz`,
          ]
        : eventKey
          ? [
              userCondition,
              sql`a.created = ${created}::timestamptz`,
              sql`${eventKeyExpr} = ${eventKey}`,
            ]
          : [userCondition, sql`a.created = ${created}::timestamptz`];

      if (cursor !== undefined) {
        conditions.push(sql`(a.id::bigint * 4 + ${et}) < ${cursor}`);
      }

      return sql`
        SELECT
          a.id,
          ${et}::int AS entity_type,
          a.created,
          a.reference_id_lock,
          a.reference_id,
          a.action_user_id,
          a.action_type,
          a.changes,
          (a.id::bigint * 4 + ${et}) AS entry_cursor,
          u.id AS user_id,
          p.id AS player_id,
          p.osu_id,
          p.username
        FROM ${sql.raw(fromClause)}
        LEFT JOIN users u ON u.id = a.action_user_id
        LEFT JOIN players p ON p.id = u.player_id
        WHERE ${sql.join(conditions, sql` AND `)}
      `;
    });

    const query = sql`
      SELECT * FROM (
        ${sql.join(tableQueries, sql` UNION ALL `)}
      ) combined
      ORDER BY entry_cursor DESC
      LIMIT ${limit + 1}
    `;

    const result = await context.db.execute(query);
    const rows = result.rows as {
      id: number;
      entity_type: number;
      created: string;
      reference_id_lock: number;
      reference_id: number | null;
      action_user_id: number | null;
      action_type: number;
      changes: unknown;
      entry_cursor: string;
      user_id: number | null;
      player_id: number | null;
      osu_id: string | null; // bigint returned as string by node-postgres
      username: string | null;
    }[];

    const hasMore = rows.length > limit;
    const trimmedRows = hasMore ? rows.slice(0, limit) : rows;

    const allRefUserIds: number[] = [];
    const normalizedChangesList: (Record<string, unknown> | null)[] = [];
    for (const row of trimmedRows) {
      const changes = camelizeChangesKeys(
        row.changes as Record<string, unknown> | null
      );
      normalizedChangesList.push(changes);
      const ids = extractUserIdsFromChanges(
        changes as Record<
          string,
          { originalValue?: unknown; newValue?: unknown }
        > | null
      );
      allRefUserIds.push(...ids);
    }
    const refUserMap = await resolveUserIds(context.db, allRefUserIds);

    const entityNameMaps = await resolveEntityNamesBatched(
      context.db,
      trimmedRows.map((row) => ({
        entityType: row.entity_type as AuditEntityType,
        entityId: row.reference_id_lock,
      }))
    );

    const entries: AuditEntry[] = trimmedRows.map((row, i) => {
      const et = row.entity_type as AuditEntityType;
      const changes = normalizedChangesList[i];

      const referencedUsers = buildReferencedUsers(changes, refUserMap);

      const entityNameMap = entityNameMaps.get(et);

      return {
        id: row.id,
        entityType: et,
        referenceIdLock: row.reference_id_lock,
        referenceId: row.reference_id,
        actionUserId: row.action_user_id,
        actionType: row.action_type as AuditActionType,
        changes,
        created: row.created,
        actionUser: row.user_id
          ? {
              id: row.user_id,
              playerId: row.player_id,
              osuId: row.osu_id !== null ? Number(row.osu_id) : null,
              username: row.username,
            }
          : null,
        referencedUsers,
        entityName: entityNameMap?.get(row.reference_id_lock) ?? null,
      };
    });

    const nextCursor =
      hasMore && trimmedRows.length > 0
        ? Number(trimmedRows[trimmedRows.length - 1].entry_cursor)
        : null;

    return { entries, nextCursor, hasMore };
  });

export const getAuditEntityName = publicProcedure
  .input(AuditEntityNameInputSchema)
  .output(AuditEntityNameResponseSchema)
  .route({
    summary: 'Get the name of an audited entity, including a deleted match',
    tags: ['audit'],
    method: 'GET',
    path: '/audit/entity-name',
  })
  .handler(async ({ input, context }) => {
    const { entityType, entityId } = input;
    const names = await resolveEntityNames(context.db, entityType, [entityId]);
    return { entityName: names.get(entityId) ?? null };
  });
