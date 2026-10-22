import { and, desc, eq, inArray, notExists, sql, type SQL } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import { AuditActionType, AuditEntityType } from '@otr/core/osu';
import type {
  AuditEntry,
  AuditEventAction,
  AuditEventActionCount,
  EntityTimelineItem,
  UnauditedSubmission,
} from '@/lib/orpc/schema/audit';
import {
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_PLURALS,
} from '@/lib/audit-entity-types';
import { ACTION_LABELS, classifyAction } from '@/lib/audit-actions';
import type { DatabaseClient } from '@/lib/db';

export function getAuditTable(entityType: AuditEntityType) {
  switch (entityType) {
    case AuditEntityType.Tournament:
      return schema.tournamentAudits;
    case AuditEntityType.Match:
      return schema.matchAudits;
    case AuditEntityType.Game:
      return schema.gameAudits;
    case AuditEntityType.Score:
      return schema.gameScoreAudits;
    case AuditEntityType.Beatmap:
      return schema.beatmapAudits;
  }
}

export function getAdminNotesTable(entityType: AuditEntityType) {
  switch (entityType) {
    case AuditEntityType.Tournament:
      return schema.tournamentAdminNotes;
    case AuditEntityType.Match:
      return schema.matchAdminNotes;
    case AuditEntityType.Game:
      return schema.gameAdminNotes;
    case AuditEntityType.Score:
      return schema.gameScoreAdminNotes;
    case AuditEntityType.Beatmap:
      return schema.beatmapAdminNotes;
  }
}

export function getTableNameString(entityType: AuditEntityType): string {
  switch (entityType) {
    case AuditEntityType.Tournament:
      return 'tournament_audits';
    case AuditEntityType.Match:
      return 'match_audits';
    case AuditEntityType.Game:
      return 'game_audits';
    case AuditEntityType.Score:
      return 'game_score_audits';
    case AuditEntityType.Beatmap:
      return 'beatmap_audits';
  }
}

export function getAdminNotesTableNameString(
  entityType: AuditEntityType
): string {
  switch (entityType) {
    case AuditEntityType.Tournament:
      return 'tournament_admin_notes';
    case AuditEntityType.Match:
      return 'match_admin_notes';
    case AuditEntityType.Game:
      return 'game_admin_notes';
    case AuditEntityType.Score:
      return 'game_score_admin_notes';
    case AuditEntityType.Beatmap:
      return 'beatmap_admin_notes';
  }
}

/** Ordered to match AuditEntityType values. */
export const ALL_AUDIT_TABLES = [
  { table: schema.tournamentAudits, entityType: AuditEntityType.Tournament },
  { table: schema.matchAudits, entityType: AuditEntityType.Match },
  { table: schema.gameAudits, entityType: AuditEntityType.Game },
  { table: schema.gameScoreAudits, entityType: AuditEntityType.Score },
  { table: schema.beatmapAudits, entityType: AuditEntityType.Beatmap },
] as const;

/** FROM clause and parent tournament ID expression for an entity type's audit table. */
export function getParentEntityJoinInfo(entityType: AuditEntityType): {
  fromClause: string;
  parentIdExpr: string;
} {
  switch (entityType) {
    case AuditEntityType.Tournament:
      return {
        fromClause: 'tournament_audits a',
        parentIdExpr: 'a.reference_id_lock',
      };
    case AuditEntityType.Match:
      return {
        fromClause:
          'match_audits a LEFT JOIN matches m ON m.id = a.reference_id_lock',
        parentIdExpr: 'm.tournament_id',
      };
    case AuditEntityType.Game:
      return {
        fromClause:
          'game_audits a LEFT JOIN games g ON g.id = a.reference_id_lock LEFT JOIN matches m ON m.id = g.match_id',
        parentIdExpr: 'm.tournament_id',
      };
    case AuditEntityType.Score:
      return {
        fromClause:
          'game_score_audits a LEFT JOIN game_scores gs ON gs.id = a.reference_id_lock LEFT JOIN games g ON g.id = gs.game_id LEFT JOIN matches m ON m.id = g.match_id',
        parentIdExpr: 'm.tournament_id',
      };
    // Beatmaps sit outside the tournament hierarchy.
    case AuditEntityType.Beatmap:
      return {
        fromClause: 'beatmap_audits a',
        parentIdExpr: 'NULL::integer',
      };
  }
}

