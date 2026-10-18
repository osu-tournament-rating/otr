import { VerificationStatus } from '@otr/core/osu';

/**
 * Status names and plain-language copy. Statuses are compared by identity
 * only: their numbers are not ordered by meaning, so never use `<` or `>`.
 */

export interface VerificationStatusCopy {
  /** The state's one name, used on every page. */
  name: string;
  /** Short line read after "<name>: ", capitalised and with no full stop. */
  summary: string;
}

/** The hue that reinforces a status: green, red or neutral. */
export type StatusHue = 'success' | 'neutral' | 'destructive';

export const VERIFICATION_STATUS_COPY: Record<
  VerificationStatus,
  VerificationStatusCopy
> = {
  [VerificationStatus.Verified]: {
    name: 'Verified',
    summary: 'Approved by an admin, counts from the next Tuesday update',
  },
  [VerificationStatus.PreVerified]: {
    name: 'Pre-verified',
    summary: 'Passed automated checks, awaiting admin review',
  },
  [VerificationStatus.None]: {
    name: 'Pending',
    summary: 'Awaiting automated checks',
  },
  [VerificationStatus.PreRejected]: {
    name: 'Pre-rejected',
    summary: 'Failed automated checks, awaiting admin review',
  },
  [VerificationStatus.Rejected]: {
    name: 'Rejected',
    summary: 'Excluded from ratings by an admin',
  },
};

const UNKNOWN_STATUS_COPY: VerificationStatusCopy = {
  name: 'Unknown status',
  summary: 'Not recognised',
};

/** Legends, filters and the status sheet list the states in this order. */
export const VERIFICATION_STATUS_ORDER: readonly VerificationStatus[] = [
  VerificationStatus.Verified,
  VerificationStatus.PreVerified,
  VerificationStatus.None,
  VerificationStatus.PreRejected,
  VerificationStatus.Rejected,
];

export function getVerificationStatusCopy(
  status: VerificationStatus
): VerificationStatusCopy {
  return VERIFICATION_STATUS_COPY[status] ?? UNKNOWN_STATUS_COPY;
}

export function getVerificationStatusName(status: VerificationStatus): string {
  return getVerificationStatusCopy(status).name;
}

/** The tooltip line, such as "Pre-verified: Passed automated checks, …". */
export function getVerificationStatusTooltip(
  status: VerificationStatus
): string {
  const { name, summary } = getVerificationStatusCopy(status);
  return `${name}: ${summary}`;
}

/**
 * The accessible name for an icon-only status, such as
 * "Game 3: Pre-verified, with warnings".
 */
export function getVerificationStatusLabel(
  status: VerificationStatus,
  {
    context,
    hasWarnings = false,
  }: { context?: string; hasWarnings?: boolean } = {}
): string {
  const name = getVerificationStatusName(status);
  const prefix = context ? `${context}: ` : '';
  const suffix = hasWarnings ? ', with warnings' : '';
  return `${prefix}${name}${suffix}`;
}

/** An automated check set the status; the icon draws a dashed outline. */
export function isAutomatedCheckStatus(status: VerificationStatus): boolean {
  return (
    status === VerificationStatus.PreVerified ||
    status === VerificationStatus.PreRejected
  );
}

/** The hue of a status's icon. */
export function getVerificationStatusHue(
  status: VerificationStatus
): StatusHue {
  switch (status) {
    case VerificationStatus.Verified:
    case VerificationStatus.PreVerified:
      return 'success';
    case VerificationStatus.Rejected:
    case VerificationStatus.PreRejected:
      return 'destructive';
    default:
      return 'neutral';
  }
}

export const NOT_IN_RATINGS_YET_LABEL = 'Not in ratings yet';

/** Pending, Pre-verified and Pre-rejected: waiting for an admin's decision. */
export const NOT_IN_RATINGS_YET_STATUSES: readonly VerificationStatus[] = [
  VerificationStatus.None,
  VerificationStatus.PreVerified,
  VerificationStatus.PreRejected,
];

export function isNotInRatingsYet(status: VerificationStatus): boolean {
  return NOT_IN_RATINGS_YET_STATUSES.includes(status);
}

export type RatingsGroupKey = 'verified' | 'notInRatingsYet' | 'rejected';

export interface RatingsGroup {
  key: RatingsGroupKey;
  label: string;
  hue: StatusHue;
  statuses: readonly VerificationStatus[];
}

const NOT_IN_RATINGS_YET_GROUP: RatingsGroup = {
  key: 'notInRatingsYet',
  label: NOT_IN_RATINGS_YET_LABEL,
  hue: 'neutral',
  statuses: NOT_IN_RATINGS_YET_STATUSES,
};

/**
 * The three groups charts and summaries use, in display order. Pending is
 * never a group of its own: it joins "Not in ratings yet".
 */
export const RATINGS_GROUPS: readonly RatingsGroup[] = [
  {
    key: 'verified',
    label: VERIFICATION_STATUS_COPY[VerificationStatus.Verified].name,
    hue: 'success',
    statuses: [VerificationStatus.Verified],
  },
  NOT_IN_RATINGS_YET_GROUP,
  {
    key: 'rejected',
    label: VERIFICATION_STATUS_COPY[VerificationStatus.Rejected].name,
    hue: 'destructive',
    statuses: [VerificationStatus.Rejected],
  },
];

/** The ratings group a status belongs to; unknown values count as not yet. */
export function getRatingsGroup(status: VerificationStatus): RatingsGroup {
  return (
    RATINGS_GROUPS.find((group) => group.statuses.includes(status)) ??
    NOT_IN_RATINGS_YET_GROUP
  );
}

/** The Rating FAQ answer on why a tournament is not in ratings. */
export const RATING_FAQ_URL =
  'https://docs.otr.stagec.net/rating-framework/rating-faq#why-is-a-tournament-not-being-included-in-my-rating-calculations';
