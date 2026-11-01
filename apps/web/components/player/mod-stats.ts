import { getModPaletteColor } from '@/lib/kit/color/mods';
import type { PlayerModStats } from '@/lib/orpc/schema/playerStats';
import {
  getBeatmapModLabel,
  normalizeBeatmapDisplayMods,
  normalizedScore,
} from '@/lib/utils/mods';
import { MOD_CHART_DISPLAY_THRESHOLD } from '@/lib/utils/playerModCharts';

export interface ModGroup {
  /** The display combination: NF and SO dropped, NC shown as DT. */
  mods: number;
  /** `HDHR`, `NM`, as the beatmap pages label mods. */
  label: string;
  /** Games played with it. */
  count: number;
  /** Mean score with the mod multipliers removed. */
  averageScore: number;
  /** The mod palette color, for the chart marks. */
  fill: string;
}

/**
 * Folds a player's per-mod stats into the beatmap pages' display groups and
 * drops groups under the display threshold (a share of all games), largest
 * first by `sortBy`.
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
    const count = stat.count || 1;
    const scoreSum = normalizedScore(stat.mods, stat.averageScore) * count;
    const existing = groups.get(mods);

    groups.set(mods, {
      mods,
      label: getBeatmapModLabel(mods),
      fill: getModPaletteColor(mods),
      count: (existing?.count ?? 0) + count,
      scoreSum: (existing?.scoreSum ?? 0) + scoreSum,
      averageScore: 0,
    });
  }

  return Array.from(groups.values())
    .filter((group) => group.count >= threshold)
    .map(({ scoreSum, ...group }) => ({
      ...group,
      averageScore: Math.round(scoreSum / group.count),
    }))
    .sort(
      (left, right) =>
        right[sortBy] - left[sortBy] ||
        (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)
    );
}