/** Stable event key shared by the feed and the legacy detail lookup. */
export function buildAuditEventKeyExpression(parentIdExpr: string): SQL {
  return sql`
    CASE
      WHEN a.event_id IS NOT NULL THEN 'event:' || a.event_id::text
      ELSE 'legacy:'
        || COALESCE(a.action_user_id::text, 'system') || ':'
        || to_char(
          a.created AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) || ':'
        || a.action_type::text || ':'
        || COALESCE((${sql.raw(parentIdExpr)})::text, 'none')
    END
  `;
}

function valuesAreEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function normalizeChangeValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, v] of Object.entries(obj)) {
    const lowerKey = key.replaceAll('_', '').toLowerCase();
    if (lowerKey === 'originalvalue') {
      result['originalValue'] = v;
    } else if (lowerKey === 'newvalue') {
      result['newValue'] = v;
    } else {
      result[key] = v;
    }
  }

  return result;
}

/** Generated search columns. Triggers skip them now, but older audit rows still carry them. */
const GENERATED_CHANGE_FIELDS = new Set(['searchVector', 'matchRankVector']);

/** Camelizes JSONB change keys and drops no-op and generated fields; triggers write snake_case, migrated rows camelCase. */
export function camelizeChangesKeys(
  changes: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!changes) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const snakeCamelKey = key.replace(/_([a-z])/g, (_, c: string) =>
      c.toUpperCase()
    );
    const camelKey =
      snakeCamelKey.charAt(0).toLowerCase() + snakeCamelKey.slice(1);
    if (GENERATED_CHANGE_FIELDS.has(camelKey)) continue;
    const normalizedValue = normalizeChangeValue(value);

    if (normalizedValue && typeof normalizedValue === 'object') {
      const { originalValue, newValue } = normalizedValue as {
        originalValue?: unknown;
        newValue?: unknown;
      };
      if (valuesAreEqual(originalValue, newValue)) {
        continue;
      }
    }

    result[camelKey] = normalizedValue;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Interleaves audit entries and admin notes, newest first. */
export function mergeTimelineItems(
  ...arrays: EntityTimelineItem[][]
): EntityTimelineItem[] {
  const merged = arrays.flat();
  merged.sort((a, b) => {
    const dateA = new Date(getTimelineItemCreated(a)).getTime();
    const dateB = new Date(getTimelineItemCreated(b)).getTime();
    return dateB - dateA;
  });
  return merged;
}

function getTimelineItemCreated(item: EntityTimelineItem): string {
  return item.type === 'audit' ? item.data.entry.created : item.data.created;
}

/** Merges audit entries from multiple tables, newest first. */
export function mergeAuditEntries(...arrays: AuditEntry[][]): AuditEntry[] {
  const merged = arrays.flat();
  merged.sort((a, b) => {
    const dateA = new Date(a.created).getTime();
    const dateB = new Date(b.created).getTime();
    return dateB - dateA;
  });
  return merged;
}

export function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

export type EventFeedCursor = {
  created: string;
  eventKey: string | null;
};

export function encodeEventFeedCursor(cursor: {
  created: string;
  eventKey: string;
}): string {
  return JSON.stringify(cursor);
}

