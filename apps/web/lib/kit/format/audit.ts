/**
 * Readable labels and values for every audited field: sentence-case names
 * from the glossary, mods as acronyms, timestamps in UTC and enum numbers as
 * names. Replaces `components/audit/auditFieldConfig.ts` and the value
 * formatting inside `AuditDiffDisplay`.
 */

import { AuditEntityType, VerificationStatus } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import {
  getVerificationStatusName,
  VERIFICATION_STATUS_COPY,
} from '@/lib/kit/status/verification';

import { formatDuration, formatTimestamp } from './date';
import { EMPTY_VALUE } from './empty';
import {
  DATA_FETCH_STATUS_LABELS,
  type EnumLabels,
  formatEnumValue,
  formatFlags,
  GAME_REJECTION_REASON_LABELS,
  GAME_WARNING_FLAG_LABELS,
  MATCH_REJECTION_REASON_LABELS,
  MATCH_WARNING_FLAG_LABELS,
  RANKED_STATUS_LABELS,
  SCORE_GRADE_LABELS,
  SCORE_REJECTION_REASON_LABELS,
  SCORING_TYPE_LABELS,
  TEAM_LABELS,
  TEAM_TYPE_LABELS,
  TOURNAMENT_REJECTION_REASON_LABELS,
} from './enum-labels';
import {
  fieldLabel,
  formatLobbySize,
  formatRankRange,
  humanizeFieldName,
} from './fields';
import { formatLazerMods, formatMods } from './mods';
import {
  formatAccuracy,
  formatCount,
  formatId,
  formatNumber,
  formatOrdinal,
} from './number';
import { getRulesetLabel } from './ruleset';

/** How a field's stored value is written. */
export type AuditValueFormat =
  | { kind: 'text' }
  | { kind: 'count' }
  | { kind: 'decimal'; maxDecimals: number }
  | { kind: 'ordinal' }
  | { kind: 'accuracy' }
  | { kind: 'id' }
  | { kind: 'idList' }
  | { kind: 'timestamp' }
  | { kind: 'duration' }
  | { kind: 'boolean' }
  | { kind: 'user' }
  | { kind: 'mods' }
  | { kind: 'lazerMods' }
  | { kind: 'ruleset' }
  | { kind: 'rankRange' }
  | { kind: 'lobbySize' }
  | { kind: 'verificationStatus' }
  | { kind: 'enum'; labels: EnumLabels }
  | { kind: 'flags'; labels: EnumLabels };

export interface AuditFieldSpec {
  label: string;
  format: AuditValueFormat;
}

const text = { kind: 'text' } as const;
const count = { kind: 'count' } as const;
const id = { kind: 'id' } as const;
const timestamp = { kind: 'timestamp' } as const;
const duration = { kind: 'duration' } as const;
const boolean = { kind: 'boolean' } as const;
const user = { kind: 'user' } as const;
const mods = { kind: 'mods' } as const;
const ruleset = { kind: 'ruleset' } as const;
const verificationStatus = { kind: 'verificationStatus' } as const;
const decimal = (maxDecimals: number) =>
  ({ kind: 'decimal', maxDecimals }) as const;
const enumOf = (labels: EnumLabels) => ({ kind: 'enum', labels }) as const;
const flagsOf = (labels: EnumLabels) => ({ kind: 'flags', labels }) as const;

const field = (label: string, format: AuditValueFormat): AuditFieldSpec => ({
  label,
  format,
});

const shared = {
  osuId: field(fieldLabel('osuId'), id),
  ruleset: field(fieldLabel('ruleset'), ruleset),
  startTime: field(fieldLabel('startTime'), timestamp),
  endTime: field(fieldLabel('endTime'), timestamp),
  verificationStatus: field(
    fieldLabel('verificationStatus'),
    verificationStatus
  ),
  isLazer: field(fieldLabel('isLazer'), boolean),
  submittedByUserId: field(fieldLabel('submittedBy'), user),
  verifiedByUserId: field(fieldLabel('verifiedBy'), user),
  created: field(fieldLabel('created'), timestamp),
  mods: field(fieldLabel('mods'), mods),
  lazerMods: field(fieldLabel('lazerMods'), { kind: 'lazerMods' }),
  maxCombo: field(fieldLabel('maxCombo'), count),
  dataFetchStatus: field('Data fetch status', enumOf(DATA_FETCH_STATUS_LABELS)),
};

