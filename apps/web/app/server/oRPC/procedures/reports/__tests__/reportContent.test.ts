import { describe, expect, it } from 'bun:test';

import { ReportEntityType, ReportStatus } from '@otr/core/osu';

import {
  ReportCreateInputSchema,
  ReportResolveInputSchema,
} from '@/lib/orpc/schema/report';

import {
  normalizeReportCreateContent,
  normalizeStoredReportContent,
} from '../reportContent';

describe('ReportCreateInputSchema', () => {
  it('accepts the reason-based create shape without additional information', () => {
    expect(
      ReportCreateInputSchema.safeParse({
        entityType: ReportEntityType.Tournament,
        entityId: 1,
        reasonKey: 'missing-match-data',
      }).success
    ).toBe(true);
  });

  it('accepts the legacy create shape during the transition', () => {
    expect(
      ReportCreateInputSchema.safeParse({
        entityType: ReportEntityType.Tournament,
        entityId: 1,
        suggestedChanges: {},
        justification: 'Legacy context',
      }).success
    ).toBe(true);
  });

  it('requires either a reason or the complete legacy shape', () => {
    const result = ReportCreateInputSchema.safeParse({
      entityType: ReportEntityType.Tournament,
      entityId: 1,
      additionalInformation: 'Context without a reason',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'Reason is required',
          path: ['reasonKey'],
        })
      );
    }
  });

  it('limits additional information to 2000 characters', () => {
    expect(
      ReportCreateInputSchema.safeParse({
        entityType: ReportEntityType.Score,
        entityId: 1,
        reasonKey: 'invalid-score',
        additionalInformation: 'a'.repeat(2001),
      }).success
    ).toBe(false);
  });

  // The legacy shape stores both fields, names and values alike
  it.each([
    ['a justification', {}, 'a'.repeat(2001), false],
    ['suggested changes', { name: 'a'.repeat(2000) }, 'b', false],
    ['both, at the limit', { name: 'a'.repeat(1000) }, 'b'.repeat(996), true],
  ])(
    'limits the legacy shape to 2000 characters in all: %s',
    (_, suggestedChanges, justification, accepted) => {
      expect(
        ReportCreateInputSchema.safeParse({
          entityType: ReportEntityType.Tournament,
          entityId: 1,
          suggestedChanges,
          justification,
        }).success
      ).toBe(accepted);
    }
  );
});

describe('ReportResolveInputSchema', () => {
  const validInput = {
    reportId: 1,
    status: ReportStatus.Approved,
    adminNote: 'The reported data was corrected.',
  };

  it('requires a non-empty comment', () => {
    expect(
      ReportResolveInputSchema.safeParse({
        ...validInput,
        adminNote: undefined,
      }).success
    ).toBe(false);
    expect(
      ReportResolveInputSchema.safeParse({
        ...validInput,
        adminNote: '   ',
      }).success
    ).toBe(false);
  });
});

describe('normalizeReportCreateContent', () => {
  it('uses the new reason and clears field-specific legacy changes', () => {
    const input = ReportCreateInputSchema.parse({
      entityType: ReportEntityType.Match,
      entityId: 10,
      reasonKey: 'incorrect-match-result',
      additionalInformation: '  The final result is 5-3.  ',
      suggestedChanges: { name: 'ignored' },
      justification: 'ignored',
    });

    expect(normalizeReportCreateContent(input)).toEqual({
      reasonKey: 'incorrect-match-result',
      suggestedChanges: { reason: 'Incorrect match result' },
      justification: 'The final result is 5-3.',
    });
  });

  it('stores an empty legacy justification when context is omitted', () => {
    const input = ReportCreateInputSchema.parse({
      entityType: ReportEntityType.Game,
      entityId: 10,
      reasonKey: 'invalid-game',
    });

    expect(normalizeReportCreateContent(input)).toEqual({
      reasonKey: 'invalid-game',
      suggestedChanges: { reason: 'Invalid game' },
      justification: '',
    });
  });

  it('preserves legacy values and normalizes their reason', () => {
    const input = ReportCreateInputSchema.parse({
      entityType: ReportEntityType.Score,
      entityId: 10,
      suggestedChanges: { score: '123456' },
      justification: 'Legacy evidence',
    });

    expect(normalizeReportCreateContent(input)).toEqual({
      reasonKey: 'something-else',
      suggestedChanges: { score: '123456' },
      justification: 'Legacy evidence',
    });
  });
});

describe('normalizeStoredReportContent', () => {
  it('resolves a stored reason and exposes its context', () => {
    expect(
      normalizeStoredReportContent({
        entityType: ReportEntityType.Game,
        reasonKey: 'wrong-beatmap-or-mods',
        justification: 'This was a warmup map.',
      })
    ).toEqual({
      reason: {
        key: 'wrong-beatmap-or-mods',
        label: 'Wrong beatmap or mods',
      },
      additionalInformation: 'This was a warmup map.',
    });
  });

  it('falls back safely for legacy or unknown stored reasons', () => {
    expect(
      normalizeStoredReportContent({
        entityType: ReportEntityType.Tournament,
        reasonKey: null,
        justification: 'Legacy context',
      })
    ).toEqual({
      reason: { key: 'something-else', label: 'Something else' },
      additionalInformation: 'Legacy context',
    });

    expect(
      normalizeStoredReportContent({
        entityType: ReportEntityType.Tournament,
        reasonKey: 'removed-reason',
        justification: '',
      })
    ).toEqual({
      reason: { key: 'something-else', label: 'Something else' },
      additionalInformation: null,
    });
  });
});
