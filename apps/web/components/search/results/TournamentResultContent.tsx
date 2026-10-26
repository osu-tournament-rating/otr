'use client';

import { Users } from 'lucide-react';

import { Badge } from '@/components/kit/status/Badge';
import { NotInRatings } from '@/components/kit/status/NotInRatings';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { formatLobbySize } from '@/lib/kit/format/fields';
import { getRejectionReasonTexts } from '@/lib/kit/status/reasons';
import type { TournamentSearchResult } from '@/lib/orpc/schema/search';
import { highlightMatch } from '@/lib/utils/search';

import { RulesetLabel } from './RulesetLabel';

interface TournamentResultContentProps {
  data: TournamentSearchResult;
  query: string;
}

export function TournamentResultContent({
  data,
  query,
}: TournamentResultContentProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <VerificationStatusIcon
        status={data.verificationStatus}
        rejectionReasons={getRejectionReasonTexts(
          'tournament',
          data.rejectionReason
        )}
        reviewer={data.verifiedByUsername}
        pendingRating={data.pendingRating}
        tooltip="hover"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="min-w-0 truncate font-medium">
          {highlightMatch(data.name, query)}
        </span>
        <NotInRatings status={data.verificationStatus} />
      </span>

      <span className="flex shrink-0 items-center gap-3 text-xs">
        {data.isLazer ? (
          <Badge variant="outline" size="sm">
            lazer
          </Badge>
        ) : null}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">Lobby size </span>
          {formatLobbySize(data.lobbySize)}
        </span>
        <RulesetLabel ruleset={data.ruleset} />
      </span>
    </div>
  );
}