/**
 * Every field the audit log records, per entity. A test keeps this in step
 * with the schema, so a new column fails until it has a label and a format.
 */
export const AUDIT_FIELDS: Readonly<
  Record<AuditEntityType, Readonly<Record<string, AuditFieldSpec>>>
> = {
  [AuditEntityType.Tournament]: {
    name: field('Name', text),
    abbreviation: field(fieldLabel('abbreviation'), text),
    forumUrl: field(fieldLabel('forumUrl'), text),
    rankRangeLowerBound: field(fieldLabel('rankRange'), { kind: 'rankRange' }),
    ruleset: shared.ruleset,
    lobbySize: field(fieldLabel('lobbySize'), { kind: 'lobbySize' }),
    verificationStatus: shared.verificationStatus,
    rejectionReason: field(
      fieldLabel('rejectionReason'),
      flagsOf(TOURNAMENT_REJECTION_REASON_LABELS)
    ),
    isLazer: shared.isLazer,
    submittedByUserId: shared.submittedByUserId,
    verifiedByUserId: shared.verifiedByUserId,
    startTime: shared.startTime,
    endTime: shared.endTime,
    created: shared.created,
  },
  [AuditEntityType.Match]: {
    osuId: shared.osuId,
    name: field('Name', text),
    startTime: shared.startTime,
    endTime: shared.endTime,
    verificationStatus: shared.verificationStatus,
    rejectionReason: field(
      fieldLabel('rejectionReason'),
      flagsOf(MATCH_REJECTION_REASON_LABELS)
    ),
    warningFlags: field(
      fieldLabel('warningFlags'),
      flagsOf(MATCH_WARNING_FLAG_LABELS)
    ),
    isLazer: shared.isLazer,
    tournamentId: field('Tournament ID', id),
    submittedByUserId: shared.submittedByUserId,
    verifiedByUserId: shared.verifiedByUserId,
    created: shared.created,
    dataFetchStatus: shared.dataFetchStatus,
  },
  [AuditEntityType.Game]: {
    osuId: shared.osuId,
    ruleset: shared.ruleset,
    scoringType: field(fieldLabel('scoringType'), enumOf(SCORING_TYPE_LABELS)),
    teamType: field(fieldLabel('teamType'), enumOf(TEAM_TYPE_LABELS)),
    mods: shared.mods,
    lazerMods: shared.lazerMods,
    startTime: shared.startTime,
    endTime: shared.endTime,
    verificationStatus: shared.verificationStatus,
    rejectionReason: field(
      fieldLabel('rejectionReason'),
      flagsOf(GAME_REJECTION_REASON_LABELS)
    ),
    warningFlags: field(
      fieldLabel('warningFlags'),
      flagsOf(GAME_WARNING_FLAG_LABELS)
    ),
    matchId: field('Match ID', id),
    beatmapId: field('Beatmap ID', id),
    created: shared.created,
  },
  [AuditEntityType.Score]: {
    score: field(fieldLabel('score'), count),
    rawScore: field('Raw score', count),
    adjustedScore: field('Adjusted score', count),
    scoreOverride: field('Score override', count),
    placement: field(fieldLabel('placement'), { kind: 'ordinal' }),
    accuracy: field(fieldLabel('accuracy'), { kind: 'accuracy' }),
    pp: field('Performance points', decimal(2)),
    maxCombo: shared.maxCombo,
    pass: field('Pass', boolean),
    isPerfectCombo: field('Perfect combo', boolean),
    legacyPerfect: field('Legacy perfect', boolean),
    grade: field(fieldLabel('grade'), enumOf(SCORE_GRADE_LABELS)),
    mods: shared.mods,
    lazerMods: shared.lazerMods,
    statComboBreak: field('Combo breaks', count),
    statGreat: field('Great', count),
    statOk: field('Ok', count),
    statMeh: field('Meh', count),
    statMiss: field('Miss', count),
    statGood: field('Good', count),
    statPerfect: field('Perfect', count),
    statSliderTailHit: field('Slider tail hit', count),
    statLargeTickHit: field('Large tick hit', count),
    statLargeTickMiss: field('Large tick miss', count),
    statSmallTickHit: field('Small tick hit', count),
    statSmallTickMiss: field('Small tick miss', count),
    statLargeBonus: field('Large bonus', count),
    statSmallBonus: field('Small bonus', count),
    statIgnoreHit: field('Ignored hit', count),
    statIgnoreMiss: field('Ignored miss', count),
    statLegacyComboIncrease: field('Legacy combo increase', count),
    legacyTotalScore: field('Legacy total score', count),
    team: field(fieldLabel('team'), enumOf(TEAM_LABELS)),
    ruleset: shared.ruleset,
    verificationStatus: shared.verificationStatus,
    rejectionReason: field(
      fieldLabel('rejectionReason'),
      flagsOf(SCORE_REJECTION_REASON_LABELS)
    ),
    gameId: field('Game ID', id),
    playerId: field('Player ID', id),
    created: shared.created,
  },
  [AuditEntityType.Beatmap]: {
    osuId: shared.osuId,
    diffName: field(fieldLabel('difficulty'), text),
    ruleset: shared.ruleset,
    rankedStatus: field(
      fieldLabel('rankedStatus'),
      enumOf(RANKED_STATUS_LABELS)
    ),
    totalLength: field(fieldLabel('totalLength'), duration),
    drainLength: field(fieldLabel('drainLength'), duration),
    bpm: field(fieldLabel('bpm'), decimal(2)),
    countCircle: field('Circles', count),
    countSlider: field('Sliders', count),
    countSpinner: field('Spinners', count),
    cs: field(fieldLabel('circleSize'), decimal(1)),
    hp: field(fieldLabel('hpDrain'), decimal(1)),
    od: field(fieldLabel('overallDifficulty'), decimal(1)),
    ar: field(fieldLabel('approachRate'), decimal(1)),
    sr: field(fieldLabel('starRating'), decimal(2)),
    maxCombo: shared.maxCombo,
    beatmapsetId: field('Beatmapset ID', id),
    dataFetchStatus: shared.dataFetchStatus,
    manualOverride: field('Manually configured', boolean),
    titleOverride: field('Title override', text),
    artistOverride: field('Artist override', text),
    setOwnerIdOverride: field('Set owner override', id),
    creators: field(fieldLabel('mappers'), { kind: 'idList' }),
    created: shared.created,
  },
};

