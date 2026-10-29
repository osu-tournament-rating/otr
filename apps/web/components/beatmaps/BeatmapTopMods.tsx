import { Layers } from 'lucide-react';

import { ModBadgeIcon } from '@/components/icons/ModIconset';
import { Badge } from '@/components/kit/status/Badge';
import { formatPercent } from '@/lib/kit/format/number';
import type { BeatmapListItem } from '@/lib/orpc/schema/beatmapList';
import { cn } from '@/lib/utils';
import { getModBadgeAcronyms, getModName } from '@/lib/utils/mod-badges';
import {
  BEATMAP_MOD_OTHER_LABEL,
  selectBeatmapListModGroups,
} from '@/lib/utils/mods';

type TopMod = NonNullable<BeatmapListItem['topMods']>[number];

/**
 * A share of scores as a whole percent. A share that rounds to 0% or 100%
 * without being either reads `<1%` or `>99%`, so the pill never claims no
 * scores or every score.
 */
function formatModShare(percentage: number): string {
  if (percentage > 0 && percentage < 0.5) return '<1%';
  if (percentage < 100 && percentage >= 99.5) return '>99%';
  return formatPercent(percentage / 100, { decimals: 0 });
}

/** osu-web's acronym for its No Mod badge. */
const NO_MOD_ACRONYM = 'NM';

/**
 * What a pill shows and its name: osu!'s mod badges, osu!'s No Mod badge
 * when there are none, or a text label for "Other", which has no badge.
 */
function describeTopMod({ mod, mods }: TopMod) {
  if (mod === BEATMAP_MOD_OTHER_LABEL) {
    return { label: mod, acronyms: [], name: 'Other mods' };
  }

  const acronyms = getModBadgeAcronyms(mods);
  if (acronyms.length === 0) {
    return {
      label: null,
      acronyms: [NO_MOD_ACRONYM],
      name: getModName(NO_MOD_ACRONYM),
    };
  }

  return {
    label: null,
    acronyms,
    name: acronyms.map(getModName).join(' + '),
  };
}

/** The mod pills summarizing which mods a beatmap's scores were set under. */
export default function BeatmapTopMods({
  mods,
  fixedWidth = false,
  showIcon = true,
  maxBadges,
}: {
  mods: NonNullable<BeatmapListItem['topMods']>;
  /** Reserve a fixed slot so mods line up across compact-layout rows. */
  fixedWidth?: boolean;
  /** Drop the leading glyph where a neighboring column already carries numbers. */
  showIcon?: boolean;
  /** The most badges a pill draws; the rest fold into a "+N" count. */
  maxBadges?: number;
}) {
  if (mods.length === 0) {
    return (
      <div
        data-testid="beatmap-mods-summary"
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap',
          fixedWidth && 'w-52'
        )}
      >
        {showIcon ? (
          <Layers className="size-4 shrink-0" aria-hidden="true" />
        ) : null}
        <span className="text-xs">No mod data</span>
      </div>
    );
  }

  const displayedMods = selectBeatmapListModGroups(mods);

  return (
    <div
      data-testid="beatmap-mods-summary"
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5',
        fixedWidth && 'w-52'
      )}
    >
      {showIcon ? (
        <Layers className="size-4 shrink-0" aria-hidden="true" />
      ) : null}
      <ul
        data-testid="beatmap-top-mods"
        aria-label="Top mods by score usage"
        // One pill tall: a pill that doesn't fit whole wraps out of sight
        // rather than showing with its share cut off.
        className="flex h-6 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden"
      >
        {displayedMods.map((topMod) => {
          const { label, acronyms, name } = describeTopMod(topMod);
          const share = formatModShare(topMod.percentage);
          const shown = acronyms.slice(0, maxBadges);
          const folded = acronyms.length - shown.length;

          return (
            <li
              key={`${topMod.mods}-${topMod.mod}`}
              data-testid="beatmap-mod-group"
              className="flex"
            >
              <Badge className={cn(label === null && 'border-0 pl-0')}>
                <span
                  aria-hidden="true"
                  className="flex h-full items-center gap-1.5"
                >
                  {label !== null ? (
                    <span className="font-semibold">{label}</span>
                  ) : (
                    <span className="flex h-full gap-0.5">
                      {shown.map((acronym, index) => (
                        <ModBadgeIcon
                          key={acronym}
                          acronym={acronym}
                          fillStart={index === 0}
                          className="h-full"
                        />
                      ))}
                    </span>
                  )}
                  {folded > 0 && (
                    <span className="font-semibold">{`+${folded}`}</span>
                  )}
                  <span className="tabular-nums">{share}</span>
                </span>
                <span className="sr-only">{`${name} ${share}`}</span>
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
