import { describe, expect, it } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import {
  AuditEntityType,
  GameRejectionReason,
  Mods,
  Ruleset,
  VerificationStatus,
} from '@otr/core/osu';

import {
  AUDIT_FIELDS,
  formatAuditValue,
  getAuditFieldLabel,
  listAuditFields,
} from '../audit';

const EM_DASH = '—';

// Generated columns are recorded through the fields they derive from.
const EXCLUDED_AUDIT_FIELDS = new Set([
  'id',
  'updated',
  'searchVector',
  'matchRankVector',
]);

const sourceTables = {
  [AuditEntityType.Tournament]: schema.tournaments,
  [AuditEntityType.Match]: schema.matches,
  [AuditEntityType.Game]: schema.games,
  [AuditEntityType.Score]: schema.gameScores,
  [AuditEntityType.Beatmap]: schema.beatmaps,
} as const;

// Written by the beatmap admin procedure, not by a column-diffing trigger.
const SYNTHETIC_AUDIT_FIELDS: Partial<Record<AuditEntityType, string[]>> = {
  [AuditEntityType.Beatmap]: ['creators'],
};

describe('AUDIT_FIELDS', () => {
  it('covers every automatically audited field, and nothing else', () => {
    for (const [rawEntityType, table] of Object.entries(sourceTables)) {
      const entityType = Number(rawEntityType) as AuditEntityType;
      const schemaFields = [
        ...Object.keys(getTableColumns(table)).filter(
          (field) => !EXCLUDED_AUDIT_FIELDS.has(field)
        ),
        ...(SYNTHETIC_AUDIT_FIELDS[entityType] ?? []),
      ].sort();

      expect(Object.keys(AUDIT_FIELDS[entityType]).sort()).toEqual(
        schemaFields
      );
    }
  });

  it('labels every field in sentence case', () => {
    for (const { label } of listAuditFields()) {
      const [first, ...rest] = label.split(' ');
      // The brand keeps its lower-case "o": "osu! ID".
      if (first !== 'osu!') {
        expect(first.charAt(0)).toBe(first.charAt(0).toUpperCase());
      }
      for (const word of rest) {
        expect(word === word.toLowerCase() || word === word.toUpperCase()).toBe(
          true
        );
      }
    }
  });

  it('uses the glossary names', () => {
    expect(
      getAuditFieldLabel(AuditEntityType.Tournament, 'rankRangeLowerBound')
    ).toBe('Rank restriction');
    expect(getAuditFieldLabel(AuditEntityType.Tournament, 'lobbySize')).toBe(
      'Lobby size'
    );
    expect(getAuditFieldLabel(AuditEntityType.Tournament, 'forumUrl')).toBe(
      'Forum post URL'
    );
    expect(getAuditFieldLabel(AuditEntityType.Match, 'submittedByUserId')).toBe(
      'Submitted by'
    );
    expect(getAuditFieldLabel(AuditEntityType.Beatmap, 'creators')).toBe(
      'Mappers'
    );
  });

  it('humanizes fields it does not know', () => {
    expect(
      getAuditFieldLabel(AuditEntityType.Tournament, 'processingStatus')
    ).toBe('Processing status');
    expect(getAuditFieldLabel(AuditEntityType.Match, 'toString')).toBe(
      'To string'
    );
  });

  it('lists fields entity by entity', () => {
    const fields = listAuditFields();
    expect(fields[0]).toEqual({
      entityType: AuditEntityType.Tournament,
      field: 'name',
      label: 'Name',
    });
    expect(fields.at(-1)?.entityType).toBe(AuditEntityType.Beatmap);
  });
});