/** Accepts the composite cursor or a legacy raw timestamp, which has no tie-break key. */
export function decodeEventFeedCursor(cursor: string): EventFeedCursor {
  try {
    const parsed = JSON.parse(cursor) as Partial<EventFeedCursor>;
    if (
      typeof parsed.created === 'string' &&
      typeof parsed.eventKey === 'string' &&
      !Number.isNaN(new Date(parsed.created).getTime())
    ) {
      return { created: parsed.created, eventKey: parsed.eventKey };
    }
  } catch {
    // Fall through to the legacy timestamp form.
  }

  if (!Number.isNaN(new Date(cursor).getTime())) {
    return { created: cursor, eventKey: null };
  }

  throw new Error('Invalid audit event cursor');
}

/** A grouped row from the per-table SQL query, before cross-table merging. */
export type GroupedAuditRow = {
  eventKey: string;
  eventId: number | null;
  actionUserId: number | null;
  created: string;
  actionTypes: AuditActionType[];
  entityType: AuditEntityType;
  parentEntityId: number | null;
  entryCount: number;
  auditEntryCount: number;
  /** `status:count` pairs; "null" is a cleared status. */
  verificationStatusCounts: string[];
  changedFields: string[];
  sampleChanges: Record<string, unknown> | null;
  sampleEntityId: number;
};

/** Tournament → Match → Game → Score → null. */
export function getImmediateChildType(
  entityType: AuditEntityType
): AuditEntityType | null {
  switch (entityType) {
    case AuditEntityType.Tournament:
      return AuditEntityType.Match;
    case AuditEntityType.Match:
      return AuditEntityType.Game;
    case AuditEntityType.Game:
      return AuditEntityType.Score;
    case AuditEntityType.Score:
      return null;
    case AuditEntityType.Beatmap:
      return null;
  }
}

export function extractChangedFields(
  sampleChanges: Record<string, unknown> | null
): string[] {
  if (!sampleChanges) return [];
  return Object.keys(sampleChanges).sort();
}

export type AssembledEvent = {
  eventKey: string;
  eventId: number | null;
  action: AuditEventAction;
  actionBreakdown: AuditEventActionCount[] | null;
  actionUserId: number | null;
  created: string;
  isSystem: boolean;
  topEntityType: AuditEntityType;
  topEntityId: number;
  topEntityCount: number;
  topEntryCount: number;
  childEntityType: AuditEntityType | null;
  childAffectedCount: number;
  /** Outcomes at the child level, only when they differ from `action`. */
  childActionBreakdown: AuditEventActionCount[] | null;
  isCascade: boolean;
  parentEntityId: number | null;
  /**
   * The tournament that bounds the cascade's counts. Null when any row has
   * left it, since the tournament then holds only what survived.
   */
  countParentEntityId: number | null;
  changedFields: string[];
  sampleChanges: Record<string, unknown> | null;
};

function classifyGroupedAuditRow(row: GroupedAuditRow): AuditEventAction {
  const actionTypes = new Set(row.actionTypes);
  if (actionTypes.size !== 1) return 'update';

  const actionType = actionTypes.values().next().value!;
  if (
    actionType === AuditActionType.Created ||
    actionType === AuditActionType.Deleted
  ) {
    return classifyAction(actionType, null);
  }

  const statusCounts = parseStatusCounts(row.verificationStatusCounts);
  if (statusCounts.size !== 1) return 'update';

  return classifyStatus(statusCounts.keys().next().value!, actionType);
}

function parseStatusCounts(pairs: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    const separator = pair.lastIndexOf(':');
    if (separator === -1) continue;
    const count = Number(pair.slice(separator + 1));
    if (!Number.isFinite(count)) continue;
    const status = pair.slice(0, separator);
    counts.set(status, (counts.get(status) ?? 0) + count);
  }
  return counts;
}

function classifyStatus(
  status: string,
  actionType: AuditActionType
): AuditEventAction {
  if (
    actionType === AuditActionType.Created ||
    actionType === AuditActionType.Deleted
  ) {
    return classifyAction(actionType, null);
  }
  if (status === 'null' || status === 'unchanged') return 'update';
  return classifyAction(actionType, {
    verificationStatus: {
      originalValue: null,
      newValue: Number(status),
    },
  });
}

