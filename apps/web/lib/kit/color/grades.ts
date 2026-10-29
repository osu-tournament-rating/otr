import { ScoreGrade } from '@otr/core/osu';

import { themeColor, type ThemeColor } from './theme-color';

export type GradeKey = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';

function grade(key: string): ThemeColor {
  return themeColor(`--score-grade-${key}`);
}

/**
 * Grade marks for charts and swatches. SS, S and A keep the hues of the osu!
 * grade badges; B to D are a grey ramp that recedes toward the card.
 */
export const GRADE_PALETTE: Readonly<Record<GradeKey, ThemeColor>> = {
  SS: grade('ss'),
  S: grade('s'),
  A: grade('a'),
  B: grade('b'),
  C: grade('c'),
  D: grade('d'),
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
  return GRADE_PALETTE[getGradeKey(scoreGrade)].css;
}
