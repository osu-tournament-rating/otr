import { CATEGORICAL_OTHER, CATEGORICAL_PALETTE } from './categorical';
import { GRADE_PALETTE } from './grades';
import { MOD_PALETTE } from './mods';
import { MATCH_SURFACES, MATCH_TEAM_COLORS } from './teams';
import { themeColor, type ThemeColor } from './theme-color';
import { TIER_PALETTE } from './tiers';
import { VERIFICATION_COLORS } from './verification';
import { Team } from '@otr/core/osu';

export type CalloutTone = 'info' | 'warning' | 'danger';

export interface CalloutColors {
  fill: ThemeColor;
  border: ThemeColor;
  /** Body text and the tone's icon. */
  foreground: ThemeColor;
}

function callout(tone: CalloutTone): CalloutColors {
  return {
    fill: themeColor(`--callout-${tone}`),
    border: themeColor(`--callout-${tone}-border`),
    foreground: themeColor(`--callout-${tone}-foreground`),
  };
}

/**
 * Callout tones. Info is a quiet slate rather than the link blue, so a notice
 * never reads as something to click.
 */
export const CALLOUT_COLORS: Readonly<Record<CalloutTone, CalloutColors>> = {
  info: callout('info'),
  warning: callout('warning'),
  danger: callout('danger'),
};

/**
 * The tooltip surface: `bg-accent`, its text colour, and muted text scoped to
 * `--accent-muted-foreground`, so `text-muted-foreground` inside a tooltip
 * stays legible. The shadcn tooltip and TapTooltip's popover both use it.
 */
export const ACCENT_SURFACE_CLASSES =
  'bg-accent text-accent-foreground [--muted-foreground:var(--accent-muted-foreground)]';

export interface TokenEntry {
  color: ThemeColor;
  label: string;
  /** Tailwind class stem, such as `series-1`, when the token is registered. */
  utility?: string;
}

export interface TokenGroup {
  id: string;
  title: string;
  entries: TokenEntry[];
}

const utilityOf = (color: ThemeColor) => color.token.slice(2);

/** Entries whose Tailwind class stem is the token's name. */
const named = (entries: { token: string; label: string }[]): TokenEntry[] =>
  entries.map(({ token, label }) => {
    const color = themeColor(token);
    return { color, label, utility: utilityOf(color) };
  });

/**
 * Every token the component library added to globals.css, and the theme text
 * colors it depends on, grouped as the gallery shows them. Names only: the
 * values live in globals.css.
 */
export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    id: 'text',
    title: 'Text',
    entries: named([
      { token: '--foreground', label: 'Text' },
      { token: '--muted-foreground', label: 'Muted text' },
      { token: '--accent-muted-foreground', label: 'Muted text in a tooltip' },
      { token: '--destructive-foreground', label: 'Red text' },
    ]),
  },
  {
    id: 'categorical',
    title: 'Categorical chart palette',
    entries: [
      ...CATEGORICAL_PALETTE.map((color) => ({
        color,
        label: `${color.slot} ${color.name.toLowerCase()}`,
        utility: utilityOf(color),
      })),
      {
        color: CATEGORICAL_OTHER,
        label: 'Other',
        utility: utilityOf(CATEGORICAL_OTHER),
      },
    ],
  },
  {
    id: 'verification',
    title: 'Verification status',
    entries: [
      { color: VERIFICATION_COLORS.success, label: 'Verified' },
      { color: VERIFICATION_COLORS.neutral, label: 'Not in ratings yet' },
      { color: VERIFICATION_COLORS.destructive, label: 'Rejected' },
    ].map((entry) => ({ ...entry, utility: utilityOf(entry.color) })),
  },
  {
    id: 'callouts',
    title: 'Callout tones',
    entries: (['info', 'warning', 'danger'] as const).flatMap((tone) => {
      const { fill, border, foreground } = CALLOUT_COLORS[tone];
      const name = tone[0].toUpperCase() + tone.slice(1);
      return [
        { color: fill, label: `${name} fill` },
        { color: border, label: `${name} border` },
        { color: foreground, label: `${name} text` },
      ].map((entry) => ({ ...entry, utility: utilityOf(entry.color) }));
    }),
  },
  {
    id: 'match',
    title: 'Match teams and surfaces',
    entries: [
      { color: MATCH_TEAM_COLORS[Team.Red].mark, label: 'Red team' },
      { color: MATCH_TEAM_COLORS[Team.Red].text, label: 'Red team text' },
      { color: MATCH_TEAM_COLORS[Team.Blue].mark, label: 'Blue team' },
      { color: MATCH_TEAM_COLORS[Team.Blue].text, label: 'Blue team text' },
      { color: MATCH_TEAM_COLORS[Team.NoTeam].mark, label: 'No team' },
      { color: MATCH_SURFACES.gameFrame, label: 'Game frame' },
      { color: MATCH_SURFACES.scoreCard, label: 'Score card' },
    ].map((entry) => ({ ...entry, utility: utilityOf(entry.color) })),
  },
  {
    // `--primary` colors icons, borders, rings and selection, `--primary-solid`
    // is the fill behind white text in both themes, and `--link` colors blue
    // text.
    id: 'brand',
    title: 'Brand blue',
    entries: named([
      { token: '--primary', label: 'Blue icons, borders and selection' },
      { token: '--link', label: 'Blue link text' },
      { token: '--primary-solid', label: 'Blue fill behind white text' },
    ]),
  },
  {
    id: 'accent',
    title: 'Notification',
    entries: named([{ token: '--notification', label: 'Notification dot' }]),
  },
  {
    id: 'support',
    title: 'Support',
    entries: named([{ token: '--support', label: 'Support heart on hover' }]),
  },
  {
    id: 'tiers',
    title: 'Tiers',
    entries: Object.entries(TIER_PALETTE).map(([label, color]) => ({
      color,
      label,
      utility: utilityOf(color),
    })),
  },
  {
    id: 'grades',
    title: 'Score grades',
    entries: Object.entries(GRADE_PALETTE).map(([label, color]) => ({
      color,
      label,
    })),
  },
  {
    id: 'mods',
    title: 'Mods',
    entries: MOD_PALETTE.map((color) => ({ color, label: color.label })),
  },
];