describe('formatAuditValue', () => {
  const format = (
    entityType: AuditEntityType,
    field: string,
    value: unknown,
    users?: Record<string, { username: string | null }>
  ) => formatAuditValue(entityType, field, value, { users }).text;

  it('writes mods as acronyms', () => {
    expect(format(AuditEntityType.Game, 'mods', 24)).toBe('HD, HR');
    expect(format(AuditEntityType.Game, 'mods', 8)).toBe('HD');
    expect(format(AuditEntityType.Score, 'mods', Mods.None)).toBe('NM');
  });

  it('writes lazer mods with their speed', () => {
    expect(
      format(AuditEntityType.Score, 'lazerMods', [
        { acronym: 'DT', settings: { speed_change: 1.2 } },
        { acronym: 'DA' },
      ])
    ).toBe('DT 1.2x, DA');
    expect(format(AuditEntityType.Game, 'lazerMods', [])).toBe('NM');
  });

  it('writes timestamps in UTC, to the second', () => {
    expect(
      format(AuditEntityType.Match, 'startTime', '2024-07-20T15:42:07+00:00')
    ).toBe('Jul 20, 2024, 15:42:07 UTC');
    expect(
      format(AuditEntityType.Tournament, 'endTime', '2024-08-03 18:00:00+02')
    ).toBe('Aug 3, 2024, 16:00:00 UTC');
  });

  it('shows a correction of a few seconds as a change', () => {
    const before = format(
      AuditEntityType.Game,
      'endTime',
      '2024-07-20T15:42:07+00:00'
    );
    const after = format(
      AuditEntityType.Game,
      'endTime',
      '2024-07-20T15:42:12+00:00'
    );
    expect(before).not.toBe(after);
  });

  it('keeps unreadable timestamps as they are', () => {
    expect(format(AuditEntityType.Match, 'startTime', 'yesterday')).toBe(
      'yesterday'
    );
  });

  it('names enum values', () => {
    expect(format(AuditEntityType.Game, 'ruleset', Ruleset.Taiko)).toBe(
      'taiko'
    );
    expect(format(AuditEntityType.Game, 'teamType', 2)).toBe('Team Vs');
    expect(format(AuditEntityType.Beatmap, 'rankedStatus', 1)).toBe('Ranked');
    expect(format(AuditEntityType.Match, 'dataFetchStatus', 2)).toBe('Fetched');
    expect(format(AuditEntityType.Score, 'grade', 3)).toBe('S');
  });

  it('names bitflags', () => {
    expect(
      format(
        AuditEntityType.Game,
        'rejectionReason',
        GameRejectionReason.NoScores | GameRejectionReason.InvalidMods
      )
    ).toBe('No scores, Invalid mods');
    expect(format(AuditEntityType.Game, 'rejectionReason', 0)).toBe('None');
  });

  it('names verification statuses and reports them for the icon', () => {
    const value = formatAuditValue(
      AuditEntityType.Tournament,
      'verificationStatus',
      VerificationStatus.PreVerified
    );
    expect(value).toEqual({
      text: 'Pre-verified',
      empty: false,
      status: VerificationStatus.PreVerified,
    });
    expect(
      formatAuditValue(AuditEntityType.Tournament, 'verificationStatus', 9)
    ).toEqual({ text: 'Unknown (9)', empty: false });
  });

  it('writes tournament values the way the rest of the site does', () => {
    expect(format(AuditEntityType.Tournament, 'rankRangeLowerBound', 1)).toBe(
      'Open rank'
    );
    expect(
      format(AuditEntityType.Tournament, 'rankRangeLowerBound', 10000)
    ).toBe('10,000+');
    expect(format(AuditEntityType.Tournament, 'lobbySize', 4)).toBe('4v4');
    expect(format(AuditEntityType.Tournament, 'isLazer', true)).toBe('Yes');
  });

  it('separates counts but not IDs', () => {
    expect(format(AuditEntityType.Score, 'rawScore', 1234567)).toBe(
      '1,234,567'
    );
    expect(format(AuditEntityType.Match, 'osuId', 112233445)).toBe('112233445');
    expect(format(AuditEntityType.Game, 'beatmapId', 4012345)).toBe('4012345');
  });

  it('writes score and beatmap numbers', () => {
    expect(format(AuditEntityType.Score, 'accuracy', 0.98543)).toBe('98.54%');
    expect(format(AuditEntityType.Score, 'placement', 2)).toBe('2nd');
    expect(format(AuditEntityType.Score, 'pp', 412.456)).toBe('412.46');
    expect(format(AuditEntityType.Beatmap, 'totalLength', 222)).toBe('3:42');
    expect(format(AuditEntityType.Beatmap, 'cs', 4.199999)).toBe('4.2');
    expect(format(AuditEntityType.Beatmap, 'sr', 6.5)).toBe('6.5');
    expect(format(AuditEntityType.Beatmap, 'bpm', 180)).toBe('180');
  });

  it('names referenced users', () => {
    const users = { '12': { username: 'apricot' }, '13': { username: null } };
    expect(format(AuditEntityType.Match, 'verifiedByUserId', 12, users)).toBe(
      'apricot'
    );
    expect(format(AuditEntityType.Match, 'verifiedByUserId', 13, users)).toBe(
      'Deleted user (13)'
    );
    expect(format(AuditEntityType.Match, 'verifiedByUserId', 12)).toBe(
      'User 12'
    );
  });

  it('lists mapper IDs without separators', () => {
    expect(format(AuditEntityType.Beatmap, 'creators', [2558286, 1234])).toBe(
      '2558286, 1234'
    );
    expect(format(AuditEntityType.Beatmap, 'creators', [])).toBe('None');
  });

  it('marks missing values', () => {
    for (const value of [null, undefined, '', 'null']) {
      expect(
        formatAuditValue(AuditEntityType.Tournament, 'endTime', value)
      ).toEqual({ text: EM_DASH, empty: true });
    }
  });

  it('falls back to the raw value for fields it does not know', () => {
    expect(format(AuditEntityType.Tournament, 'processingStatus', 2)).toBe('2');
    expect(format(AuditEntityType.Tournament, 'somethingNew', false)).toBe(
      'No'
    );
    expect(format(AuditEntityType.Tournament, 'somethingNew', { a: 1 })).toBe(
      '{"a":1}'
    );
  });

  it('falls back to the raw value when a field holds the wrong type', () => {
    expect(format(AuditEntityType.Game, 'mods', 'HD')).toBe('HD');
    expect(format(AuditEntityType.Score, 'rawScore', '12')).toBe('12');
  });
});
