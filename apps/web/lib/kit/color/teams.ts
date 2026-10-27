import { Team } from '@otr/core/osu';

import { themeColor, type ThemeColor } from './theme-color';

export interface TeamColors {
  /** Edges, swatches, chart lines and tints. */
  mark: ThemeColor;
  /** Team-colored text, such as "Red wins by 12,345". */
  text: ThemeColor;
}

const NO_TEAM = themeColor('--match-no-team');

/**
 * The one red and blue pair for match teams (in globals.css, the same values
 * as the categorical palette's red and blue), plus a neutral for scores with
 * no team.
 */
export const MATCH_TEAM_COLORS: Readonly<Record<Team, TeamColors>> = {
  [Team.Red]: {
    mark: themeColor('--match-red'),
    text: themeColor('--match-red-foreground'),
  },
  [Team.Blue]: {
    mark: themeColor('--match-blue'),
    text: themeColor('--match-blue-foreground'),
  },
  [Team.NoTeam]: { mark: NO_TEAM, text: NO_TEAM },
};

/**
 * The score card tint for each team, spelled out so Tailwind finds it. At 6%,
 * foreground, muted and team text stay legible on the tinted card; at 10%,
 * muted text on the light card drops under 4.5:1.
 */
export const MATCH_TEAM_TINT_CLASS: Readonly<Record<Team, string>> = {
  [Team.Red]: 'bg-match-red/6',
  [Team.Blue]: 'bg-match-blue/6',
  [Team.NoTeam]: 'bg-match-no-team/6',
};

export function getTeamColor(team: Team): string {
  return (MATCH_TEAM_COLORS[team] ?? MATCH_TEAM_COLORS[Team.NoTeam]).mark.css;
}

export function getTeamTintClass(team: Team): string {
  return MATCH_TEAM_TINT_CLASS[team] ?? MATCH_TEAM_TINT_CLASS[Team.NoTeam];
}

/** Team text colour; scores with no team use the regular foreground. */
export function getTeamTextColor(team: Team): string {
  return team === Team.Red || team === Team.Blue
    ? MATCH_TEAM_COLORS[team].text.css
    : 'var(--foreground)';
}

/** The recessed game frame and the lighter score cards inside it. */
export const MATCH_SURFACES: Readonly<{
  gameFrame: ThemeColor;
  scoreCard: ThemeColor;
}> = {
  gameFrame: themeColor('--game-frame'),
  scoreCard: themeColor('--score-card'),
};
