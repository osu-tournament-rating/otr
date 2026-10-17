import { Fragment, type CSSProperties } from 'react';

import TapTooltip from '@/components/tap-tooltip';
import {
  FREEMOD_COLOR,
  FREEMOD_NAME,
  MOD_BADGES,
  MOD_TYPE_COLORS,
  formatModSpeed,
  getModBadgeEntries,
  getModEntryName,
  toLazerAcronym,
  getModGlyphColor,
  type ModBadge,
} from '@/lib/utils/mod-badges';
import type { Mods } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';
import { cn } from '@/lib/utils';

/**
 * Freemod is a lobby setting rather than a mod, so osu-web has no badge for
 * it. It gets osu-web's acronym badge in a colour of its own from osu-web's
 * palette, so it doesn't read as any mod type.
 */
const FREEMOD_BADGE: ModBadge = {
  name: FREEMOD_NAME,
  type: 'System',
  color: FREEMOD_COLOR,
};

/** The badge for an acronym, otr's legacy spelling or lazer's. */
function getModBadge(acronym: string): ModBadge {
  if (acronym === 'FM') return FREEMOD_BADGE;

  // osu-web draws a mod it does not know as an acronym in the Fun colour.
  return (
    MOD_BADGES[toLazerAcronym(acronym)] ?? {
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
  badge: { type, glyph, color },
}: {
  acronym: string;
  badge: ModBadge;
}) {
  const fill = color ?? MOD_TYPE_COLORS[type];
  const glyphColor = getModGlyphColor(fill);

  return (
    <>
      <span
        className="absolute inset-0"
        style={maskStyle(fill, '/icons/mods/blanks/mod-icon.svg')}
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
 * Lifts a badge's art 2px while its `group` trigger is hovered or focused,
 * with the default 150ms transition, and keeps it still for reduced motion.
 */
export const MOD_BADGE_LIFT =
  'absolute inset-0 transition-transform motion-safe:group-hover:-translate-y-0.5 motion-safe:group-focus-visible:-translate-y-0.5';

/**
 * One mod's badge; its height sets its size. Its full name, with a custom
 * `speed` such as `Double Time 1.2x`, opens in a tooltip on hover, tap and
 * keyboard focus. Without `tooltip`, it is a plain image named for assistive
 * tech, for places that write the name beside it.
 */
export function ModBadgeIcon({
  acronym,
  speed = null,
  className,
  tooltip = true,
}: {
  acronym: string;
  speed?: number | null;
  className?: string;
  tooltip?: boolean;
}) {
  const name = getModEntryName({ acronym, speed });
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

  // The art lifts, not the button, so the tooltip's anchor and the row's
  // layout stay still.
  return (
    <TapTooltip
      content={name}
      side="top"
      triggerAriaLabel={name}
      triggerClassName={cn('group w-auto rounded-none', sizing)}
    >
      <span className={MOD_BADGE_LIFT}>{art}</span>
    </TapTooltip>
  );
}

/**
 * A row of mod badges, side by side. No mods draws nothing. Pass a lazer
 * score's or game's `lazerMods` to draw them instead of the flags, with a
 * custom speed written after its badge.
 */
export default function ModIconset({
  mods,
  lazerMods,
  className,
  iconClassName,
  freemod = false,
}: {
  mods: Mods;
  lazerMods?: readonly LazerMod[] | null;
  className?: string;
  iconClassName?: string;
  freemod?: boolean;
}) {
  const entries = getModBadgeEntries(mods, lazerMods, freemod);
  if (entries.length === 0) return null;

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {entries.map(({ acronym, speed }) => (
        <Fragment key={acronym}>
          <ModBadgeIcon
            acronym={acronym}
            speed={speed}
            className={iconClassName}
          />
          {speed !== null && (
            // Named with the badge, so assistive tech hears it once.
            <span
              aria-hidden
              className="shrink-0 pr-0.5 text-xs font-semibold tabular-nums"
            >
              {formatModSpeed(speed)}
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
