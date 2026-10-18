import { describe, expect, it } from 'bun:test';
import { Mods, ScoreGrade, Team, VerificationStatus } from '@otr/core/osu';

import {
  CATEGORICAL_OTHER,
  CATEGORICAL_PALETTE,
  seriesColor,
} from '@/lib/kit/color/categorical';
import {
  CONTRAST_MARK,
  CONTRAST_TEXT,
  composite,
  contrastRatio,
  parseColor,
  toHex,
} from '@/lib/kit/color/contrast';
import {
  CVD_SEPARATION_TARGET,
  NORMAL_SEPARATION_FLOOR,
  colorDistance,
  worstAdjacentDistance,
} from '@/lib/kit/color/cvd';
import { GRADE_PALETTE, getGradeColor } from '@/lib/kit/color/grades';
import {
  MOD_FILL_FOREGROUND,
  MOD_PALETTE,
  getModPaletteColor,
} from '@/lib/kit/color/mods';
import {
  getStarRatingColor,
  getStarRatingForegroundColor,
  getStarRatingMarkColor,
  getStarRatingMarkColors,
} from '@/lib/kit/color/star-rating';
import { SURFACES, TEXT_COLORS, type Theme } from '@/lib/kit/color/surfaces';
import {
  MATCH_SURFACES,
  MATCH_TEAM_COLORS,
  MATCH_TEAM_TINT,
  MATCH_TEAM_TINT_CLASS,
  getTeamColor,
  getTeamTextColor,
  getTeamTintClass,
} from '@/lib/kit/color/teams';
import type { ThemeColor } from '@/lib/kit/color/theme-color';
import { TIER_PALETTE, TIER_TEXT_CLASS } from '@/lib/kit/color/tiers';
import {
  ACCENT_MUTED_TEXT_COLOR,
  ACCENT_SURFACE_CLASSES,
  ALL_TOKENS,
  CALLOUT_COLORS,
  DESTRUCTIVE_TEXT_COLOR,
  FOREGROUND_COLOR,
  MUTED_TEXT_COLOR,
} from '@/lib/kit/color/tokens';
import {
  getRatingsGroupColor,
  getVerificationStatusColor,
} from '@/lib/kit/color/verification';
import { getBeatmapModLabel } from '@/lib/utils/mods';
import { tierNames } from '@/lib/utils/tierData';

const THEMES: Theme[] = ['light', 'dark'];

const TEXT = TEXT_COLORS;

function minimumFor(color: ThemeColor): number | null {
  if (color.role === 'text') return CONTRAST_TEXT;
  if (color.role === 'mark') return CONTRAST_MARK;
  return null;
}

describe('every palette colour against its cards', () => {
  const checked = ALL_TOKENS.filter((color) => minimumFor(color) !== null);

  for (const theme of THEMES) {
    for (const surface of ['card', 'muted'] as const) {
      it(`clears its minimum on the ${theme} ${surface} surface`, () => {
        const failures = checked
          .map((color) => ({
            token: color.token,
            value: color[theme],
            ratio: contrastRatio(color[theme], SURFACES[theme][surface]),
            minimum: minimumFor(color)!,
          }))
          .filter(({ ratio, minimum }) => ratio < minimum);

        expect(failures).toEqual([]);
      });
    }
  }

  it('checks the categorical, verification, tier, grade and mod palettes', () => {
    const tokens = new Set(checked.map((color) => color.token));

    for (const color of [
      ...CATEGORICAL_PALETTE,
      CATEGORICAL_OTHER,
      ...Object.values(TIER_PALETTE),
      ...Object.values(GRADE_PALETTE),
      ...MOD_PALETTE,
    ]) {
      expect(tokens.has(color.token)).toBe(true);
    }
  });
});