const VERIFICATION_OUTCOMES = new Set<AuditEventAction>([
  'verification',
  'rejection',
  'pre_verification',
  'pre_rejection',
]);

/** The parts of a grouped row an outcome breakdown is counted from. */
export type BreakdownRow = Pick<
  GroupedAuditRow,
  'actionTypes' | 'entryCount' | 'verificationStatusCounts'
>;

/** Entities per outcome, for an event that wrote at least `minOutcomes` verification statuses. */
export function buildActionBreakdown(
  rows: BreakdownRow[],
  minOutcomes = 2
): AuditEventActionCount[] | null {
  const counts = new Map<AuditEventAction, number>();
  let counted = 0;
  let entities = 0;

  for (const row of rows) {
    const actionType =
      row.actionTypes.length === 1
        ? row.actionTypes[0]!
        : AuditActionType.Updated;
    entities += row.entryCount;
    for (const [status, count] of parseStatusCounts(
      row.verificationStatusCounts
    )) {
      const action = classifyStatus(status, actionType);
      counts.set(action, (counts.get(action) ?? 0) + count);
      counted += count;
    }
  }

  if (counts.size < minOutcomes || counted !== entities) return null;

  return Array.from(counts, ([action, count]) => ({ action, count })).sort(
    (a, b) =>
      b.count - a.count ||
      ACTION_LABELS[a.action].localeCompare(ACTION_LABELS[b.action])
  );
}

/** Breakdown worth showing next to `action`. */
export function buildOutcomeBreakdown(
  rows: BreakdownRow[],
  action: AuditEventAction
): AuditEventActionCount[] | null {
  const breakdown = buildActionBreakdown(rows, 1);
  if (!breakdown) return null;
  if (!breakdown.some((part) => VERIFICATION_OUTCOMES.has(part.action)))
    return null;
  if (breakdown.length === 1 && breakdown[0]!.action === action) return null;
  return breakdown;
}

function toCamelField(field: string): string {
  return field.replace(/_([a-z])/g, (_, character: string) =>
    character.toUpperCase()
  );
}

/** A tournament's dates follow its matches, so a change to them alone came from a match. */
const TOURNAMENT_DATE_FIELDS = new Set(['startTime', 'endTime']);

function onlyMovesTournamentDates(row: GroupedAuditRow): boolean {
  return (
    row.entityType === AuditEntityType.Tournament &&
    row.actionTypes.length === 1 &&
    row.actionTypes[0] === AuditActionType.Updated &&
    row.changedFields
      .map(toCamelField)
      .every(
        (field) =>
          TOURNAMENT_DATE_FIELDS.has(field) ||
          GENERATED_CHANGE_FIELDS.has(field)
      )
  );
}

/**
 * The rows an event's headline describes. Deleting, merging or removing a
 * match can move its tournament's dates in the same event; the match change
 * leads, not the dates it moved.
 */
function headlineRows(groupRows: GroupedAuditRow[]): GroupedAuditRow[] {
  const below = groupRows.filter(
    (row) => row.entityType !== AuditEntityType.Tournament
  );
  if (below.length === 0 || below.length === groupRows.length) {
    return groupRows;
  }
  return groupRows.every(
    (row) =>
      row.entityType !== AuditEntityType.Tournament ||
      onlyMovesTournamentDates(row)
  )
    ? below
    : groupRows;
}

/**
 * The one tournament the event's rows belong to, or null. A deleted row's
 * tournament is gone with it, so rows without one don't count.
 */
function eventTournament(groupRows: GroupedAuditRow[]): number | null {
  const tournaments = new Set(
    groupRows
      .map((row) => row.parentEntityId)
      .filter((id): id is number => id !== null)
  );
  return tournaments.size === 1 ? tournaments.values().next().value! : null;
}

