'use client';

import { ListChecks } from 'lucide-react';
import useSWR from 'swr';

import SectionError from '@/components/error/SectionError';
import { DateText } from '@/components/kit/format/DateText';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ApprovalStatusBadge } from '@/components/kit/status/ApprovalStatusBadge';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type { TournamentSubmissionSummary } from '@/lib/orpc/schema/tournamentSubmission';

export const MY_SUBMISSIONS_KEY = 'my-tournament-submissions';

/** The tournament's name, linked once approval made it a tournament. */
function SubmissionName({
  submission,
}: {
  submission: TournamentSubmissionSummary;
}) {
  return submission.tournamentId ? (
    <EntityLink href={`/tournaments/${submission.tournamentId}`}>
      {submission.name}
    </EntityLink>
  ) : (
    <span className="truncate font-medium">{submission.name}</span>
  );
}

/**
 * The signed-in user's held tournament submissions, newest first, under the
 * submission form: each one's state, and a link to the tournament once an
 * admin approves it. Admins' submissions are never held, so for them, and
 * for anyone who has submitted nothing, it renders nothing.
 */
export default function MyTournamentSubmissions() {
  const { data, error, isValidating, mutate } = useSWR(
    MY_SUBMISSIONS_KEY,
    () => orpc.tournaments.mySubmissions({}),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (!data && error) {
    return (
      <Panel>
        <SectionHeader icon={ListChecks} title="Your submissions" />
        <SectionError
          title="Your submissions could not load"
          retrying={isValidating}
          onRetry={() => void mutate()}
        />
      </Panel>
    );
  }

  const submissions = data?.submissions ?? [];

  if (submissions.length === 0) {
    return null;
  }

  return (
    <Panel data-testid="my-tournament-submissions">
      <SectionHeader
        icon={ListChecks}
        title="Your submissions"
        meta={formatCountOf(submissions.length, 'submission')}
      />
      <DataTable
        fixed
        aria-label="Your submissions"
        phoneRows={
          <PhoneRowList aria-label="Your submissions">
            {submissions.map((submission) => (
              <PhoneRow
                key={submission.id}
                title={<SubmissionName submission={submission} />}
                description={
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ApprovalStatusBadge status={submission.status} size="sm" />
                    <DateText date={submission.created} />
                  </span>
                }
                value={formatCountOf(submission.matchCount, 'match', 'matches')}
              />
            ))}
          </PhoneRowList>
        }
      >
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead>Tournament</DataTableHead>
            <DataTableHead className="w-32">Status</DataTableHead>
            <DataTableHead className="w-24" numeric>
              Matches
            </DataTableHead>
            <DataTableHead className="w-32">Submitted</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {submissions.map((submission) => (
            <DataTableRow key={submission.id}>
              <DataTableCell>
                <span className="flex min-w-0 flex-col">
                  <SubmissionName submission={submission} />
                  <span className="truncate text-xs text-muted-foreground">
                    {submission.abbreviation}
                  </span>
                </span>
              </DataTableCell>
              <DataTableCell>
                <ApprovalStatusBadge status={submission.status} size="sm" />
              </DataTableCell>
              <DataTableCell numeric>
                {formatCount(submission.matchCount)}
              </DataTableCell>
              <DataTableCell muted>
                <DateText date={submission.created} />
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </Panel>
  );
}
