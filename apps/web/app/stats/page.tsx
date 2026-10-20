import type { Metadata } from 'next';

import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageSection } from '@/components/kit/layout/PageSection';
import { BY_RULESET_SECTION } from '@/components/stats/chart-panels';
import OverviewPanel from '@/components/stats/OverviewPanel';
import RatingDistributionPanel from '@/components/stats/RatingDistributionPanel';
import RecentlyVerifiedPanel from '@/components/stats/RecentlyVerifiedPanel';
import StatsRulesetSwitch from '@/components/stats/StatsRulesetSwitch';
import TournamentsByLobbySizeChart from '@/components/stats/TournamentsByLobbySizeChart';
import TournamentsByRulesetChart from '@/components/stats/TournamentsByRulesetChart';
import TournamentsByYearChart from '@/components/stats/TournamentsByYearChart';
import TournamentVerificationChart from '@/components/stats/TournamentVerificationChart';
import { orpc } from '@/lib/orpc/orpc';

import { StatsPageHeader } from './StatsPageHeader';

export const metadata: Metadata = {
  title: 'Platform statistics',
  description: 'View platform-wide statistics and insights for o!TR',
};

export default async function StatsPage() {
  // A failure reaches the error screen; this page always exists.
  const [{ tournamentStats, ratingStats }, { allRulesets }] = await Promise.all(
    [orpc.stats.platform(), orpc.stats.page()]
  );

  return (
    <PageFrame>
      <StatsPageHeader />
      <OverviewPanel totals={allRulesets.totals} />
      {/* grid-cols-1 lets a panel shrink below its chart's measured width. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TournamentVerificationChart
          verificationCounts={tournamentStats.countByVerificationStatus}
          summary={allRulesets.verification}
        />
        <RecentlyVerifiedPanel firstPage={allRulesets.recentlyVerified} />
        <TournamentsByYearChart data={tournamentStats.verifiedByYear} />
        <TournamentsByRulesetChart data={tournamentStats.verifiedByRuleset} />
        <TournamentsByLobbySizeChart
          data={tournamentStats.verifiedByLobbySize}
        />
      </div>
      <PageSection {...BY_RULESET_SECTION} actions={<StatsRulesetSwitch />}>
        <RatingDistributionPanel
          ratingsByRuleset={ratingStats.ratingsByRuleset}
        />
      </PageSection>
    </PageFrame>
  );
}
