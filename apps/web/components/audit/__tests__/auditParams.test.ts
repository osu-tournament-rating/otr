import { describe, expect, it } from 'bun:test';
import { AuditEntityType } from '@otr/core/osu';

import {
  clearListFilters,
  countActiveFilters,
  getDefaultListState,
  listStateHref,
  parseListState,
} from '@/lib/kit/lists/params';
import {
  AUDIT_FIELD_OPTIONS,
  AUDIT_HISTORY_PARAMS,
  AUDIT_LOG_PARAMS,
  getAuditFieldOption,
  nameOr,
  toAuditEntityType,
} from '../auditParams';

describe('AUDIT_LOG_PARAMS', () => {
  it('writes a bare address for the default feed', () => {
    expect(
      listStateHref(
        '/tools/audit-logs',
        AUDIT_LOG_PARAMS,
        getDefaultListState(AUDIT_LOG_PARAMS)
      )
    ).toBe('/tools/audit-logs');
  });

  it('reads filters back from the address', () => {
    const state = parseListState(
      AUDIT_LOG_PARAMS,
      'action=updated&entity=match&field=match.startTime&system=true'
    );
    expect(state).toEqual({
      action: ['updated'],
      entity: ['match'],
      field: ['match.startTime'],
      system: true,
    });
  });

  it('drops unknown values', () => {
    const state = parseListState(
      AUDIT_LOG_PARAMS,
      'action=renamed&entity=player&field=match.nope'
    );
    expect(state.action).toEqual([]);
    expect(state.entity).toEqual([]);
    expect(state.field).toEqual([]);
  });

  it('counts the system switch as a scope, not a filter', () => {
    const state = parseListState(
      AUDIT_LOG_PARAMS,
      'action=updated&system=true'
    );

    // One filter on the Filters button, and Clear all keeps the switch.
    expect(countActiveFilters(AUDIT_LOG_PARAMS, state)).toBe(1);
    expect(clearListFilters(AUDIT_LOG_PARAMS, state).system).toBe(true);
  });
});

describe('audit field options', () => {
  it('names every field once per entity type', () => {
    const values = AUDIT_FIELD_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('maps a field back to its entity type and column', () => {
    expect(getAuditFieldOption('tournament.rankRangeLowerBound')).toMatchObject(
      {
        entityType: AuditEntityType.Tournament,
        field: 'rankRangeLowerBound',
        label: 'Rank restriction',
      }
    );
    expect(toAuditEntityType('score')).toBe(AuditEntityType.Score);
    expect(toAuditEntityType('player')).toBeUndefined();
  });
});

describe('AUDIT_HISTORY_PARAMS', () => {
  it('opens on the entity itself and reads a descendant tab', () => {
    expect(parseListState(AUDIT_HISTORY_PARAMS, '').tab).toBe('self');
    expect(parseListState(AUDIT_HISTORY_PARAMS, 'tab=games').tab).toBe('games');
    expect(parseListState(AUDIT_HISTORY_PARAMS, 'tab=nope').tab).toBe('self');
  });
});

describe('nameOr', () => {
  it('keeps a real name', () => {
    expect(nameOr('MWC7K2024: (China) VS (Canada)', 'Match #29473')).toBe(
      'MWC7K2024: (China) VS (Canada)'
    );
  });

  it('falls back for a missing or empty name', () => {
    // About a thousand matches are stored with an empty name.
    expect(nameOr('', 'Match #4970')).toBe('Match #4970');
    expect(nameOr('  ', 'Match #4970')).toBe('Match #4970');
    expect(nameOr(null, 'Match #4970')).toBe('Match #4970');
    expect(nameOr(undefined, 'Match #4970')).toBe('Match #4970');
  });
});
