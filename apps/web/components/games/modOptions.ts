import { Mods } from '@otr/core/osu';

import type { Option } from '@/components/select/multiple-select';
import { getEnumFlags, ModsEnumHelper } from '@/lib/enum-helpers';

/** One bit set. Groups such as Invalid Mods set several flags at once. */
const isSingleMod = (mods: Mods) => mods > 0 && (mods & (mods - 1)) === 0;

/** Every single mod for the game and score edit dialogs: "Hidden (HD)", A to Z. */
export const modOptions: Option[] = Object.entries(ModsEnumHelper.metadata)
  .filter(([value, { text }]) => !!text && isSingleMod(Number(value)))
  .map(([value, { text, description }]) => ({
    label: description
      ? `${description.charAt(0).toUpperCase() + description.slice(1)} (${text})`
      : text,
    value,
  }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en-US'));

/**
 * The single mods set in `mods`, for the dialogs' Mods list. A group left in
 * the selection would keep its flags set after one of them is removed.
 */
export const selectedMods = (mods: number): string[] =>
  getEnumFlags(mods, Mods).filter(isSingleMod).map(String);