export function getAuditFieldSpec(
  entityType: AuditEntityType,
  fieldName: string
): AuditFieldSpec | undefined {
  const fields = AUDIT_FIELDS[entityType];
  return fields && Object.prototype.hasOwnProperty.call(fields, fieldName)
    ? fields[fieldName]
    : undefined;
}

/** `Lobby size`. A field with no entry still reads in sentence case. */
export function getAuditFieldLabel(
  entityType: AuditEntityType,
  fieldName: string
): string {
  return (
    getAuditFieldSpec(entityType, fieldName)?.label ??
    humanizeFieldName(fieldName)
  );
}

const AUDITED_ENTITY_TYPES = [
  AuditEntityType.Tournament,
  AuditEntityType.Match,
  AuditEntityType.Game,
  AuditEntityType.Score,
  AuditEntityType.Beatmap,
] as const;

/** Every audited field with its label, entity by entity, for field filters. */
export function listAuditFields(): Array<{
  entityType: AuditEntityType;
  field: string;
  label: string;
}> {
  return AUDITED_ENTITY_TYPES.flatMap((entityType) =>
    Object.entries(AUDIT_FIELDS[entityType]).map(([name, spec]) => ({
      entityType,
      field: name,
      label: spec.label,
    }))
  );
}

/** The name an audit row shows for a user ID it references. */
export interface AuditReferencedUser {
  username: string | null;
}

