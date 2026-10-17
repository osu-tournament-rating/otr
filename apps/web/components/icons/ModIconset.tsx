import type { CSSProperties } from 'react';

import { FREEMOD_LABEL } from '@/lib/kit/format/mods';
import TapTooltip from '@/components/tap-tooltip';
import {
  MOD_BADGES,
  MOD_TYPE_COLORS,
  getModBadgeAcronyms,
  getModName,
  getModGlyphColor,
  type ModBadge,
} from '@/lib/utils/mod-badges';
import type { Mods } from '@otr/core/osu';
import { cn } from '@/lib/utils';

/** Legacy acronyms that lazer, and so osu-web, spells differently. */
const LAZER_ACRONYMS: Readonly<Record<string, string>> = {
  CM: 'CN',
  V2: 'SV2',
};

/**
 * Freemod is a lobby setting rather than a mod, so osu-web has no badge for
 * it. It gets osu-web's acronym badge in the System colour, the type osu-web
 * gives other settings such as Score V2 and No Mod.
 */
const FREEMOD_BADGE: ModBadge = { name: FREEMOD_LABEL, type: 'System' };

/** The badge for an acronym, otr's legacy spelling or lazer's. */
function getModBadge(acronym: string): ModBadge {
  if (acronym === 'FM') return FREEMOD_BADGE;

  // osu-web draws a mod it does not know as an acronym in the Fun colour.
  return (
    MOD_BADGES[LAZER_ACRONYMS[acronym] ?? acronym] ?? {
      name: acronym,
      type: 'Fun',
    }
  );
}

/** Fills the badge with a colour, cut to the shape of an SVG. */
function maskStyle(color: string, src: string): CSSProperties {
  return {
    backgroundColor: color,
    maskImage: `url(${src})`,
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
  };
}

/** The badge's fill and its glyph, or its acronym when it has no glyph. */
function ModBadgeArt({
  acronym,
  badge: { type, glyph },
}: {
  acronym: string;
  badge: ModBadge;
}) {
  const glyphColor = getModGlyphColor(type);

  return (
    <>
      <span
        className="absolute inset-0"
        style={maskStyle(
          MOD_TYPE_COLORS[type],
          '/icons/mods/blanks/mod-icon.svg'
        )}
      />
      {glyph ? (
        <span
          className="absolute inset-0"
          style={maskStyle(glyphColor, `/icons/mods/mod-${glyph}.svg`)}
        />
      ) : (
        <span
          className="absolute inset-0 flex items-center justify-center text-[length:max(40cqh,0.75rem)] leading-none font-black"
          style={{ color: glyphColor }}
        >
          {acronym}
        </span>
      )}
    </>
  );
}

/**
 * One mod's badge; its height sets its size. Its full name opens in a tooltip
 * on hover, tap and keyboard focus. Without `tooltip`, it is a plain image
 * named for assistive tech, for places that write the name beside it.
 */
export function ModBadgeIcon({
  acronym,
  className,
  tooltip = true,
}: {
  acronym: string;
  className?: string;
  tooltip?: boolean;
}) {
  const name = getModName(acronym);
  const sizing = cn(
    '[container-type:size] relative aspect-[10/7] h-full max-h-12 shrink-0',
    className
  );
  const art = <ModBadgeArt acronym={acronym} badge={getModBadge(acronym)} />;

  if (!tooltip) {
    return (
      <div role="img" aria-label={name} className={sizing}>
        {art}
      </div>
    );
  }

  return (
    <TapTooltip
      content={name}
      side="top"
      triggerAriaLabel={name}
      triggerClassName={cn('w-auto rounded-none', sizing)}
    >
      {art}
    </TapTooltip>
  );
}

/** A row of mod badges, side by side. No mods draws nothing. */
export default function ModIconset({
  mods,
  className,
  iconClassName,
  freemod = false,
}: {
  mods: Mods;
  className?: string;
  iconClassName?: string;
  freemod?: boolean;
}) {
  const acronyms = getModBadgeAcronyms(mods, freemod);
  if (acronyms.length === 0) return null;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {acronyms.map((mod) => (
        <ModBadgeIcon key={mod} acronym={mod} className={iconClassName} />
      ))}
    </div>
  );
}
