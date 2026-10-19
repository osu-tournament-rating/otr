import { MOD_CHART_DISPLAY_THRESHOLD } from '@/lib/utils/playerModCharts';

/*
 * The help text behind the profile's section headers. The loading screen
 * draws the same info buttons, so the text lives here, outside the client
 * chart modules a server component cannot read constants from.
 */

export const MOD_PERFORMANCE_INFO = `Mods used in ${MOD_CHART_DISPLAY_THRESHOLD}%+ of verified ScoreV2 games`;

/** The footer of an EZ bar's tooltip in Mod performance. */
export const MOD_PERFORMANCE_EASY_NOTE = 'Includes 1.75x multiplier';

export const MOD_DISTRIBUTION_INFO = `Mods used in ${MOD_CHART_DISPLAY_THRESHOLD}%+ of verified games`;
