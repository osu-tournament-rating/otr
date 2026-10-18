import { ArrowRight, GitMerge } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/kit/controls/Button';
import { StatusPage } from '@/components/kit/feedback/StatusPage';
import type { MatchMergeLookup } from '@/lib/orpc/schema/match';

import { getMatchDisplayName } from './matchName';

/**
 * The page of a match that was merged into another, in place of the match
 * page: the match is gone, so it points at the match that holds its games.
 */
export default function MergedMatchStatus({
  merge,
}: {
  merge: MatchMergeLookup;
}) {
  return (
    <StatusPage
      icon={GitMerge}
      title="Match merged"
      description={`This match was merged into ${getMatchDisplayName(merge.match)}.`}
      action={
        <Button asChild icon={ArrowRight}>
          <Link href={`/matches/${merge.match.id}`}>View match</Link>
        </Button>
      }
      data-testid="merged-match-status"
    />
  );
}
