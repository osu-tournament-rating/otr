import type { Ruleset } from '@otr/core/osu';
import {
  Crosshair,
  Gamepad2,
  Medal,
  Swords,
  TrendingUp,
  Users,
} from 'lucide-react';

import TierIcon from '@/components/icons/TierIcon';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import type { KitIcon } from '@/lib/kit/layout/icon';
import { formatTierName } from '@/lib/kit/format/tier';

import {
  type HighlightIcon,
  type HighlightStat,
  playerProfileHref,
} from './MatchStatsUtils';

const ICONS: Record<HighlightIcon, KitIcon> = {
  Swords,
  Users,
  Gamepad2,
  TrendingUp,
  Medal,
  Crosshair,
};

/** The line under a highlight's value: the player, the tier or a note. */
function HighlightSub({
  stat,
  ruleset,
}: {
  stat: HighlightStat;
  ruleset?: Ruleset;
}) {
  if (stat.player) {
    return (
      <EntityLink
        href={playerProfileHref(stat.player.id, ruleset)}
        leading={
          <OsuAvatar
            osuId={stat.player.osuId}
            username={stat.player.username}
            size={16}
          />
        }
        className="gap-1.5"
        wrap
      >
        {stat.player.username}
      </EntityLink>
    );
  }

  if (stat.tierIcon) {
    return formatTierName(stat.tierIcon.tier, stat.tierIcon.subTier);
  }

  return stat.sublabel ?? null;
}

/**
 * The match's headline numbers as stat tiles: the result, players, rated
 * games, average rating with its tier, and the best match cost and accuracy
 * with the player behind each.
 */
export default function MatchStatsHighlights({
  stats,
  ruleset,
}: {
  stats: readonly HighlightStat[];
  /** The match's ruleset, which the players' links open. */
  ruleset?: Ruleset;
}) {
  return (
    <StatTileGrid columns={3}>
      {stats.map((stat) => (
        <StatTile
          key={stat.id}
          data-testid={`match-stat-${stat.id}`}
          icon={ICONS[stat.icon]}
          label={stat.label}
          infoText={stat.helpText}
          value={
            stat.metric ? (
              <>
                {stat.value}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {stat.metric}
                </span>
              </>
            ) : (
              stat.value
            )
          }
          adornment={
            stat.tierIcon ? (
              <TierIcon
                tier={stat.tierIcon.tier}
                subTier={stat.tierIcon.subTier}
                width={22}
                height={22}
              />
            ) : undefined
          }
          sub={
            stat.player || stat.tierIcon || stat.sublabel ? (
              <HighlightSub stat={stat} ruleset={ruleset} />
            ) : undefined
          }
        />
      ))}
    </StatTileGrid>
  );
}
