/**
 * A color token from globals.css, by name. Its values live only in
 * globals.css, which sets one for each theme.
 */
export interface ThemeColor {
  /** The custom property, such as `--series-1`. */
  token: string;
  /** `var(--series-1)`, ready for a style or a Recharts `fill`. */
  css: string;
}

export function themeColor(token: string): ThemeColor {
  return { token, css: `var(${token})` };
}
