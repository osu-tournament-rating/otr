import { describe, expect, it } from 'bun:test';
import { Mods, ScoreGrade, Team, VerificationStatus } from '@otr/core/osu';

import { CATEGORICAL_PALETTE, seriesColor } from '@/lib/kit/color/categorical';
import { getGradeColor } from '@/lib/kit/color/grades';
import { MOD_PALETTE, getModPaletteColor } from '@/lib/kit/color/mods';
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
import { getBeatmapModLabel } from '@/lib/utils/mods';
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
      Array.from({ length: 8 }, (_, index) => `--series-${index + 1}`)
    );
  });

  it('never cycles: a ninth series is "Other"', () => {
    expect(seriesColor(0)).toBe('var(--series-1)');
    expect(seriesColor(7)).toBe('var(--series-8)');
    expect(seriesColor(8)).toBe('var(--series-other)');
    expect(seriesColor(20)).toBe('var(--series-other)');
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
    expect(getGradeColor(ScoreGrade.SSH)).toBe('var(--score-grade-ss)');
    expect(getGradeColor(ScoreGrade.SH)).toBe('var(--score-grade-s)');
    expect(getGradeColor(ScoreGrade.D)).toBe('var(--score-grade-d)');
  });
});

describe('mods', () => {
  it('gives No Mod its own colour, not the link blue', () => {
    expect(getModPaletteColor(Mods.None)).toBe('var(--mod-nm)');
    expect(getModPaletteColor(Mods.None)).not.toBe('var(--primary)');
  });

  it('labels each colour as the beatmap pages label its mods', () => {
    for (const entry of MOD_PALETTE) {
      if (entry.label === 'RX' || entry.label === 'KEY') continue;
      expect(entry.mods.map(getBeatmapModLabel)).toEqual([entry.label]);
    }
  });

  it('follows the display rules', () => {
    expect(getModPaletteColor(Mods.Nightcore)).toBe('var(--mod-dt)');
    expect(getModPaletteColor(Mods.Hidden | Mods.NoFail)).toBe('var(--mod-hd)');
    expect(getModPaletteColor(Mods.Relax2)).toBe('var(--mod-rx)');
    expect(getModPaletteColor(Mods.Key7)).toBe('var(--mod-key)');
    expect(
      getModPaletteColor(Mods.Hidden | Mods.HardRock | Mods.Flashlight)
    ).toBe('var(--series-other)');
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
