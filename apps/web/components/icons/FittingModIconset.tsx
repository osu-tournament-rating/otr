'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { Mods } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import { MOD_BADGE_LIFT, ModBadgeIcon } from '@/components/icons/ModIconset';
import TapTooltip from '@/components/tap-tooltip';
import {
  countModBadgeSlots,
  fitModBadges,
  getModBadgeEntries,
  getModEntryName,
  type ModBadgeEntry,
} from '@/lib/utils/mod-badges';
import { cn } from '@/lib/utils';

/** The gap between badges, `gap-0.5`. */
const BADGE_GAP_PX = 2;

/** A badge-shaped "+N" chip that lists the mods it stands for. */
function HiddenModsChip({ entries }: { entries: ModBadgeEntry[] }) {
  const acronyms = entries.map(({ acronym }) => acronym);
  const names = entries.map(getModEntryName);

  return (
    <TapTooltip
      side="top"
      triggerAriaLabel={`${acronyms.length} more ${acronyms.length === 1 ? 'mod' : 'mods'}: ${names.join(', ')}`}
      triggerClassName="group [container-type:size] relative aspect-[10/7] h-full w-auto shrink-0 rounded-none"
      content={
        <ul className="flex flex-col gap-1">
          {acronyms.map((acronym, index) => (
            <li key={acronym} className="flex items-center gap-2">
              {/* A tooltip can't hold tooltips: the name sits beside it. */}
              <ModBadgeIcon
                acronym={acronym}
                speed={entries[index].speed}
                tooltip={false}
                className="h-4"
              />
              {names[index]}
            </li>
          ))}
        </ul>
      }
    >
      <span className={MOD_BADGE_LIFT}>
        <span
          aria-hidden
          className="absolute inset-0 bg-muted-foreground"
          style={{
            maskImage: 'url(/icons/mods/blanks/mod-icon.svg)',
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
          }}
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-[length:max(40cqh,0.75rem)] leading-none font-black text-background"
        >
          +{acronyms.length}
        </span>
      </span>
    </TapTooltip>
  );
}

/**
 * A mod row that never wraps: it shows as many badges as its width holds and
 * folds the rest into a "+N" chip. Give it a height and a width, such as
 * `h-5 flex-1`; the badges keep their order and pack to the end. Lazer mods
 * draw as `ModIconset` draws them, with a custom speed in the badge's name
 * only, so every badge keeps one slot.
 */
export default function FittingModIconset({
  mods,
  lazerMods,
  className,
}: {
  mods: Mods;
  lazerMods?: readonly LazerMod[] | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<number | null>(null);
  const entries = getModBadgeEntries(mods, lazerMods);

  // Measured before the first client paint, so the row never shows a cut.
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;

    const measure = () =>
      setSlots(
        countModBadgeSlots(row.clientWidth, row.clientHeight, BADGE_GAP_PX)
      );
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // The server can't measure: it sends every badge, clipped at the row's end.
  const { shown } =
    slots === null
      ? { shown: entries.length }
      : fitModBadges(entries.length, slots);
  const hidden = entries.slice(shown);

  return (
    <div
      ref={ref}
      className={cn(
        // Clipped sideways only, so a lifted badge keeps its top.
        'flex min-w-0 [justify-content:safe_flex-end] overflow-x-clip',
        className
      )}
    >
      <div className="flex h-full items-center gap-0.5">
        {entries.slice(0, shown).map(({ acronym, speed }) => (
          <ModBadgeIcon key={acronym} acronym={acronym} speed={speed} />
        ))}
        {hidden.length > 0 && <HiddenModsChip entries={hidden} />}
      </div>
    </div>
  );
}
