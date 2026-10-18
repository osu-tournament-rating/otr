import { describe, expect, it } from 'bun:test';
import { AuditActionType, AuditEntityType } from '@otr/core/osu';

import {
  assembleEvents,
  buildChildSummary,
  camelizeChangesKeys,
  decodeEventFeedCursor,
  encodeEventFeedCursor,
  getCascadeCountParent,
  type GroupedAuditRow,
} from '../helpers';

const CREATED = '2026-07-11T20:00:00.000Z';

function groupedRow(overrides: Partial<GroupedAuditRow> = {}): GroupedAuditRow {
  return {
    eventKey: 'event:1',
    eventId: 1,
    actionUserId: 7,
    created: CREATED,
    actionTypes: [AuditActionType.Updated],
    entityType: AuditEntityType.Tournament,
    parentEntityId: 10,
    entryCount: 1,
    auditEntryCount: 1,
    verificationStatusCounts: [],
    changedFields: ['name'],
    sampleChanges: {
      name: { originalValue: 'Old', newValue: 'New' },
    },
    sampleEntityId: 10,
    ...overrides,
  };
}

describe('assembleEvents', () => {
  it('keeps distinct event IDs separate even when actor and timestamp match', () => {
    const events = assembleEvents([
      groupedRow(),
      groupedRow({
        eventKey: 'event:2',
        eventId: 2,
        sampleEntityId: 11,
        parentEntityId: 11,
      }),
    ]);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.eventId).sort()).toEqual([1, 2]);
  });

  it('keeps equal-timestamp legacy events from different parents separate', () => {
    const events = assembleEvents([
      groupedRow({
        eventKey: `legacy:7:${CREATED}:1:10`,
        eventId: null,
      }),
      groupedRow({
        eventKey: `legacy:7:${CREATED}:1:11`,
        eventId: null,
        parentEntityId: 11,
        sampleEntityId: 11,
      }),
    ]);

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.eventId === null)).toBe(true);
  });

  it('assembles one event across the full entity hierarchy', () => {
    const rows: GroupedAuditRow[] = [
      groupedRow(),
      groupedRow({
        entityType: AuditEntityType.Match,
        entryCount: 3,
        auditEntryCount: 3,
        sampleEntityId: 20,
      }),
      groupedRow({
        entityType: AuditEntityType.Game,
        entryCount: 12,
        auditEntryCount: 12,
        sampleEntityId: 30,
      }),
      groupedRow({
        entityType: AuditEntityType.Score,
        entryCount: 48,
        auditEntryCount: 48,
        sampleEntityId: 40,
      }),
    ];

    const [event] = assembleEvents(rows);

    expect(event.isCascade).toBe(true);
    expect(event.topEntityType).toBe(AuditEntityType.Tournament);
    expect(event.topEntityCount).toBe(1);
    expect(event.childEntityType).toBe(AuditEntityType.Match);
    expect(event.childAffectedCount).toBe(3);
  });

  it('sums every top-level group and unions its changed fields', () => {
    const rows = Array.from({ length: 285 }, (_, index) =>
      groupedRow({
        entryCount: 1,
        parentEntityId: index + 1,
        sampleEntityId: index + 1,
        changedFields: index === 0 ? ['submitted_by_user_id'] : ['name'],
        sampleChanges:
          index === 0
            ? {
                submitted_by_user_id: {
                  originalValue: null,
                  newValue: 7,
                },
              }
            : {
                name: {
                  originalValue: `Old ${index}`,
                  newValue: `New ${index}`,
                },
              },
      })
    );

    const [event] = assembleEvents(rows);

    expect(event.topEntityCount).toBe(285);
    expect(event.parentEntityId).toBeNull();
    expect(event.changedFields).toEqual(['name', 'submittedByUserId']);
  });

  it('leaves generated search columns out of the changed fields', () => {
    const [event] = assembleEvents([
      groupedRow({
        changedFields: ['match_rank_vector', 'name', 'search_vector'],
      }),
    ]);

    expect(event.changedFields).toEqual(['name']);
  });

  it('does not aggregate separate system events', () => {
    const events = assembleEvents([
      groupedRow({ eventKey: 'event:1', eventId: 1, actionUserId: null }),
      groupedRow({
        eventKey: 'event:2',
        eventId: 2,
        actionUserId: null,
        sampleEntityId: 11,
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  it('labels a system rejection cascade as a rejection', () => {
    const [event] = assembleEvents([
      groupedRow({ actionUserId: null, verificationStatusCounts: ['3:1'] }),
      groupedRow({
        actionUserId: null,
        entityType: AuditEntityType.Match,
        verificationStatusCounts: ['3:4'],
        sampleEntityId: 11,
      }),
    ]);

    expect(event.action).toBe('rejection');
    expect(event.isSystem).toBe(true);
  });

  it('uses a generic action and exposes repeated writes for mixed actions', () => {
    const [event] = assembleEvents([
      groupedRow({
        actionTypes: [AuditActionType.Created, AuditActionType.Updated],
        entryCount: 1,
        auditEntryCount: 2,
      }),
    ]);

    expect(event.action).toBe('update');
    expect(event.topEntityCount).toBe(1);
    expect(event.topEntryCount).toBe(2);
  });

  it('keeps a single outcome without a breakdown', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 12, verificationStatusCounts: ['4:12'] }),
    ]);

    expect(event.action).toBe('verification');
    expect(event.actionBreakdown).toBeNull();
  });

  it('breaks down two verification outcomes in one group', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 15, verificationStatusCounts: ['3:12', '4:3'] }),
    ]);

    expect(event.action).toBe('update');
    expect(event.actionBreakdown).toEqual([
      { action: 'rejection', count: 12 },
      { action: 'verification', count: 3 },
    ]);
  });

  it('breaks down three verification outcomes in one group', () => {
    const [event] = assembleEvents([
      groupedRow({
        entryCount: 9,
        verificationStatusCounts: ['1:2', '2:3', '4:4'],
      }),
    ]);

    expect(event.actionBreakdown).toEqual([
      { action: 'verification', count: 4 },
      { action: 'pre_verification', count: 3 },
      { action: 'pre_rejection', count: 2 },
    ]);
  });

  it('counts untouched statuses as ordinary updates', () => {
    const [event] = assembleEvents([
      groupedRow({
        entryCount: 10,
        verificationStatusCounts: ['4:4', 'unchanged:6'],
      }),
    ]);

    expect(event.action).toBe('update');
    expect(event.actionBreakdown).toEqual([
      { action: 'update', count: 6 },
      { action: 'verification', count: 4 },
    ]);
  });

  it('counts cleared statuses as ordinary updates', () => {
    const [event] = assembleEvents([
      groupedRow({
        entryCount: 3,
        verificationStatusCounts: ['3:2', 'null:1'],
      }),
    ]);

    expect(event.actionBreakdown).toEqual([
      { action: 'rejection', count: 2 },
      { action: 'update', count: 1 },
    ]);
  });

  it('has no breakdown when the outcomes exceed the entities touched', () => {
    const [event] = assembleEvents([
      groupedRow({
        entryCount: 5,
        verificationStatusCounts: ['4:5', 'unchanged:5'],
      }),
    ]);

    expect(event.action).toBe('update');
    expect(event.actionBreakdown).toBeNull();
  });

  it('orders equal outcomes by their label', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 2, verificationStatusCounts: ['3:1', '4:1'] }),
    ]);

    expect(event.actionBreakdown).toEqual([
      { action: 'rejection', count: 1 },
      { action: 'verification', count: 1 },
    ]);
  });

  it('has no breakdown when every status resolves to one outcome', () => {
    const [event] = assembleEvents([
      groupedRow({
        entryCount: 3,
        verificationStatusCounts: ['null:1', 'unchanged:2'],
      }),
    ]);

    expect(event.action).toBe('update');
    expect(event.actionBreakdown).toBeNull();
  });

  it('sums outcomes across the top level groups of one event', () => {
    const [event] = assembleEvents([
      groupedRow({
        parentEntityId: 10,
        entryCount: 5,
        verificationStatusCounts: ['3:5'],
      }),
      groupedRow({
        parentEntityId: 11,
        sampleEntityId: 11,
        entryCount: 3,
        verificationStatusCounts: ['3:2', '4:1'],
      }),
    ]);

    expect(event.actionBreakdown).toEqual([
      { action: 'rejection', count: 7 },
      { action: 'verification', count: 1 },
    ]);
  });

  it('names the child outcome when it differs from the top action', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 1, verificationStatusCounts: ['4:1'] }),
      groupedRow({
        entityType: AuditEntityType.Match,
        entryCount: 3,
        auditEntryCount: 3,
        sampleEntityId: 20,
        verificationStatusCounts: ['3:3'],
      }),
    ]);

    expect(event.action).toBe('verification');
    expect(event.childActionBreakdown).toEqual([
      { action: 'rejection', count: 3 },
    ]);
  });

  it('names every child outcome when the children ended in several', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 1, verificationStatusCounts: ['4:1'] }),
      groupedRow({
        entityType: AuditEntityType.Match,
        entryCount: 118,
        auditEntryCount: 118,
        sampleEntityId: 20,
        verificationStatusCounts: ['3:3', '4:115'],
      }),
    ]);

    expect(event.childActionBreakdown).toEqual([
      { action: 'verification', count: 115 },
      { action: 'rejection', count: 3 },
    ]);
  });

  it('drops the child breakdown when it repeats the top action', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 1, verificationStatusCounts: ['4:1'] }),
      groupedRow({
        entityType: AuditEntityType.Match,
        entryCount: 3,
        auditEntryCount: 3,
        sampleEntityId: 20,
        verificationStatusCounts: ['4:3'],
      }),
    ]);

    expect(event.childActionBreakdown).toBeNull();
  });

  it('has no child breakdown when the children carry no statuses', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 1, verificationStatusCounts: ['4:1'] }),
      groupedRow({
        entityType: AuditEntityType.Match,
        entryCount: 3,
        auditEntryCount: 3,
        sampleEntityId: 20,
      }),
    ]);

    expect(event.childActionBreakdown).toBeNull();
  });

  it('has no child breakdown when the children carry no verification outcome', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 1, verificationStatusCounts: ['4:1'] }),
      groupedRow({
        entityType: AuditEntityType.Match,
        entryCount: 9,
        auditEntryCount: 9,
        sampleEntityId: 20,
        verificationStatusCounts: ['unchanged:9'],
      }),
    ]);

    expect(event.action).toBe('verification');
    expect(event.childActionBreakdown).toBeNull();
  });

  it('has no child breakdown for a delete cascade', () => {
    const [event] = assembleEvents([
      groupedRow({
        actionTypes: [AuditActionType.Deleted],
        entryCount: 1,
        verificationStatusCounts: ['null:1'],
      }),
      groupedRow({
        actionTypes: [AuditActionType.Deleted],
        entityType: AuditEntityType.Match,
        entryCount: 118,
        auditEntryCount: 118,
        sampleEntityId: 20,
        verificationStatusCounts: ['null:118'],
      }),
    ]);

    expect(event.action).toBe('deletion');
    expect(event.actionBreakdown).toBeNull();
    expect(event.childActionBreakdown).toBeNull();
  });

  it('has no child breakdown for a submission cascade', () => {
    const [event] = assembleEvents([
      groupedRow({
        actionTypes: [AuditActionType.Created],
        entryCount: 1,
        verificationStatusCounts: ['0:1'],
      }),
      groupedRow({
        actionTypes: [AuditActionType.Created],
        entityType: AuditEntityType.Match,
        entryCount: 12,
        auditEntryCount: 12,
        sampleEntityId: 20,
        verificationStatusCounts: ['0:12'],
      }),
    ]);

    expect(event.action).toBe('submission');
    expect(event.actionBreakdown).toBeNull();
    expect(event.childActionBreakdown).toBeNull();
  });

  it('has no child breakdown without a cascade', () => {
    const [event] = assembleEvents([
      groupedRow({ entryCount: 1, verificationStatusCounts: ['4:1'] }),
    ]);

    expect(event.childActionBreakdown).toBeNull();
  });
});