describe('theme text', () => {
  const PANEL_SURFACES = ['card', 'muted', 'popover'] as const;

  for (const theme of THEMES) {
    it(`clears 4.5:1 on panels, tiles and popovers (${theme})`, () => {
      const failures = [
        FOREGROUND_COLOR,
        MUTED_TEXT_COLOR,
        DESTRUCTIVE_TEXT_COLOR,
      ]
        .flatMap((color) =>
          PANEL_SURFACES.map((surface) => ({
            token: color.token,
            surface,
            ratio: contrastRatio(color[theme], SURFACES[theme][surface]),
          }))
        )
        .filter(({ ratio }) => ratio < CONTRAST_TEXT);

      expect(failures).toEqual([]);
    });

    it(`keeps tooltip text legible on the accent surface (${theme})`, () => {
      const accent = SURFACES[theme].accent;

      expect(
        contrastRatio(FOREGROUND_COLOR[theme], accent)
      ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
      expect(
        contrastRatio(ACCENT_MUTED_TEXT_COLOR[theme], accent)
      ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
      // Why the accent surface needs its own muted text.
      expect(contrastRatio(MUTED_TEXT_COLOR[theme], accent)).toBeLessThan(
        CONTRAST_TEXT
      );
    });

    it(`keeps muted text muted inside a tooltip (${theme})`, () => {
      const accent = SURFACES[theme].accent;

      expect(
        contrastRatio(ACCENT_MUTED_TEXT_COLOR[theme], accent)
      ).toBeLessThan(contrastRatio(FOREGROUND_COLOR[theme], accent));
    });
  }

  it('mirrors the text colours the other palette checks use', () => {
    for (const theme of THEMES) {
      expect(toHex(parseColor(FOREGROUND_COLOR[theme]))).toBe(
        TEXT[theme].foreground
      );
      expect(toHex(parseColor(MUTED_TEXT_COLOR[theme]))).toBe(
        TEXT[theme].muted
      );
    }
  });

  it('scopes muted text to the accent token on the tooltip surface', () => {
    expect(ACCENT_SURFACE_CLASSES.split(' ')).toEqual(
      expect.arrayContaining([
        'bg-accent',
        `[--muted-foreground:${ACCENT_MUTED_TEXT_COLOR.css}]`,
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

  for (const theme of THEMES) {
    const colors = CATEGORICAL_PALETTE.map((color) => color[theme]);

    it(`keeps neighbours apart for protanopia and deuteranopia (${theme})`, () => {
      expect(worstAdjacentDistance(colors, 'protan')).toBeGreaterThanOrEqual(
        CVD_SEPARATION_TARGET
      );
      expect(worstAdjacentDistance(colors, 'deutan')).toBeGreaterThanOrEqual(
        CVD_SEPARATION_TARGET
      );
    });

    it(`keeps neighbours apart with full colour vision (${theme})`, () => {
      expect(worstAdjacentDistance(colors, 'normal')).toBeGreaterThanOrEqual(
        NORMAL_SEPARATION_FLOOR
      );
    });
  }

  it('never cycles: a ninth series is "Other"', () => {
    expect(seriesColor(0)).toBe('var(--series-1)');
    expect(seriesColor(7)).toBe('var(--series-8)');
    expect(seriesColor(8)).toBe('var(--series-other)');
    expect(seriesColor(20)).toBe('var(--series-other)');
  });
});

describe('match teams', () => {
  it('uses the categorical red and blue', () => {
    expect(MATCH_TEAM_COLORS[Team.Red].mark.light).toBe(
      CATEGORICAL_PALETTE[7].light
    );
    expect(MATCH_TEAM_COLORS[Team.Red].mark.dark).toBe(
      CATEGORICAL_PALETTE[7].dark
    );
    expect(MATCH_TEAM_COLORS[Team.Blue].mark.light).toBe(
      CATEGORICAL_PALETTE[0].light
    );
    expect(MATCH_TEAM_COLORS[Team.Blue].mark.dark).toBe(
      CATEGORICAL_PALETTE[0].dark
    );
  });

  it('maps teams to their tokens', () => {
    expect(getTeamColor(Team.Red)).toBe('var(--match-red)');
    expect(getTeamColor(Team.Blue)).toBe('var(--match-blue)');
    expect(getTeamColor(Team.NoTeam)).toBe('var(--match-no-team)');
    expect(getTeamTextColor(Team.Red)).toBe('var(--match-red-foreground)');
    expect(getTeamTextColor(Team.NoTeam)).toBe('var(--foreground)');
  });

  for (const theme of THEMES) {
    it(`keeps text and team marks legible on the game frame and score card (${theme})`, () => {
      for (const surface of [
        MATCH_SURFACES.gameFrame,
        MATCH_SURFACES.scoreCard,
      ]) {
        const background = surface[theme];

        expect(
          contrastRatio(TEXT[theme].foreground, background)
        ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        expect(
          contrastRatio(TEXT[theme].muted, background)
        ).toBeGreaterThanOrEqual(CONTRAST_TEXT);

        for (const team of [Team.Red, Team.Blue]) {
          expect(
            contrastRatio(MATCH_TEAM_COLORS[team].text[theme], background)
          ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        }
        for (const team of [Team.Red, Team.Blue, Team.NoTeam]) {
          expect(
            contrastRatio(MATCH_TEAM_COLORS[team].mark[theme], background)
          ).toBeGreaterThanOrEqual(CONTRAST_MARK);
        }
      }
    });

    it(`keeps text legible on a team-tinted score card (${theme})`, () => {
      for (const team of [Team.Red, Team.Blue, Team.NoTeam]) {
        const tinted = composite(
          {
            ...parseColor(MATCH_TEAM_COLORS[team].mark[theme]),
            alpha: MATCH_TEAM_TINT,
          },
          parseColor(MATCH_SURFACES.scoreCard[theme])
        );
        const texts = [
          TEXT[theme].foreground,
          TEXT[theme].muted,
          ...(team === Team.NoTeam
            ? []
            : [MATCH_TEAM_COLORS[team].text[theme]]),
        ];

        for (const text of texts) {
          expect(contrastRatio(text, tinted)).toBeGreaterThanOrEqual(
            CONTRAST_TEXT
          );
        }
        expect(
          contrastRatio(MATCH_TEAM_COLORS[team].mark[theme], tinted)
        ).toBeGreaterThanOrEqual(CONTRAST_MARK);
      }
    });

    it(`recesses the game frame and lifts the score card (${theme})`, () => {
      const frame = contrastRatio(
        MATCH_SURFACES.gameFrame[theme],
        SURFACES[theme].card
      );
      const card = contrastRatio(
        MATCH_SURFACES.scoreCard[theme],
        MATCH_SURFACES.gameFrame[theme]
      );

      expect(frame).toBeGreaterThan(1);
      expect(card).toBeGreaterThan(1);
    });
  }
});

describe('match team tint', () => {
  it('spells out a tint class at the tested strength for every team', () => {
    const percent = Math.round(MATCH_TEAM_TINT * 100);

    expect(MATCH_TEAM_TINT_CLASS[Team.Red]).toBe(`bg-match-red/${percent}`);
    expect(MATCH_TEAM_TINT_CLASS[Team.Blue]).toBe(`bg-match-blue/${percent}`);
    expect(MATCH_TEAM_TINT_CLASS[Team.NoTeam]).toBe(
      `bg-match-no-team/${percent}`
    );
    expect(getTeamTintClass(99 as Team)).toBe(
      MATCH_TEAM_TINT_CLASS[Team.NoTeam]
    );
  });
});

describe('callouts', () => {
  for (const theme of THEMES) {
    it(`keep text, muted text and icons legible on their fill (${theme})`, () => {
      for (const tone of Object.values(CALLOUT_COLORS)) {
        const fill = tone.fill[theme];

        expect(
          contrastRatio(tone.foreground[theme], fill)
        ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        expect(
          contrastRatio(TEXT[theme].foreground, fill)
        ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        expect(contrastRatio(TEXT[theme].muted, fill)).toBeGreaterThanOrEqual(
          CONTRAST_TEXT
        );
      }
    });
  }
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

  for (const theme of THEMES) {
    it(`keeps B to D receding toward the card (${theme})`, () => {
      const [b, c, d] = (['B', 'C', 'D'] as const).map((key) =>
        contrastRatio(GRADE_PALETTE[key][theme], SURFACES[theme].card)
      );
      expect(b).toBeGreaterThan(c);
      expect(c).toBeGreaterThan(d);
    });
  }
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

  for (const theme of THEMES) {
    it(`separates Sudden Death and Touch Device (${theme})`, () => {
      const sd = MOD_PALETTE.find((entry) => entry.label === 'SD')!;
      const td = MOD_PALETTE.find((entry) => entry.label === 'TD')!;
      expect(colorDistance(sd[theme], td[theme])).toBeGreaterThan(10);
    });

    it(`keeps every mod distinct from every other (${theme})`, () => {
      const colors = [
        ...MOD_PALETTE.map((entry) => entry[theme]),
        CATEGORICAL_OTHER[theme],
      ];

      for (let first = 0; first < colors.length; first++) {
        for (let second = first + 1; second < colors.length; second++) {
          expect(colorDistance(colors[first], colors[second])).toBeGreaterThan(
            4
          );
        }
      }
    });

    it(`takes black text on every solid mod fill (${theme})`, () => {
      for (const entry of MOD_PALETTE) {
        expect(
          contrastRatio(MOD_FILL_FOREGROUND, entry[theme])
        ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
      }
    });
  }
});

describe('star rating', () => {
  const ratings = Array.from({ length: 201 }, (_, index) => index * 0.05);

  for (const theme of THEMES) {
    it(`steps marks to clear 3:1 on ${theme} surfaces`, () => {
      for (const rating of ratings) {
        const mark = getStarRatingMarkColors(rating)[theme];

        expect(
          contrastRatio(mark, SURFACES[theme].card)
        ).toBeGreaterThanOrEqual(CONTRAST_MARK);
        expect(
          contrastRatio(mark, SURFACES[theme].muted)
        ).toBeGreaterThanOrEqual(CONTRAST_MARK);
      }
    });
  }

  it('keeps pill text legible across the spectrum', () => {
    for (const rating of ratings) {
      expect(
        contrastRatio(
          getStarRatingForegroundColor(rating),
          getStarRatingColor(rating)
        )
      ).toBeGreaterThanOrEqual(CONTRAST_TEXT);
    }
  });

  it('returns a theme-following CSS colour', () => {
    expect(getStarRatingMarkColor(5.2)).toMatch(
      /^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/
    );
  });
});
