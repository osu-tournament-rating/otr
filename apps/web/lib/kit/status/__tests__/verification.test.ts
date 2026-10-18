import { describe, expect, it } from 'bun:test';

import { VerificationStatus } from '@otr/core/osu';
import {
  NOT_IN_RATINGS_YET_LABEL,
  NOT_IN_RATINGS_YET_STATUSES,
  RATING_FAQ_URL,
  RATINGS_GROUPS,
  VERIFICATION_STATUS_COPY,
  VERIFICATION_STATUS_ORDER,
  getRatingsGroup,
  getVerificationStatusCopy,
  getVerificationStatusHue,
  getVerificationStatusLabel,
  getVerificationStatusName,
  getVerificationStatusTooltip,
  isAutomatedCheckStatus,
  isNotInRatingsYet,
} from '../verification';

const ALL_STATUSES = [
  VerificationStatus.None,
  VerificationStatus.PreRejected,
  VerificationStatus.PreVerified,
  VerificationStatus.Rejected,
  VerificationStatus.Verified,
];

describe('verification status copy', () => {
  it('gives every state one distinct, sentence-case name', () => {
    const names = ALL_STATUSES.map(getVerificationStatusName);

    expect(names).toEqual([
      'Pending',
      'Pre-rejected',
      'Pre-verified',
      'Rejected',
      'Verified',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('writes each tooltip as "<name>: <plain-language line>"', () => {
    expect(getVerificationStatusTooltip(VerificationStatus.PreVerified)).toBe(
      'Pre-verified: Passed automated checks, awaiting admin review'
    );

    for (const status of ALL_STATUSES) {
      const { name, summary } = VERIFICATION_STATUS_COPY[status];
      const tooltip = getVerificationStatusTooltip(status);

      expect(tooltip.startsWith(`${name}: `)).toBe(true);
      expect(summary[0]).toBe(summary[0].toUpperCase());
      expect(summary.endsWith('.')).toBe(false);
    }
  });

  it('says what each waiting state awaits and who decided the others', () => {
    expect(NOT_IN_RATINGS_YET_STATUSES).toHaveLength(3);
    for (const status of NOT_IN_RATINGS_YET_STATUSES) {
      expect(getVerificationStatusTooltip(status).toLowerCase()).toContain(
        'awaiting'
      );
    }
    for (const status of [
      VerificationStatus.Verified,
      VerificationStatus.Rejected,
    ]) {
      expect(getVerificationStatusTooltip(status)).toContain('by an admin');
      expect(getVerificationStatusTooltip(status)).not.toContain('awaiting');
    }
  });

  it('falls back instead of throwing on an unknown value', () => {
    const unknown = 99 as VerificationStatus;

    expect(getVerificationStatusCopy(unknown).name).toBe('Unknown status');
    expect(getVerificationStatusTooltip(unknown)).toBe(
      'Unknown status: Not recognised'
    );
  });

  it('lists every state exactly once in display order', () => {
    expect(VERIFICATION_STATUS_ORDER).toEqual([
      VerificationStatus.Verified,
      VerificationStatus.PreVerified,
      VerificationStatus.None,
      VerificationStatus.PreRejected,
      VerificationStatus.Rejected,
    ]);
    expect([...VERIFICATION_STATUS_ORDER].sort()).toEqual(
      [...ALL_STATUSES].sort()
    );
  });
});

describe('verification status labels', () => {
  it('names an icon-only status', () => {
    expect(getVerificationStatusLabel(VerificationStatus.Rejected)).toBe(
      'Rejected'
    );
  });

  it('adds the context and the warning marker to the name', () => {
    expect(
      getVerificationStatusLabel(VerificationStatus.PreVerified, {
        context: 'Game 3',
        hasWarnings: true,
      })
    ).toBe('Game 3: Pre-verified, with warnings');
  });
});

describe('verification status glyph rules', () => {
  it('marks only the automated states as automated checks', () => {
    expect(ALL_STATUSES.filter(isAutomatedCheckStatus)).toEqual([
      VerificationStatus.PreRejected,
      VerificationStatus.PreVerified,
    ]);
  });

  it('reinforces outcomes with green, red and neutral', () => {
    expect(ALL_STATUSES.map(getVerificationStatusHue)).toEqual([
      'neutral',
      'destructive',
      'success',
      'destructive',
      'success',
    ]);
  });
});

describe('not in ratings yet', () => {
  it('groups Pending, Pre-verified and Pre-rejected', () => {
    expect(ALL_STATUSES.filter(isNotInRatingsYet)).toEqual([
      VerificationStatus.None,
      VerificationStatus.PreRejected,
      VerificationStatus.PreVerified,
    ]);
    expect([...NOT_IN_RATINGS_YET_STATUSES].sort()).toEqual(
      ALL_STATUSES.filter(isNotInRatingsYet).sort()
    );
    expect(NOT_IN_RATINGS_YET_LABEL).toBe('Not in ratings yet');
  });

  it('keeps Verified and Rejected out of the group', () => {
    expect(isNotInRatingsYet(VerificationStatus.Verified)).toBe(false);
    expect(isNotInRatingsYet(VerificationStatus.Rejected)).toBe(false);
  });

  it('puts every state in exactly one ratings group', () => {
    expect(RATINGS_GROUPS.map((group) => group.label)).toEqual([
      'Verified',
      'Not in ratings yet',
      'Rejected',
    ]);

    const grouped = RATINGS_GROUPS.flatMap((group) => group.statuses);
    expect([...grouped].sort()).toEqual([...ALL_STATUSES].sort());

    expect(getRatingsGroup(VerificationStatus.None).key).toBe(
      'notInRatingsYet'
    );
    expect(getRatingsGroup(VerificationStatus.Verified).key).toBe('verified');
    expect(getRatingsGroup(VerificationStatus.Rejected).key).toBe('rejected');
    expect(getRatingsGroup(99 as VerificationStatus).key).toBe(
      'notInRatingsYet'
    );
  });

  it('links to the lowercase Rating FAQ page', () => {
    expect(RATING_FAQ_URL).toStartWith(
      'https://docs.otr.stagec.net/rating-framework/rating-faq#'
    );
  });
});
