import { Mods } from './enums';

// Supporting HT or FL later means moving it from UNSUPPORTED_ATTRIBUTE_MODS
// into ATTRIBUTE_MODS_MASK; the new keys then get calculated like any other.

/** Mods whose osu! standard difficulty attributes o!TR stores. */
export const ATTRIBUTE_MODS_MASK =
  Mods.Easy | Mods.Hidden | Mods.HardRock | Mods.DoubleTime;

/**
 * Mods that change osu! standard difficulty but have no stored attributes
 * yet. Relax2 is Autopilot.
 */
export const UNSUPPORTED_ATTRIBUTE_MODS =
  Mods.HalfTime | Mods.Flashlight | Mods.TouchDevice | Mods.Relax | Mods.Relax2;

/**
 * The beatmap_attributes.mods key for a play (pass game.mods | score.mods):
 * Nightcore counts as DoubleTime, mods that do not change difficulty are
 * dropped. Null when the play uses a mod in UNSUPPORTED_ATTRIBUTE_MODS,
 * because no stored row describes it.
 */
export const attributeModsKey = (mods: number): number | null => {
  if ((mods & UNSUPPORTED_ATTRIBUTE_MODS) !== 0) {
    return null;
  }

  // Stored mods carry Nightcore without the DoubleTime bit.
  const withDoubleTime =
    (mods & Mods.Nightcore) !== 0 ? mods | Mods.DoubleTime : mods;

  return withDoubleTime & ATTRIBUTE_MODS_MASK;
};