describe('audit event feed cursors', () => {
  it('round-trips the timestamp and event tie-break key', () => {
    const encoded = encodeEventFeedCursor({
      created: CREATED,
      eventKey: 'legacy:system:1:10',
    });

    expect(decodeEventFeedCursor(encoded)).toEqual({
      created: CREATED,
      eventKey: 'legacy:system:1:10',
    });
  });

  it('continues to accept legacy timestamp-only cursors', () => {
    expect(decodeEventFeedCursor(CREATED)).toEqual({
      created: CREATED,
      eventKey: null,
    });
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeEventFeedCursor('not-a-cursor')).toThrow(
      'Invalid audit event cursor'
    );
  });
});

describe('audit change key normalization', () => {
  it('normalizes legacy PascalCase and snake_case value keys', () => {
    expect(
      camelizeChangesKeys({
        VerificationStatus: {
          OriginalValue: 0,
          new_value: 4,
        },
      })
    ).toEqual({
      verificationStatus: {
        originalValue: 0,
        newValue: 4,
      },
    });
  });

  it('drops generated search columns from older rows', () => {
    expect(
      camelizeChangesKeys({
        name: { originalValue: 'Old', newValue: 'New' },
        match_rank_vector: { originalValue: "'old':1", newValue: "'new':1" },
        SearchVector: { OriginalValue: "'old':1", NewValue: "'new':1" },
      })
    ).toEqual({
      name: { originalValue: 'Old', newValue: 'New' },
    });
  });

  it('returns null when only generated search columns changed', () => {
    expect(
      camelizeChangesKeys({
        match_rank_vector: { originalValue: "'old':1", newValue: "'new':1" },
      })
    ).toBeNull();
  });
});

