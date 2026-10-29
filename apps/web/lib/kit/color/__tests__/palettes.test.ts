import { describe, expect, it } from 'bun:test';
import { Mods, ScoreGrade, Team, VerificationStatus } from '@otr/core/osu';

import { CATEGORICAL_PALETTE, seriesColor } from '@/lib/kit/color/categorical';
import { GRADE_PALETTE, getGradeColor } from '@/lib/kit/color/grades';
import { getModPaletteColor } from '@/lib/kit/color/mods';
import {
  getTeamColor,
  getTeamTextColor,
  getTeamTintClass,
} from '@/lib/kit/color/teams';
import {
  getStarRatingColor,
  getStarRatingMarkColor,
} from '@/lib/kit/color/star-rating';
import { TIER_PALETTE, TIER_TEXT_CLASS } from '@/lib/kit/color/tiers';
import { ACCENT_SURFACE_CLASSES } from '@/lib/kit/color/tokens';
import {
  getRatingsGroupColor,
  getVerificationStatusColor,
} from '@/lib/kit/color/verification';
import { tierNames } from '@/lib/utils/tierData';

describe('theme text', () => {
  it('scopes muted text to the accent token on the tooltip surface', () => {
    expect(ACCENT_SURFACE_CLASSES.split(' ')).toEqual(
      expect.arrayContaining([
        'bg-accent',
        '[--muted-foreground:var(--accent-muted-foreground)]',
      ])
    );
  });
});

describe('categorical palette', () => {
  it('has eight slots in a fixed order', () => {
    expect(CATEGORICAL_PALETTE.map((color) => color.token)).toEqual(
      Array.from({ length: 8 }, (_, index) => `--chart-${index + 1}`)
    );
  });

  it('never cycles: a ninth series is "Other"', () => {
    expect(seriesColor(0)).toBe('var(--chart-1)');
    expect(seriesColor(7)).toBe('var(--chart-8)');
    expect(seriesColor(8)).toBe('var(--chart-other)');
    expect(seriesColor(20)).toBe('var(--chart-other)');
  });
});

describe('match teams', () => {
  it('maps teams to their tokens', () => {
    expect(getTeamColor(Team.Red)).toBe('var(--match-red)');
    expect(getTeamColor(Team.Blue)).toBe('var(--match-blue)');
    expect(getTeamColor(Team.NoTeam)).toBe('var(--match-no-team)');
    expect(getTeamTextColor(Team.Red)).toBe('var(--match-red-foreground)');
    expect(getTeamTextColor(Team.NoTeam)).toBe('var(--foreground)');
  });
});

describe('match team tint', () => {
  it('tints each team differently and an unknown team as no team', () => {
    const tints = [Team.Red, Team.Blue, Team.NoTeam].map(getTeamTintClass);

    expect(new Set(tints).size).toBe(3);
    expect(getTeamTintClass(99 as Team)).toBe(getTeamTintClass(Team.NoTeam));
  });
});

describe('verification', () => {
  it('puts the pre-states in the neutral chart group', () => {
    expect(getRatingsGroupColor(VerificationStatus.Verified)).toBe(
      'var(--verification-verified)'
    );
    expect(getRatingsGroupColor(VerificationStatus.Rejected)).toBe(
      'var(--verification-rejected)'
    );
    for (const status of [
      VerificationStatus.None,
      VerificationStatus.PreVerified,
      VerificationStatus.PreRejected,
    ]) {
      expect(getRatingsGroupColor(status)).toBe('var(--verification-neutral)');
    }
  });

  it('keeps the outcome hue on icons', () => {
    expect(getVerificationStatusColor(VerificationStatus.PreVerified)).toBe(
      'var(--verification-verified)'
    );
    expect(getVerificationStatusColor(VerificationStatus.PreRejected)).toBe(
      'var(--verification-rejected)'
    );
    expect(getVerificationStatusColor(VerificationStatus.None)).toBe(
      'var(--verification-neutral)'
    );
  });
});

describe('tiers', () => {
  it('covers every tier with a text class', () => {
    expect(Object.keys(TIER_PALETTE).sort()).toEqual([...tierNames].sort());
    for (const tier of tierNames) {
      expect(TIER_TEXT_CLASS[tier]).toBe(
        `text-${TIER_PALETTE[tier].token.slice(2)}`
      );
    }
  });
});

describe('grades', () => {
  it('folds silver grades into their gold ones', () => {
    expect(getGradeColor(ScoreGrade.SSH)).toBe(getGradeColor(ScoreGrade.SS));
    expect(getGradeColor(ScoreGrade.SH)).toBe(getGradeColor(ScoreGrade.S));
  });

  it('gives every grade its own step of one chart hue', () => {
    const marks = Object.values(GRADE_PALETTE);

    expect(new Set(marks).size).toBe(6);
    for (const mark of marks) expect(mark).toContain('var(--chart-1)');
  });
});

describe('mods', () => {
  it('colors NM, HD, HR, DT and FL with the first five chart colors', () => {
    expect(
      [
        Mods.None,
        Mods.Hidden,
        Mods.HardRock,
        Mods.DoubleTime,
        Mods.Flashlight,
      ].map(getModPaletteColor)
    ).toEqual([1, 2, 3, 4, 5].map((slot) => `var(--chart-${slot})`));
  });

  it('follows the display rules', () => {
    expect(getModPaletteColor(Mods.Nightcore)).toBe('var(--chart-4)');
    expect(getModPaletteColor(Mods.Hidden | Mods.NoFail)).toBe(
      'var(--chart-2)'
    );
  });

  it('gives every other mod or combination the "Other" color', () => {
    for (const mods of [
      Mods.Hidden | Mods.HardRock,
      Mods.Easy,
      Mods.HalfTime,
      Mods.Relax2,
      Mods.Key7,
      Mods.Hidden | Mods.HardRock | Mods.Flashlight,
    ]) {
      expect(getModPaletteColor(mods)).toBe('var(--chart-other)');
    }
  });
});

describe('star rating', () => {
  it('steps a pale spectrum color for light cards only', () => {
    // 2.5 stars is the spectrum's pale green: too light for a light card,
    // already clear on a dark one.
    const pale = getStarRatingColor(2.5);
    const paleMark = getStarRatingMarkColor(2.5);
    expect(paleMark).toStartWith('light-dark(');
    expect(paleMark).toEndWith(`, ${pale})`);
    expect(paleMark).not.toStartWith(`light-dark(${pale},`);

    // 5.8 stars is a mid purple that clears 3:1 in both themes unchanged.
    const mid = getStarRatingColor(5.8);
    expect(getStarRatingMarkColor(5.8)).toBe(`light-dark(${mid}, ${mid})`);
  });
});
