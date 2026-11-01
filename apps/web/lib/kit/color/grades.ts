import { ScoreGrade } from '@otr/core/osu';

export type GradeKey = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';

/** `--chart-1` moved `percent` of the way toward `toward`. */
function step(toward: '--foreground' | '--card', percent: number): string {
  return `color-mix(in oklab, var(--chart-1) ${100 - percent}%, var(${toward}))`;
}

/**
 * Grade marks for charts and swatches: one blue ramp from SS, the strongest,
 * to D, the faintest. SS and S move `--chart-1` toward the text color (darker
 * in light mode, lighter in dark mode), and B to D move it toward the card,
 * so the order reads the same way in both themes. No grade has a token of
 * its own.
 */
export const GRADE_PALETTE: Readonly<Record<GradeKey, string>> = {
  SS: step('--foreground', 40),
  S: step('--foreground', 20),
  A: 'var(--chart-1)',
  B: step('--card', 25),
  C: step('--card', 45),
  D: step('--card', 62),
};

/** Folds the silver grades into their gold ones, as the badges do. */
export function getGradeKey(scoreGrade: ScoreGrade): GradeKey {
  switch (scoreGrade) {
    case ScoreGrade.SSH:
    case ScoreGrade.SS:
      return 'SS';
    case ScoreGrade.SH:
    case ScoreGrade.S:
      return 'S';
    case ScoreGrade.A:
      return 'A';
    case ScoreGrade.B:
      return 'B';
    case ScoreGrade.C:
      return 'C';
    default:
      return 'D';
  }
}

export function getGradeColor(scoreGrade: ScoreGrade): string {
  return GRADE_PALETTE[getGradeKey(scoreGrade)];
}