describe('buildChildSummary', () => {
  it('states a fraction when the total is larger', () => {
    expect(buildChildSummary(AuditEntityType.Match, 85, 118)).toBe(
      'also affected 85 of 118 matches'
    );
  });

  it('drops the fraction when every child was affected', () => {
    expect(buildChildSummary(AuditEntityType.Game, 8, 8)).toBe(
      'also affected 8 games'
    );
  });

  it('drops the fraction when the counts cover different scopes', () => {
    expect(buildChildSummary(AuditEntityType.Game, 993, 8)).toBe(
      'also affected 993 games'
    );
  });

  it('pluralizes a fraction by its total', () => {
    expect(buildChildSummary(AuditEntityType.Match, 1, 5)).toBe(
      'also affected 1 of 5 matches'
    );
  });

  it('pluralizes a bare count by the affected entities', () => {
    expect(buildChildSummary(AuditEntityType.Match, 1, 1)).toBe(
      'also affected 1 match'
    );
  });
});

describe('getCascadeCountParent', () => {
  it('counts under the top entity when the cascade has one', () => {
    expect(
      getCascadeCountParent(AuditEntityType.Match, 162949, 1, 500)
    ).toEqual({ entityType: AuditEntityType.Match, entityId: 162949 });
  });

  it('counts under the tournament when the top level spans several entities', () => {
    expect(
      getCascadeCountParent(AuditEntityType.Match, 162949, 124, 500)
    ).toEqual({ entityType: AuditEntityType.Tournament, entityId: 500 });
  });

  it('has no scope when several top entities span tournaments', () => {
    expect(
      getCascadeCountParent(AuditEntityType.Match, 162949, 124, null)
    ).toBeNull();
  });
});