export interface FormattedAuditValue {
  text: string;
  /** No value: render the em dash muted. */
  empty: boolean;
  /** Set for verification status fields, so a page can add the status icon. */
  status?: VerificationStatus;
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
  return (
    typeof value === 'number' &&
    Object.prototype.hasOwnProperty.call(VERIFICATION_STATUS_COPY, value)
  );
}

function formatLoose(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(formatLoose).join(', ') : 'None';
  }
  return JSON.stringify(value);
}

function formatUser(
  value: number,
  users: Record<string, AuditReferencedUser> | undefined
): string {
  if (!users) return `User ${value}`;
  return users[String(value)]?.username ?? `Deleted user (${value})`;
}

function isLazerModList(value: unknown): value is LazerMod[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { acronym?: unknown }).acronym === 'string'
    )
  );
}

function formatWith(
  format: AuditValueFormat,
  value: unknown,
  users: Record<string, AuditReferencedUser> | undefined
): string {
  switch (format.kind) {
    case 'text':
      return formatLoose(value);
    case 'boolean':
      return typeof value === 'boolean'
        ? value
          ? 'Yes'
          : 'No'
        : formatLoose(value);
    case 'timestamp':
      // With seconds, so a correction of a few seconds never reads as no change.
      return typeof value === 'string' || typeof value === 'number'
        ? formatTimestamp(value, { seconds: true, empty: formatLoose(value) })
        : formatLoose(value);
    case 'idList':
      return Array.isArray(value)
        ? value.length > 0
          ? value
              .map((item) =>
                typeof item === 'number' ? formatId(item) : formatLoose(item)
              )
              .join(', ')
          : 'None'
        : formatLoose(value);
    case 'lazerMods':
      return isLazerModList(value)
        ? formatLazerMods(value)
        : formatLoose(value);
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return formatLoose(value);
  }

  switch (format.kind) {
    case 'count':
      return formatCount(value);
    case 'decimal':
      return formatNumber(value, { maxDecimals: format.maxDecimals });
    case 'ordinal':
      return formatOrdinal(value);
    case 'accuracy':
      return formatAccuracy(value);
    case 'id':
      return formatId(value);
    case 'duration':
      return formatDuration(value);
    case 'user':
      return formatUser(value, users);
    case 'mods':
      return formatMods(value);
    case 'ruleset':
      return getRulesetLabel(value);
    case 'rankRange':
      return formatRankRange(value);
    case 'lobbySize':
      return formatLobbySize(value, { empty: String(value) });
    case 'verificationStatus':
      return isVerificationStatus(value)
        ? getVerificationStatusName(value)
        : `Unknown (${value})`;
    case 'enum':
      return formatEnumValue(value, format.labels);
    case 'flags':
      return formatFlags(value, format.labels);
  }
}

/**
 * One side of an audited change, ready to print. `users` maps the user IDs
 * an entry references to their names, as the audit procedures return them.
 */
export function formatAuditValue(
  entityType: AuditEntityType,
  fieldName: string,
  value: unknown,
  { users }: { users?: Record<string, AuditReferencedUser> } = {}
): FormattedAuditValue {
  // As in the old diff view, the string "null" also means no value.
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === 'null'
  ) {
    return { text: EMPTY_VALUE, empty: true };
  }

  const spec = getAuditFieldSpec(entityType, fieldName);
  if (!spec) return { text: formatLoose(value), empty: false };

  const formatted: FormattedAuditValue = {
    text: formatWith(spec.format, value, users),
    empty: false,
  };

  if (
    spec.format.kind === 'verificationStatus' &&
    isVerificationStatus(value)
  ) {
    formatted.status = value;
  }

  return formatted;
}
