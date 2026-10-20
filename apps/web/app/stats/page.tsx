import type { Metadata } from 'next';

import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageSection } from '@/components/kit/layout/PageSection';
import { BY_RULESET_SECTION } from '@/components/stats/chart-panels';
import {
  PlayersByCountryPanel,
  TopPlayersByCountryPanel,
} from '@/components/stats/CountryPanels';
import LazerSharePanel from '@/components/stats/LazerSharePanel';
import { BiggestUpsetsPanel } from '@/components/stats/MatchRecordPanels';
import OverviewPanel from '@/components/stats/OverviewPanel';
import RankRestrictionsPanel from '@/components/stats/RankRestrictionsPanel';
import RatingDistributionPanel from '@/components/stats/RatingDistributionPanel';
import RecentlyVerifiedPanel from '@/components/stats/RecentlyVerifiedPanel';
import { RulesetStatsProvider } from '@/components/stats/ruleset-stats';
import StatsRulesetSwitch from '@/components/stats/StatsRulesetSwitch';
import TournamentsByLobbySizeChart from '@/components/stats/TournamentsByLobbySizeChart';
import TournamentsByRulesetChart from '@/components/stats/TournamentsByRulesetChart';
import TournamentsByYearChart from '@/components/stats/TournamentsByYearChart';
import TournamentVerificationChart from '@/components/stats/TournamentVerificationChart';
import { getCountryNames } from '@/lib/kit/format/country';
import { orpc } from '@/lib/orpc/orpc';

import { StatsPageHeader } from './StatsPageHeader';

export const metadata: Metadata = {
  title: 'Platform statistics',
  description: 'View platform-wide statistics and insights for o!TR',
};

export default async function StatsPage() {
  // A failure reaches the error screen; this page always exists.
  const [{ tournamentStats, ratingStats }, { allRulesets, byRuleset }] =
    await Promise.all([orpc.stats.platform(), orpc.stats.page()]);

  const countryNames = getCountryNames(
    byRuleset.flatMap((entry) =>
      [
        ...entry.playersByCountry.countries,
        ...entry.topPlayersByCountry.countries,
      ].map((row) => row.country)
    )
  );
  const currentYear = new Date().getUTCFullYear();

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
        <LazerSharePanel
          rows={allRulesets.lazerByYear}
          currentYear={currentYear}
        />
        <TournamentsByRulesetChart data={tournamentStats.verifiedByRuleset} />
        <TournamentsByLobbySizeChart
          data={tournamentStats.verifiedByLobbySize}
        />
      </div>
      <RulesetStatsProvider byRuleset={byRuleset} countryNames={countryNames}>
        <PageSection {...BY_RULESET_SECTION} actions={<StatsRulesetSwitch />}>
          <RatingDistributionPanel
            ratingsByRuleset={ratingStats.ratingsByRuleset}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PlayersByCountryPanel />
            <TopPlayersByCountryPanel />
          </div>
          <RankRestrictionsPanel currentYear={currentYear} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BiggestUpsetsPanel />
          </div>
        </PageSection>
      </RulesetStatsProvider>
    </PageFrame>
  );
}
