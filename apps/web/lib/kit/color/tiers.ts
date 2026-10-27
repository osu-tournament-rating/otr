import type { TierName } from '@/lib/utils/tierData';

import { themeColor, type ThemeColor } from './theme-color';

function tier(name: string): ThemeColor {
  return themeColor(`--tier-${name}`);
}

/**
 * Tier colors, one `--tier-*` token in globals.css per tier, for tier names
 * as text and tier rows in charts. Use the `text-tier-<name>` classes for
 * text and `.css` for chart fills.
 */
export const TIER_PALETTE: Readonly<Record<TierName, ThemeColor>> = {
  Bronze: tier('bronze'),
  Silver: tier('silver'),
  Gold: tier('gold'),
  Platinum: tier('platinum'),
  Emerald: tier('emerald'),
  Diamond: tier('diamond'),
  Master: tier('master'),
  Grandmaster: tier('grandmaster'),
  'Elite Grandmaster': tier('elite-grandmaster'),
};

/** Tailwind text classes for each tier, spelled out so Tailwind finds them. */
export const TIER_TEXT_CLASS: Readonly<Record<TierName, string>> = {
  Bronze: 'text-tier-bronze',
  Silver: 'text-tier-silver',
  Gold: 'text-tier-gold',
  Platinum: 'text-tier-platinum',
  Emerald: 'text-tier-emerald',
  Diamond: 'text-tier-diamond',
  Master: 'text-tier-master',
  Grandmaster: 'text-tier-grandmaster',
  'Elite Grandmaster': 'text-tier-elite-grandmaster',
};

export function getTierColor(tierName: TierName): string {
  return TIER_PALETTE[tierName].css;
}