/** Groups rows from multiple audit tables into events keyed by the database's event key. */
export function assembleEvents(rows: GroupedAuditRow[]): AssembledEvent[] {
  const eventMap = new Map<string, GroupedAuditRow[]>();
  for (const row of rows) {
    const existing = eventMap.get(row.eventKey);
    if (existing) {
      existing.push(row);
    } else {
      eventMap.set(row.eventKey, [row]);
    }
  }

  const events: AssembledEvent[] = [];

  for (const [eventKey, groupRows] of eventMap) {
    // Lowest entity type enum is highest in the hierarchy
    groupRows.sort(
      (a, b) =>
        a.entityType - b.entityType || b.sampleEntityId - a.sampleEntityId
    );

    const described = headlineRows(groupRows);
    const topRow = described[0]!;
    const topRows = described.filter(
      (row) => row.entityType === topRow.entityType
    );
    const isSystem = topRow.actionUserId === null;
    const normalizedChanges = camelizeChangesKeys(topRow.sampleChanges);
    const classifiedActions = new Set(
      topRows.map((row) => classifyGroupedAuditRow(row))
    );
    const action =
      classifiedActions.size === 1
        ? classifiedActions.values().next().value!
        : ('update' as const);

    const entityTypes = new Set(described.map((r) => r.entityType));
    const isCascade = entityTypes.size > 1;

    const topEntityCount = topRows.reduce(
      (total, row) => total + row.entryCount,
      0
    );
    const topEntryCount = topRows.reduce(
      (total, row) => total + row.auditEntryCount,
      0
    );
    const changedFields = new Set<string>();
    for (const row of topRows) {
      for (const field of row.changedFields) {
        const camelField = toCamelField(field);
        if (!GENERATED_CHANGE_FIELDS.has(camelField)) {
          changedFields.add(camelField);
        }
      }
    }

    const parentEntityId = eventTournament(groupRows);
    const countParentEntityId = groupRows.every(
      (row) => row.parentEntityId === parentEntityId
    )
      ? parentEntityId
      : null;

    const childType = getImmediateChildType(topRow.entityType);
    const childRows =
      childType === null
        ? []
        : described.filter((row) => row.entityType === childType);
    const childAffectedCount = childRows.reduce(
      (total, row) => total + row.entryCount,
      0
    );
    const childActionBreakdown = buildOutcomeBreakdown(childRows, action);

    events.push({
      eventKey,
      eventId: topRow.eventId,
      action,
      actionBreakdown: buildActionBreakdown(topRows),
      actionUserId: topRow.actionUserId,
      created: topRow.created,
      isSystem,
      topEntityType: topRow.entityType,
      topEntityId: topRow.sampleEntityId,
      topEntityCount,
      topEntryCount,
      childEntityType: childType,
      childAffectedCount,
      childActionBreakdown,
      isCascade,
      parentEntityId,
      countParentEntityId,
      changedFields: [...changedFields].sort(),
      sampleChanges: normalizedChanges,
    });
  }

  return events.sort(
    (a, b) =>
      new Date(b.created).getTime() - new Date(a.created).getTime() ||
      b.eventKey.localeCompare(a.eventKey)
  );
}

/** Cascade summary for the entity timeline, e.g. "also affected 85 of 118 matches". */
export function buildChildSummary(
  childType: AuditEntityType,
  affected: number,
  total: number | null
): string {
  const showsTotal = total !== null && total > affected;
  const counted = showsTotal ? total : affected;
  const label =
    counted === 1
      ? ENTITY_TYPE_LABELS[childType]
      : ENTITY_TYPE_PLURALS[childType];

  if (showsTotal) {
    return `also affected ${affected} of ${total} ${label}`;
  }
  return `also affected ${affected} ${label}`;
}

/** The entity a cascade's counts are bounded by. */
export function getCascadeCountParent(
  topEntityType: AuditEntityType,
  topEntityId: number,
  topEntityCount: number,
  parentTournamentId: number | null
): { entityType: AuditEntityType; entityId: number } | null {
  if (topEntityCount === 1) {
    return { entityType: topEntityType, entityId: topEntityId };
  }
  if (parentTournamentId === null) return null;
  return {
    entityType: AuditEntityType.Tournament,
    entityId: parentTournamentId,
  };
}

