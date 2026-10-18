import { Mods } from '@otr/core/osu';
import { attributeModsKey } from '@otr/core/osu/attribute-mods';

import type { BeatmapAttribute } from '@/lib/orpc/schema/beatmap';

/** The difficulty values a beatmap row shows. */
export interface BeatmapDifficultyStats {
  sr: number;
  cs: number;
  ar: number;
  od: number;
  hp: number;
  bpm: number;
  totalLength: number;
}

const DOUBLE_TIME_CLOCK_RATE = 1.5;

/**
 * The beatmap's values under `mods`, from its stored attributes. Null when
 * no stored row describes the combination: a mod without attributes (HT, FL),
 * or one not calculated yet. Speed changes BPM and length too, so a row is
 * either wholly modded or the caller keeps every nomod value.
 */
export function getModdedDifficultyStats(
  stats: BeatmapDifficultyStats,
  attributes: readonly BeatmapAttribute[],
  mods: number
): BeatmapDifficultyStats | null {
  const key = attributeModsKey(mods);
  if (key === null) return null;

  const attribute = attributes.find((candidate) => candidate.mods === key);
  if (!attribute) return null;

  const clockRate = key & Mods.DoubleTime ? DOUBLE_TIME_CLOCK_RATE : 1;

  return {
    sr: attribute.sr,
    cs: attribute.cs,
    ar: attribute.ar,
    od: attribute.od,
    hp: attribute.hp,
    bpm: stats.bpm * clockRate,
    totalLength: Math.round(stats.totalLength / clockRate),
  };
}
