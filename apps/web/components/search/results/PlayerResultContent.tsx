'use client';

import TierIcon from '@/components/icons/TierIcon';
import { Badge } from '@/components/kit/status/Badge';
import TRText from '@/components/rating/TRText';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import { formatRank, formatRating } from '@/lib/kit/format/number';
import type { PlayerSearchResult } from '@/lib/orpc/schema/search';
import { highlightMatch } from '@/lib/utils/search';
import { TierName } from '@/lib/utils/tierData';

import { RulesetLabel } from './RulesetLabel';

interface PlayerResultContentProps {
  data: PlayerSearchResult;
  query: string;
}

export function PlayerResultContent({ data, query }: PlayerResultContentProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <OsuAvatar
        osuId={data.osuId}
        username={data.username}
        size={24}
        className="shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
        <span className="min-w-0 truncate font-medium">
          {highlightMatch(data.username ?? 'Unknown user', query)}
        </span>
        {data.matchedPreviousUsername ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            formerly {highlightMatch(data.matchedPreviousUsername, query)}
          </span>
        ) : null}
      </span>

      {data.isFriend ? <Badge size="sm">Friend</Badge> : null}

      <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
        {data.rating != null && data.tierProgress ? (
          <span className="flex items-center gap-1">
            <TierIcon
              tier={data.tierProgress.currentTier as TierName}
              subTier={data.tierProgress.currentSubTier ?? undefined}
              width={16}
              height={16}
            />
            <span className="flex items-baseline gap-0.5 font-medium">
              {formatRating(data.rating)}
              <TRText />
            </span>
          </span>
        ) : null}

        {data.globalRank ? (
          <span className="text-muted-foreground">
            <span className="sr-only">Global rank </span>
            {formatRank(data.globalRank)}
          </span>
        ) : null}

        {/* Without a rating, the ruleset is only the player's default, which
            is osu! for anyone with no verified tournaments or setting. */}
        {data.rating != null && data.ruleset != null ? (
          <RulesetLabel ruleset={data.ruleset} />
        ) : null}
      </span>
    </div>
  );
}