function countEntitiesUnder(
  db: DatabaseClient,
  parentType: AuditEntityType,
  parentIds: number[],
  childType: AuditEntityType
): Promise<{ id: number; cnt: number }[]> | null {
  const cnt = sql<number>`count(*)::int`;

  if (parentType === AuditEntityType.Tournament) {
    if (childType === AuditEntityType.Match) {
      return db
        .select({ id: schema.matches.tournamentId, cnt })
        .from(schema.matches)
        .where(inArray(schema.matches.tournamentId, parentIds))
        .groupBy(schema.matches.tournamentId);
    }
    if (childType === AuditEntityType.Game) {
      return db
        .select({ id: schema.matches.tournamentId, cnt })
        .from(schema.games)
        .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
        .where(inArray(schema.matches.tournamentId, parentIds))
        .groupBy(schema.matches.tournamentId);
    }
    if (childType === AuditEntityType.Score) {
      return db
        .select({ id: schema.matches.tournamentId, cnt })
        .from(schema.gameScores)
        .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
        .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
        .where(inArray(schema.matches.tournamentId, parentIds))
        .groupBy(schema.matches.tournamentId);
    }
    return null;
  }

  if (parentType === AuditEntityType.Match) {
    if (childType === AuditEntityType.Game) {
      return db
        .select({ id: schema.games.matchId, cnt })
        .from(schema.games)
        .where(inArray(schema.games.matchId, parentIds))
        .groupBy(schema.games.matchId);
    }
    if (childType === AuditEntityType.Score) {
      return db
        .select({ id: schema.games.matchId, cnt })
        .from(schema.gameScores)
        .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
        .where(inArray(schema.games.matchId, parentIds))
        .groupBy(schema.games.matchId);
    }
    return null;
  }

  if (
    parentType === AuditEntityType.Game &&
    childType === AuditEntityType.Score
  ) {
    return db
      .select({ id: schema.gameScores.gameId, cnt })
      .from(schema.gameScores)
      .where(inArray(schema.gameScores.gameId, parentIds))
      .groupBy(schema.gameScores.gameId);
  }

  return null;
}

/** Totals for cascade fractions, one query per parent and child type pair. */
export async function countChildLevels(
  db: DatabaseClient,
  levels: {
    parentType: AuditEntityType;
    parentId: number;
    childType: AuditEntityType;
  }[]
): Promise<
  (
    parentType: AuditEntityType,
    parentId: number,
    childType: AuditEntityType
  ) => number | null
> {
  const parentIdsByLevel = new Map<string, Set<number>>();
  for (const { parentType, parentId, childType } of levels) {
    const levelKey = `${parentType}:${childType}`;
    const existing = parentIdsByLevel.get(levelKey);
    if (existing) {
      existing.add(parentId);
    } else {
      parentIdsByLevel.set(levelKey, new Set([parentId]));
    }
  }

  const counts = new Map<string, number>();
  await Promise.all(
    Array.from(parentIdsByLevel.entries()).map(
      async ([levelKey, parentIds]) => {
        const [parentType, childType] = levelKey.split(':').map(Number) as [
          AuditEntityType,
          AuditEntityType,
        ];
        const rows = countEntitiesUnder(
          db,
          parentType,
          [...parentIds],
          childType
        );
        if (rows === null) return;
        for (const row of await rows) {
          counts.set(`${levelKey}:${row.id}`, row.cnt);
        }
      }
    )
  );

  return (parentType, parentId, childType) =>
    counts.get(`${parentType}:${childType}:${parentId}`) ?? null;
}

/** Change fields holding user IDs that need resolution. */
export const USER_ID_FIELDS = ['verifiedByUserId', 'submittedByUserId'];

