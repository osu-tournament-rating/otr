import type { Ruleset } from '@otr/core/osu';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { IconButton } from '@/components/kit/controls/IconButton';
import { CountryName } from '@/components/kit/country/CountryFlag';
import { DetailHero } from '@/components/kit/layout/DetailHero';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import { getCountryName } from '@/lib/kit/format/country';
import { parseListState } from '@/lib/kit/lists/params';
import type { PlayerCompact } from '@/lib/orpc/schema/playerStats';

import PlayerRulesetSwitch from './PlayerRulesetSwitch';
import {
  LEADERBOARD_LIST_PARAMS,
  leaderboardHref,
} from '@/app/leaderboard/list-params';

/**
 * The top of a player's profile: avatar, name, country (a link to that
 * country's leaderboard), the osu! profile link, and the ruleset the page
 * shows.
 */
export default function PlayerHero({
  player,
  ruleset,
}: {
  player: PlayerCompact;
  ruleset: Ruleset;
}) {
  return (
    <DetailHero
      data-testid="player-card"
      leading={
        <OsuAvatar
          data-testid="player-avatar"
          osuId={player.osuId}
          username={player.username}
          size={64}
          className="bg-accent"
        />
      }
      title={<span data-testid="player-username">{player.username}</span>}
      meta={
        player.country ? (
          <Link
            // Always names the ruleset, osu! included, so the visitor's
            // browsing ruleset never replaces the one this profile shows.
            href={leaderboardHref(parseListState(LEADERBOARD_LIST_PARAMS, {}), {
              country: player.country,
              ruleset,
            })}
            aria-label={`${getCountryName(player.country)} leaderboard`}
            className="inline-flex min-w-0 rounded-sm transition-colors outline-none hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <CountryName code={player.country} />
          </Link>
        ) : null
      }
      actions={
        <IconButton
          asChild
          variant="outline"
          icon={ExternalLink}
          label="View on osu!"
        >
          <a
            href={`https://osu.ppy.sh/u/${player.osuId}`}
            target="_blank"
            rel="noopener noreferrer"
          />
        </IconButton>
      }
    >
      <div className="px-4 py-3 sm:px-6">
        <PlayerRulesetSwitch ruleset={ruleset} />
      </div>
    </DetailHero>
  );
}
