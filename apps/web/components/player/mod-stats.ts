import { CATEGORICAL_OTHER } from '@/lib/kit/color/categorical';
import { getModPaletteColor } from '@/lib/kit/color/mods';
import type { PlayerModStats } from '@/lib/orpc/schema/playerStats';
import {
  BEATMAP_MOD_OTHER_LABEL,
  getBeatmapModLabel,
  isChartMods,
  normalizeBeatmapDisplayMods,
  normalizedScore,
} from '@/lib/utils/mods';
import { MOD_CHART_DISPLAY_THRESHOLD } from '@/lib/utils/playerModCharts';

export interface ModGroup {
  /**
   * The display combination: NF and SO dropped, NC shown as DT. For "Other",
   * every mod any of its combinations has.
   */
  mods: number;
  /** `HD`, `NM`, as the beatmap pages label mods, or `Other`. */
  label: string;
  /** Games played with it. */
  count: number;
  /** Mean score with the mod multipliers removed. */
  averageScore: number;
  /** The mod palette colour, for the chart marks. */
  fill: string;
}

/** The map key of the "Other" group; no display combination is negative. */
const OTHER_KEY = -1;

/**
 * Folds a player's per-mod stats into the chart mods (NM, HD, HR, DT, FL) and
 * one "Other" group for everything else, then drops groups under the display
 * threshold (a share of all games). The chart mods come largest first by
 * `sortBy`, and "Other" last.
 */
export function groupModStats(
  modStats: readonly PlayerModStats[],
  sortBy: 'count' | 'averageScore'
): ModGroup[] {
  const totalGames = modStats.reduce((sum, stat) => sum + stat.count, 0);
  const threshold = (totalGames * MOD_CHART_DISPLAY_THRESHOLD) / 100;
  const groups = new Map<number, ModGroup & { scoreSum: number }>();

  for (const stat of modStats) {
    const mods = normalizeBeatmapDisplayMods(stat.mods);
    const other = !isChartMods(mods);
    const key = other ? OTHER_KEY : mods;
    const count = stat.count || 1;
    const scoreSum = normalizedScore(stat.mods, stat.averageScore) * count;
    const existing = groups.get(key);

    groups.set(key, {
      mods: other ? (existing?.mods ?? 0) | mods : mods,
      label: other ? BEATMAP_MOD_OTHER_LABEL : getBeatmapModLabel(mods),
      fill: other ? CATEGORICAL_OTHER.css : getModPaletteColor(mods),
      count: (existing?.count ?? 0) + count,
      scoreSum: (existing?.scoreSum ?? 0) + scoreSum,
      averageScore: 0,
    });
  }

  const shown = Array.from(groups.entries())
    .filter(([, group]) => group.count >= threshold)
    .map(([key, { scoreSum, ...group }]) => ({
      key,
      group: { ...group, averageScore: Math.round(scoreSum / group.count) },
    }));

  const chartMods = shown
    .filter(({ key }) => key !== OTHER_KEY)
    .map(({ group }) => group)
    .sort(
      (left, right) =>
        right[sortBy] - left[sortBy] ||
        (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)
    );
  const other = shown.find(({ key }) => key === OTHER_KEY)?.group;

  return other ? [...chartMods, other] : chartMods;
}
