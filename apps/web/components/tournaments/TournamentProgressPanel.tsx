'use client';

import { Activity, ListChecks, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/kit/controls/Button';
import { IconButton } from '@/components/kit/controls/IconButton';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { JobStateBadge } from '@/components/kit/status/JobStateBadge';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { Progress } from '@/components/ui/progress';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { formatCount } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type {
  FetchProgress,
  ProgressIssue,
  TournamentProgress,
} from '@/lib/orpc/schema/tournamentProgress';
import {
  CHECKS_WAITING_LINE,
  describeFetchProgress,
  describeIssueSubject,
  fetchedPercent,
  jobStageBadge,
} from '@/lib/tournaments/progress';

/** How often the panel asks again while anything is in flight. */
const REFRESH_MS = 5_000;

/**
 * How far a tournament's data has come: its matches and beatmaps being
 * fetched, then its automated checks and stats. It shows while anything is
 * in flight and updates itself until nothing is left, then reloads the page
 * so the fetched data shows. Admins also see what is retrying, failed or
 * stalled, with the error, for as long as it needs attention.
 */
export default function TournamentProgressPanel({
  tournamentId,
  initialProgress,
}: {
  tournamentId: number;
  /** From the page's render; null when it could not load. */
  initialProgress: TournamentProgress | null;
}) {
  const router = useRouter();
  const session = useSession();
  const isAdmin = hasAdminScope(session?.scopes ?? []);

  const { data, mutate } = useSWR(
    ['tournament-progress', tournamentId],
    () => orpc.tournaments.progress({ id: tournamentId }),
    {
      fallbackData: initialProgress ?? undefined,
      // SWR reads the cache, which holds no fallback until the first fetch.
      refreshInterval: (latest) =>
        (latest ?? initialProgress)?.inFlight ? REFRESH_MS : 0,
      revalidateOnMount: false,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  // Each render of the page brings fresh progress, such as the refresh after
  // an admin queues a refetch. It replaces what the cache held, which may be
  // from before the work was queued, so the panel shows it and polls again.
  useEffect(() => {
    if (initialProgress) {
      void mutate(initialProgress, { revalidate: false });
    }
  }, [initialProgress, mutate]);

  // Once seen in flight, the panel stays until the page is left, so its
  // finished state shows instead of the panel vanishing.
  const [seenInFlight, setSeenInFlight] = useState(
    initialProgress?.inFlight ?? false
  );
  if (data?.inFlight && !seenInFlight) {
    setSeenInFlight(true);
  }

  // Reload the page's data when the matches finish and when everything does.
  const previous = useRef(data);
  useEffect(() => {
    const before = previous.current;
    previous.current = data;
    if (!before || !data) return;

    const matchesFinished =
      before.matches.inFlight > 0 && data.matches.inFlight === 0;
    const allFinished = before.inFlight && !data.inFlight;
    if (matchesFinished || allFinished) {
      router.refresh();
    }
  }, [data, router]);

  if (!data) return null;

  const issues = isAdmin ? (data.issues ?? []) : [];
  const issueCount = isAdmin ? (data.issueCount ?? 0) : 0;
  if (!data.inFlight && !seenInFlight && issueCount === 0) {
    return null;
  }

  const jobsHref = `/admin/jobs?tournament=${tournamentId}`;

  return (
    <Panel data-testid="tournament-progress">
      <SectionHeader
        icon={Activity}
        title="Processing"
        meta={data.inFlight ? 'Updates live' : 'Done'}
        actions={
          isAdmin ? (
            <>
              {/* A phone's strip has room for the icon only. */}
              <IconButton
                asChild
                variant="outline"
                label="View jobs"
                icon={ListChecks}
                className="sm:hidden"
              >
                <Link href={jobsHref} />
              </IconButton>
              <Button
                asChild
                variant="outline"
                size="sm"
                icon={ListChecks}
                className="hidden sm:inline-flex"
              >
                <Link href={jobsHref}>View jobs</Link>
              </Button>
            </>
          ) : null
        }
      />
      <RowList>
        <FetchRow label="Matches" progress={data.matches} />
        <FetchRow label="Beatmaps" progress={data.beatmaps} />
        <JobStageRow label="Automated checks" state={data.checks} />
        <JobStageRow label="Stats" state={data.stats} />
      </RowList>
      {issueCount > 0 ? (
        <IssueList issues={issues} issueCount={issueCount} />
      ) : null}
    </Panel>
  );
}

function FetchRow({
  label,
  progress,
}: {
  label: string;
  progress: FetchProgress;
}) {
  const line = describeFetchProgress(progress);
  if (!line) return null;

  return (
    <RowListItem
      title={label}
      description={line}
      trailing={
        <Progress
          value={fetchedPercent(progress)}
          aria-label={`${label} fetched`}
          className="h-2 w-24 sm:w-40"
        />
      }
    />
  );
}

/** A stage run by one job; left out when no job has run for it lately. */
function JobStageRow({
  label,
  state,
}: {
  label: string;
  state: TournamentProgress['checks'];
}) {
  if (state === 'none') return null;
  const badge = jobStageBadge(state);

  return (
    <RowListItem
      title={label}
      description={state === 'waiting' ? CHECKS_WAITING_LINE : undefined}
      trailing={badge ? <JobStateBadge state={badge} /> : null}
    />
  );
}

function IssueList({
  issues,
  issueCount,
}: {
  issues: ProgressIssue[];
  issueCount: number;
}) {
  return (
    <section aria-label="Needs attention" className="border-t">
      <SectionHeader
        level={3}
        icon={TriangleAlert}
        title="Needs attention"
        meta={
          issueCount > issues.length
            ? `${formatCount(issues.length)} of ${formatCount(issueCount)} shown`
            : formatCount(issueCount)
        }
      />
      <RowList>
        {issues.map((issue) => (
          <IssueRow
            key={`${issue.kind}:${issue.entityId ?? issue.jobId}`}
            issue={issue}
          />
        ))}
      </RowList>
    </section>
  );
}

function IssueRow({ issue }: { issue: ProgressIssue }) {
  const subject = describeIssueSubject(issue);
  const attempts =
    issue.attempts !== null && issue.maxAttempts !== null
      ? `attempt ${formatCount(issue.attempts)} of ${formatCount(issue.maxAttempts)}`
      : null;

  return (
    <RowListItem
      title={
        subject.href ? (
          <EntityLink href={subject.href}>{subject.title}</EntityLink>
        ) : (
          subject.title
        )
      }
      description={
        <span className="flex flex-col gap-0.5">
          <span className="wrap-anywhere">
            {issue.state === 'stalled'
              ? 'Waiting to be fetched with no job queued'
              : (issue.error ?? 'No error kept')}
          </span>
          {attempts || issue.nextAttempt ? (
            <span className="text-xs">
              {attempts}
              {attempts && issue.nextAttempt ? ' · ' : null}
              {issue.nextAttempt ? (
                <>
                  next at <Timestamp date={issue.nextAttempt} />
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      }
      trailing={<JobStateBadge state={issue.state} />}
    />
  );
}
