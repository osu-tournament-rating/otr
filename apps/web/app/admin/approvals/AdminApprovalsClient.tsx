'use client';

import { Check, Filter, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import {
  FilterRequestDetails,
  SubmissionDetails,
} from '@/components/approvals/ApprovalDetails';
import SectionError from '@/components/error/SectionError';
import { formatUnknownShare } from '@/components/filtering/unknownShare';
import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { SkeletonText } from '@/components/kit/feedback/Skeletons';
import { DateText } from '@/components/kit/format/DateText';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { ViewButton } from '@/components/kit/tables/ViewButton';
import { notifyApprovalChange } from '@/lib/hooks/usePendingApprovalCount';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type { AdminFilterRequest } from '@/lib/orpc/schema/filtering';
import type { AdminTournamentSubmission } from '@/lib/orpc/schema/tournamentSubmission';

import { ReportUserName } from '../reports/AdminReportDialog';
import {
  ApprovalTableSkeleton,
  FILTER_REQUEST_COLUMNS,
  SUBMISSION_COLUMNS,
} from './AdminApprovalsFrame';

type Decision = 'approve' | 'deny';

/** An action's error as the admin should read it. */
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * The approval queue: every tournament submission and filter request waiting
 * for an admin, oldest first. Each row opens from a labelled View button into
 * its dialog, where the admin reads it and approves or denies it.
 */
export default function AdminApprovalsClient() {
  return (
    <>
      <SubmissionQueue />
      <FilterRequestQueue />
    </>
  );
}

function SubmissionQueue() {
  const { data, error, isValidating, mutate } = useSWR(
    'admin-tournament-submissions',
    () => orpc.tournaments.admin.submissions({}),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const [selected, setSelected] = useState<AdminTournamentSubmission | null>(
    null
  );
  const [open, setOpen] = useState(false);
  const submissions = data?.submissions ?? [];

  const openSubmission = (submission: AdminTournamentSubmission) => {
    setSelected(submission);
    setOpen(true);
  };

  const decide = async (decision: Decision) => {
    if (!selected) return;

    if (decision === 'approve') {
      const { tournamentId } = await orpc.tournaments.admin.approveSubmission({
        id: selected.id,
      });
      toast.success(
        <div className="flex flex-col gap-1">
          <span>Tournament approved</span>
          <Link
            className="text-link underline-offset-2 hover:underline"
            href={`/tournaments/${tournamentId}`}
          >
            View tournament
          </Link>
        </div>
      );
    } else {
      await orpc.tournaments.admin.denySubmission({ id: selected.id });
      toast.success('Tournament submission denied');
    }

    const decided = selected.id;
    notifyApprovalChange();
    await mutate(
      (current) =>
        current && {
          submissions: current.submissions.filter((row) => row.id !== decided),
        },
      { revalidate: true }
    );
  };

  return (
    <Panel data-testid="admin-approvals-submissions">
      <SectionHeader
        icon={Upload}
        title="Tournament submissions"
        meta={queueMeta(data ? submissions.length : undefined, error)}
      />
      {!data && error ? (
        <SectionError
          title="Tournament submissions could not load"
          retrying={isValidating}
          onRetry={() => void mutate()}
        />
      ) : !data ? (
        <div role="status" aria-label="Loading tournament submissions">
          <ApprovalTableSkeleton columns={SUBMISSION_COLUMNS} />
        </div>
      ) : submissions.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Upload}
          title="No tournament submissions waiting"
        />
      ) : (
        <DataTable
          fixed
          aria-label="Tournament submissions"
          phoneRows={
            <PhoneRowList aria-label="Tournament submissions">
              {submissions.map((submission) => (
                <PhoneRow
                  key={submission.id}
                  align="start"
                  title={<span className="truncate">{submission.name}</span>}
                  description={`${formatCountOf(submission.matchCount, 'match', 'matches')} · ${submission.submitter?.player.username ?? 'Deleted user'}`}
                  value={
                    <ViewButton
                      subject={`submission ${submission.name}`}
                      onClick={() => openSubmission(submission)}
                    />
                  }
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>
                {SUBMISSION_COLUMNS.tournament.label}
              </DataTableHead>
              <DataTableHead
                className={SUBMISSION_COLUMNS.submitter.width}
                showFrom={SUBMISSION_COLUMNS.submitter.showFrom}
              >
                {SUBMISSION_COLUMNS.submitter.label}
              </DataTableHead>
              <DataTableHead
                className={SUBMISSION_COLUMNS.matches.width}
                numeric
              >
                {SUBMISSION_COLUMNS.matches.label}
              </DataTableHead>
              <DataTableHead
                className={SUBMISSION_COLUMNS.submitted.width}
                showFrom={SUBMISSION_COLUMNS.submitted.showFrom}
              >
                {SUBMISSION_COLUMNS.submitted.label}
              </DataTableHead>
              <DataTableHead
                className={SUBMISSION_COLUMNS.view.width}
                align="end"
              >
                <span className="sr-only">Actions</span>
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {submissions.map((submission) => (
              <DataTableRow key={submission.id}>
                <DataTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {submission.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {submission.abbreviation}
                    </span>
                  </span>
                </DataTableCell>
                <DataTableCell showFrom={SUBMISSION_COLUMNS.submitter.showFrom}>
                  <span className="block truncate">
                    <ReportUserName user={submission.submitter} />
                  </span>
                </DataTableCell>
                <DataTableCell numeric>
                  {formatCount(submission.matchCount)}
                </DataTableCell>
                <DataTableCell
                  muted
                  showFrom={SUBMISSION_COLUMNS.submitted.showFrom}
                >
                  <DateText date={submission.created} />
                </DataTableCell>
                <DataTableCell align="end" empty={false}>
                  <ViewButton
                    subject={`submission ${submission.name}`}
                    onClick={() => openSubmission(submission)}
                  />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}

      <ApprovalDialog
        open={open}
        onOpenChange={setOpen}
        title="Tournament submission"
        description={
          selected
            ? `Submission #${formatId(selected.id)} · ${selected.name}`
            : undefined
        }
        approveLabel="Approve submission"
        approveError="Failed to approve the submission"
        denyError="Failed to deny the submission"
        onDecide={decide}
      >
        {selected ? (
          <SubmissionDetails
            submission={selected}
            submitter={<ReportUserName user={selected.submitter} wrap />}
          />
        ) : null}
      </ApprovalDialog>
    </Panel>
  );
}

function FilterRequestQueue() {
  const { data, error, isValidating, mutate } = useSWR(
    'admin-filter-requests',
    () => orpc.filtering.admin.requests({}),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const [selected, setSelected] = useState<AdminFilterRequest | null>(null);
  const [open, setOpen] = useState(false);
  const requests = data?.requests ?? [];

  const openRequest = (request: AdminFilterRequest) => {
    setSelected(request);
    setOpen(true);
  };

  const decide = async (decision: Decision) => {
    if (!selected) return;

    if (decision === 'approve') {
      const { filterReportId } = await orpc.filtering.admin.approveRequest({
        id: selected.id,
      });
      toast.success(
        <div className="flex flex-col gap-1">
          <span>Filter request approved</span>
          <Link
            className="text-link underline-offset-2 hover:underline"
            href={`/tools/filter-reports?report=${filterReportId}`}
          >
            View filter report
          </Link>
        </div>
      );
    } else {
      await orpc.filtering.admin.denyRequest({ id: selected.id });
      toast.success('Filter request denied');
    }

    const decided = selected.id;
    notifyApprovalChange();
    await mutate(
      (current) =>
        current && {
          requests: current.requests.filter((row) => row.id !== decided),
        },
      { revalidate: true }
    );
  };

  return (
    <Panel data-testid="admin-approvals-filter-requests">
      <SectionHeader
        icon={Filter}
        title="Filter requests"
        meta={queueMeta(data ? requests.length : undefined, error)}
      />
      {!data && error ? (
        <SectionError
          title="Filter requests could not load"
          retrying={isValidating}
          onRetry={() => void mutate()}
        />
      ) : !data ? (
        <div role="status" aria-label="Loading filter requests">
          <ApprovalTableSkeleton columns={FILTER_REQUEST_COLUMNS} />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Filter}
          title="No filter requests waiting"
        />
      ) : (
        <DataTable
          fixed
          aria-label="Filter requests"
          phoneRows={
            <PhoneRowList aria-label="Filter requests">
              {requests.map((request) => (
                <PhoneRow
                  key={request.id}
                  align="start"
                  title={
                    <span className="truncate">
                      {request.requester?.player.username ?? 'Deleted user'}
                    </span>
                  }
                  description={`${formatUnknownShare(request.unknownPlayerCount, request.playerCount)} not in o!TR`}
                  value={
                    <ViewButton
                      subject={`filter request #${formatId(request.id)}`}
                      onClick={() => openRequest(request)}
                    />
                  }
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>
                {FILTER_REQUEST_COLUMNS.requester.label}
              </DataTableHead>
              <DataTableHead
                className={FILTER_REQUEST_COLUMNS.players.width}
                numeric
              >
                {FILTER_REQUEST_COLUMNS.players.label}
              </DataTableHead>
              <DataTableHead
                className={FILTER_REQUEST_COLUMNS.unknown.width}
                numeric
                showFrom={FILTER_REQUEST_COLUMNS.unknown.showFrom}
              >
                {FILTER_REQUEST_COLUMNS.unknown.label}
              </DataTableHead>
              <DataTableHead
                className={FILTER_REQUEST_COLUMNS.submitted.width}
                showFrom={FILTER_REQUEST_COLUMNS.submitted.showFrom}
              >
                {FILTER_REQUEST_COLUMNS.submitted.label}
              </DataTableHead>
              <DataTableHead
                className={FILTER_REQUEST_COLUMNS.view.width}
                align="end"
              >
                <span className="sr-only">Actions</span>
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {requests.map((request) => (
              <DataTableRow key={request.id}>
                <DataTableCell>
                  <span className="block truncate">
                    <ReportUserName user={request.requester} />
                  </span>
                </DataTableCell>
                <DataTableCell numeric>
                  {formatCount(request.playerCount)}
                </DataTableCell>
                <DataTableCell
                  numeric
                  showFrom={FILTER_REQUEST_COLUMNS.unknown.showFrom}
                >
                  {formatUnknownShare(
                    request.unknownPlayerCount,
                    request.playerCount
                  )}
                </DataTableCell>
                <DataTableCell
                  muted
                  showFrom={FILTER_REQUEST_COLUMNS.submitted.showFrom}
                >
                  <DateText date={request.created} />
                </DataTableCell>
                <DataTableCell align="end" empty={false}>
                  <ViewButton
                    subject={`filter request #${formatId(request.id)}`}
                    onClick={() => openRequest(request)}
                  />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}

      <ApprovalDialog
        open={open}
        onOpenChange={setOpen}
        title="Filter request"
        description={
          selected
            ? `Request #${formatId(selected.id)} · ${formatCountOf(selected.playerCount, 'player')}`
            : undefined
        }
        approveLabel="Approve request"
        approveError="Failed to approve the filter request"
        denyError="Failed to deny the filter request"
        onDecide={decide}
      >
        {selected ? (
          <FilterRequestDetails
            request={selected}
            requester={<ReportUserName user={selected.requester} wrap />}
          />
        ) : null}
      </ApprovalDialog>
    </Panel>
  );
}

/** "3 waiting" beside a queue's title, or a bar while it loads. */
function queueMeta(count: number | undefined, error: unknown): ReactNode {
  if (count !== undefined) {
    return count > 0 ? `${formatCount(count)} waiting` : undefined;
  }

  return error ? undefined : <SkeletonText className="h-3 w-16" />;
}

/**
 * The dialog both queues open: the request's details, then Deny and the
 * approve action. It stays open with a spinner while a decision runs, and
 * closes once it is saved.
 */
function ApprovalDialog({
  open,
  onOpenChange,
  title,
  description,
  approveLabel,
  approveError,
  denyError,
  onDecide,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  approveLabel: string;
  approveError: string;
  denyError: string;
  onDecide: (decision: Decision) => Promise<void>;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<Decision | null>(null);

  const run = async (decision: Decision) => {
    setPending(decision);
    try {
      await onDecide(decision);
      onOpenChange(false);
    } catch (error) {
      console.error('[admin-approvals] decision failed', error);
      toast.error(
        errorMessage(error, decision === 'approve' ? approveError : denyError)
      );
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={title}
      description={description}
      size="lg"
      data-testid="admin-approval-dialog"
      footer={
        <>
          <Button
            variant="outline"
            icon={X}
            pending={pending === 'deny'}
            disabled={busy}
            onClick={() => void run('deny')}
          >
            Deny
          </Button>
          <Button
            icon={Check}
            pending={pending === 'approve'}
            disabled={busy}
            onClick={() => void run('approve')}
          >
            {approveLabel}
          </Button>
        </>
      }
    >
      {children}
    </DialogTemplate>
  );
}
