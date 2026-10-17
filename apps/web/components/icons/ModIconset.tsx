import type { CSSProperties } from 'react';

import { ModsEnumHelper } from '@/lib/enum-helpers';
import { FREEMOD_LABEL } from '@/lib/kit/format/mods';
import {
  MOD_BADGES,
  MOD_TYPE_COLORS,
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

function getBadge(acronym: string): ModBadge {
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
  // Mods without an acronym have no icon
  const acronyms = ModsEnumHelper.getMetadata(mods)
    .map(({ text }) => text)
    .filter((text) => text !== '');
  if (freemod) {
    acronyms.unshift('FM');
  }
  if (acronyms.length === 0) return null;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {acronyms.map((mod) => {
        const badge = getBadge(mod);

        return (
          <div
            key={mod}
            role="img"
            aria-label={badge.name}
            className={cn(
              '[container-type:size] relative aspect-[10/7] h-full max-h-12 shrink-0',
              iconClassName
            )}
          >
            <ModBadgeArt acronym={mod} badge={badge} />
          </div>
        );
      })}
    </div>
  );
}
