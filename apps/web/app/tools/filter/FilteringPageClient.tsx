'use client';

import { useState } from 'react';
import { Clock, Filter } from 'lucide-react';

import { Callout } from '@/components/kit/feedback/Callout';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import FilteringForm from '@/components/filtering/FilteringForm';
import { API_REQUESTS_PER_MINUTE } from '@/lib/api/api-allowance';
import { formatCount } from '@/lib/kit/format/number';
import {
  FILTER_REPORTS_PER_DAY,
  FLAGGED_UNKNOWN_PERCENT,
  MAX_FILTER_PLAYER_IDS,
  type FilteringResult,
} from '@/lib/orpc/schema/filtering';

const FILTERING_RULES_URL =
  'https://osu.ppy.sh/wiki/en/Tournaments/Official_support#registrant-filtering-and-seeding';

type FilteringPageClientProps = {
  filterBlocked: boolean;
};

/** The rules a host agrees to before filtering, above the form. */
function HostComplianceCallout() {
  return (
    <Callout
      tone="warning"
      title="Host compliance"
      data-testid="filtering-compliance"
    >
      <p>
        Hosts must comply with the{' '}
        <a href={FILTERING_RULES_URL}>
          official tournament support filtering rules
        </a>
        :
      </p>
      <ol className="mt-2 ml-4 list-decimal space-y-1">
        <li>
          Receive <strong className="font-semibold">written permission</strong>{' '}
          from osu! support by contacting{' '}
          <a href="mailto:tournaments@ppy.sh">tournaments@ppy.sh</a> via email
          before using this tool in officially-supported tournaments.
        </li>
        <li>
          After creating a filter report, hosts must copy the provided forum
          post text exactly as-is and include it in their tournament forum post.
          Do not modify the filtering result.
        </li>
      </ol>
    </Callout>
  );
}

/** What a user may filter: reports a day, players a report, lookups and approval. */
function FilterLimitsCallout() {
  return (
    <Callout title="Limits" data-testid="filtering-limits">
      <ul className="ml-4 list-disc space-y-1">
        <li>
          You can create {FILTER_REPORTS_PER_DAY} filter reports a day, with up
          to {formatCount(MAX_FILTER_PLAYER_IDS)} osu! player IDs each.
        </li>
        <li>
          o!TR looks up each player it doesn&apos;t have yet on osu!. Each
          lookup counts against your API rate limit of {API_REQUESTS_PER_MINUTE}{' '}
          requests a minute. If a report needs more than a minute&apos;s worth,
          your API calls wait until the limit refills.
        </li>
        <li>
          If more than {FLAGGED_UNKNOWN_PERCENT}% of the players aren&apos;t in
          o!TR yet, you&apos;ll be asked why, and an admin reviews the request
          before it runs.
        </li>
      </ul>
    </Callout>
  );
}

/**
 * The registrant filter: the host compliance rules and the limits, then the
 * form and its results. During the weekly rating run the page shows only the outage
 * notice, in the compliance rules' place: there is nothing to comply with
 * while the tool is off.
 */
export default function FilteringPageClient({
  filterBlocked,
}: FilteringPageClientProps) {
  const [filteringResults, setFilteringResults] =
    useState<FilteringResult | null>(null);

  return (
    <PageFrame>
      <PageHeader
        icon={Filter}
        title="Tournament registrant filtering"
        description="Filter your tournament registrants based on rating eligibility criteria."
      />
      {filterBlocked ? (
        <Callout
          tone="warning"
          icon={Clock}
          title="Filtering is temporarily unavailable"
          data-testid="filtering-unavailable"
        >
          Ratings are currently recalculating, please check back later.
        </Callout>
      ) : (
        <>
          <HostComplianceCallout />
          <FilterLimitsCallout />
          <FilteringForm
            onFilteringComplete={setFilteringResults}
            filteringResults={filteringResults}
          />
        </>
      )}
    </PageFrame>
  );
}