export type ReferencedUser = {
  id: number;
  playerId: number | null;
  osuId: number | null;
  username: string | null;
};

export function extractUserIdsFromChanges(
  changes: Record<
    string,
    { originalValue?: unknown; newValue?: unknown }
  > | null
): number[] {
  if (!changes) return [];
  const ids: number[] = [];
  for (const field of USER_ID_FIELDS) {
    const change = changes[field];
    if (change) {
      if (typeof change.originalValue === 'number')
        ids.push(change.originalValue);
      if (typeof change.newValue === 'number') ids.push(change.newValue);
    }
  }
  return ids;
}

export function buildReferencedUsers(
  changes: Record<string, unknown> | null,
  userMap: Map<number, ReferencedUser>
): Record<string, ReferencedUser> | undefined {
  if (!changes) return undefined;

  const userIds = extractUserIdsFromChanges(
    changes as Record<string, { originalValue?: unknown; newValue?: unknown }>
  );
  if (userIds.length === 0) return undefined;

  const result: Record<string, ReferencedUser> = {};
  for (const id of userIds) {
    const user = userMap.get(id);
    if (user) {
      result[String(id)] = user;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Conditions asserting a JSONB changes field is present and its newValue differs. */
export function buildFieldChangeConditions(
  changesExpr: SQL,
  fieldNames: string[]
): SQL[] {
  return fieldNames.map((name) => {
    const snakeName = camelToSnake(name);
    const sameCase = name === snakeName;
    const hasKey = sameCase
      ? sql`${changesExpr} ? ${name}`
      : sql`(${changesExpr} ? ${name} OR ${changesExpr} ? ${snakeName})`;
    const valueCheck = sameCase
      ? sql`(
          COALESCE(${changesExpr}->${name}->>'NewValue', ${changesExpr}->${name}->>'newValue')
          IS DISTINCT FROM
          COALESCE(${changesExpr}->${name}->>'OriginalValue', ${changesExpr}->${name}->>'originalValue')
        )`
      : sql`(
          COALESCE(
            ${changesExpr}->${name}->>'NewValue',
            ${changesExpr}->${name}->>'newValue',
            ${changesExpr}->${snakeName}->>'NewValue',
            ${changesExpr}->${snakeName}->>'newValue'
          )
          IS DISTINCT FROM
          COALESCE(
            ${changesExpr}->${name}->>'OriginalValue',
            ${changesExpr}->${name}->>'originalValue',
            ${changesExpr}->${snakeName}->>'OriginalValue',
            ${changesExpr}->${snakeName}->>'originalValue'
          )
        )`;
    return sql`(${hasKey} AND ${valueCheck})`;
  });
}

/** Only tournaments, matches, and beatmaps have name fields. */
export async function resolveEntityNames(
  db: DatabaseClient,
  entityType: AuditEntityType,
  entityIds: number[]
): Promise<Map<number, string>> {
  if (entityIds.length === 0) return new Map();

  if (entityType === AuditEntityType.Tournament) {
    return resolveTournamentNames(db, entityIds);
  }

  if (entityType === AuditEntityType.Match) {
    const rows = await db
      .select({ id: schema.matches.id, name: schema.matches.name })
      .from(schema.matches)
      .where(inArray(schema.matches.id, entityIds));
    const names = new Map(rows.map((r) => [r.id, r.name]));

    const deletedIds = entityIds.filter((id) => !names.has(id));
    for (const [id, name] of await resolveDeletedMatchNames(db, deletedIds)) {
      names.set(id, name);
    }
    return names;
  }

  if (entityType === AuditEntityType.Beatmap) {
    const rows = await db
      .select({ id: schema.beatmaps.id, name: schema.beatmaps.diffName })
      .from(schema.beatmaps)
      .where(inArray(schema.beatmaps.id, entityIds));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  return new Map();
}

/** A deleted match keeps its name only in its deletion audit. */
async function resolveDeletedMatchNames(
  db: DatabaseClient,
  matchIds: number[]
): Promise<Map<number, string>> {
  if (matchIds.length === 0) return new Map();

  const deletedName = sql<string>`${schema.matchAudits.changes} -> 'name' ->> 'originalValue'`;
  const rows = await db
    .selectDistinctOn([schema.matchAudits.referenceIdLock], {
      id: schema.matchAudits.referenceIdLock,
      name: deletedName,
    })
    .from(schema.matchAudits)
    .where(
      and(
        inArray(schema.matchAudits.referenceIdLock, matchIds),
        eq(schema.matchAudits.actionType, AuditActionType.Deleted),
        // Matches deleted before their data was fetched have an empty name.
        sql`${deletedName} <> ''`
      )
    )
    .orderBy(schema.matchAudits.referenceIdLock, desc(schema.matchAudits.id));

  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function resolveTournamentNames(
  db: DatabaseClient,
  tournamentIds: number[]
): Promise<Map<number, string>> {
  const rows = await db
    .select({
      id: schema.tournaments.id,
      name: schema.tournaments.name,
    })
    .from(schema.tournaments)
    .where(inArray(schema.tournaments.id, tournamentIds));

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.id, row.name);
  }
  return map;
}

export async function resolveEntityNamesBatched(
  db: DatabaseClient,
  entries: { entityType: AuditEntityType; entityId: number }[]
): Promise<Map<AuditEntityType, Map<number, string>>> {
  const entityIdsByType = new Map<AuditEntityType, number[]>();
  for (const { entityType, entityId } of entries) {
    const existing = entityIdsByType.get(entityType) || [];
    entityIdsByType.set(entityType, [...existing, entityId]);
  }

  const entityNameMaps = new Map<AuditEntityType, Map<number, string>>();
  await Promise.all(
    Array.from(entityIdsByType.entries()).map(async ([et, ids]) => {
      const nameMap = await resolveEntityNames(db, et, [...new Set(ids)]);
      entityNameMaps.set(et, nameMap);
    })
  );

  return entityNameMaps;
}

export async function resolveUserIds(
  db: DatabaseClient,
  userIds: number[]
): Promise<Map<number, ReferencedUser>> {
  if (userIds.length === 0) return new Map();

  const uniqueIds = [...new Set(userIds)];
  const rows = await db
    .select({
      userId: schema.users.id,
      playerId: schema.players.id,
      osuId: schema.players.osuId,
      username: schema.players.username,
    })
    .from(schema.users)
    .leftJoin(schema.players, eq(schema.players.id, schema.users.playerId))
    .where(inArray(schema.users.id, uniqueIds));

  const map = new Map<number, ReferencedUser>();
  for (const row of rows) {
    map.set(row.userId, {
      id: row.userId,
      playerId: row.playerId,
      osuId: row.osuId,
      username: row.username,
    });
  }
  return map;
}

/** Creations were not audited before October 2025, so older tournaments only record their submission on themselves. */
export async function getUnauditedSubmission(
  db: DatabaseClient,
  tournamentId: number
): Promise<UnauditedSubmission | null> {
  const [tournament] = await db
    .select({
      created: schema.tournaments.created,
      submittedByUserId: schema.tournaments.submittedByUserId,
    })
    .from(schema.tournaments)
    .where(
      and(
        eq(schema.tournaments.id, tournamentId),
        notExists(
          db
            .select({ id: schema.tournamentAudits.id })
            .from(schema.tournamentAudits)
            .where(
              and(
                eq(
                  schema.tournamentAudits.referenceIdLock,
                  schema.tournaments.id
                ),
                eq(schema.tournamentAudits.actionType, AuditActionType.Created)
              )
            )
        )
      )
    );

  if (!tournament) return null;

  const { created, submittedByUserId } = tournament;
  if (submittedByUserId === null) return { created, submittedBy: null };

  const users = await resolveUserIds(db, [submittedByUserId]);
  return { created, submittedBy: users.get(submittedByUserId) ?? null };
}
