'use client';

import { JobQueue } from '@otr/core/jobs/enums';
import { MessagePriority } from '@otr/core/messages/values';
import { Ban, RotateCcw } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';

import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Eyebrow } from '@/components/kit/layout/Typography';
import { JobStateBadge } from '@/components/kit/status/JobStateBadge';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { describeJob, getJobQueueLabel } from '@/lib/jobs/presentation';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type { Job } from '@/lib/orpc/schema/jobs';

const LONG_TEXT = 'wrap-anywhere whitespace-pre-wrap';

const PRIORITY_NAMES: Record<number, string> = {
  [MessagePriority.Low]: 'Low',
  [MessagePriority.Normal]: 'Normal',
  [MessagePriority.High]: 'High',
};

/**
 * A match or beatmap fetch: once cancelled, the data worker's hourly sweep
 * queues it again while the match or beatmap is still not fetched.
 */
const isRequeuedAfterCancel = (job: Job) =>
  job.queue === JobQueue.OsuFetch &&
  (job.payload.type === 'match' || job.payload.type === 'beatmap');

/** The SWR keys of the queue counts and of each page of the jobs list. */
export const JOB_SUMMARY_KEY = 'admin-job-summary';
export const JOB_LIST_KEY = 'admin-jobs';

/** Refreshes the queue counts and every page of the list after a change. */
export function useRefreshJobs() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) =>
          key === JOB_SUMMARY_KEY ||
          (Array.isArray(key) && key[0] === JOB_LIST_KEY)
      ),
    [mutate]
  );
}

/** What a retry did, for its toast. */
export function retryMessage({
  retried,
  skipped,
}: {
  retried: number;
  skipped: number;
}) {
  const queued = `${formatCountOf(retried, 'job')} queued to run again`;
  return skipped > 0 ? `${queued}, ${formatCount(skipped)} skipped` : queued;
}

/** One label and its value; side by side from `sm`, stacked on phones. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-baseline sm:gap-x-4">
      <dt>
        <Eyebrow>{label}</Eyebrow>
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

type PendingAction = 'retry' | 'cancel';

/**
 * One job, opened from its row's View button: what it works on, its state,
 * attempts and times, the error it left and its payload. A waiting job can
 * be cancelled, and a failed or cancelled one retried.
 */
export function JobDialog({
  job,
  open,
  onOpenChange,
}: {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshJobs();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const run = async (action: PendingAction) => {
    if (!job) return;
    setPending(action);
    try {
      if (action === 'retry') {
        const result = await orpc.admin.jobs.retry({ ids: [job.id] });
        if (result.retried > 0) {
          toast.success(retryMessage(result));
        } else {
          toast.info('The same work is already queued');
        }
      } else {
        const result = await orpc.admin.jobs.cancel({ ids: [job.id] });
        if (result.cancelled > 0) {
          toast.success('Job cancelled');
        } else {
          toast.info('The job is no longer waiting');
        }
      }
      onOpenChange(false);
      void refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : action === 'retry'
            ? 'Failed to retry the job'
            : 'Failed to cancel the job'
      );
    } finally {
      setPending(null);
    }
  };

  const subject = job ? describeJob(job.queue, job.payload) : null;
  const waiting = job?.state === 'queued' || job?.state === 'delayed';
  const retryable = job?.state === 'failed' || job?.state === 'cancelled';
  const busy = pending !== null;

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="Job details"
      description={
        job && subject
          ? `Job #${formatId(job.id)} · ${getJobQueueLabel(job.queue)} · ${subject.title}`
          : undefined
      }
      size="lg"
      data-testid="admin-job-detail"
      footerStart={
        job && waiting && isRequeuedAfterCancel(job)
          ? 'Queued again within the hour while not fetched'
          : undefined
      }
      footer={
        job && (waiting || retryable) ? (
          waiting ? (
            <Button
              variant="outline"
              icon={Ban}
              pending={pending === 'cancel'}
              disabled={busy}
              onClick={() => void run('cancel')}
            >
              Cancel job
            </Button>
          ) : (
            <Button
              icon={RotateCcw}
              pending={pending === 'retry'}
              disabled={busy}
              onClick={() => void run('retry')}
            >
              Retry job
            </Button>
          )
        ) : null
      }
    >
      {job && subject ? (
        <dl className="grid gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
          <DetailRow label="State">
            <JobStateBadge state={job.state} />
          </DetailRow>
          <DetailRow label="Job">
            {subject.href ? (
              <EntityLink href={subject.href} wrap>
                {subject.title}
              </EntityLink>
            ) : (
              <span className="font-medium">{subject.title}</span>
            )}
            {subject.detail ? (
              <span className="text-muted-foreground"> · {subject.detail}</span>
            ) : null}
          </DetailRow>
          <DetailRow label="Queue">
            {getJobQueueLabel(job.queue)}
            <span className="text-muted-foreground"> · {job.queue}</span>
          </DetailRow>
          <DetailRow label="Tournament">
            {job.tournament ? (
              <EntityLink href={`/tournaments/${job.tournament.id}`} wrap>
                {job.tournament.name}
              </EntityLink>
            ) : job.tournamentId !== null ? (
              <span className="text-muted-foreground">
                Deleted tournament {formatId(job.tournamentId)}
              </span>
            ) : (
              <MissingValue />
            )}
          </DetailRow>
          <DetailRow label="Attempts">
            <span className="tabular-nums">
              {formatCount(job.attempts)} of {formatCount(job.maxAttempts)}
            </span>
          </DetailRow>
          <DetailRow label="Priority">
            {PRIORITY_NAMES[job.priority] ?? formatCount(job.priority)}
          </DetailRow>
          <DetailRow label="Requested by">
            {job.requestedBy ? (
              <EntityLink href={`/players/${job.requestedBy.playerId}`} wrap>
                {job.requestedBy.username ??
                  `Player ${formatId(job.requestedBy.playerId)}`}
              </EntityLink>
            ) : (
              <span className="text-muted-foreground">System</span>
            )}
          </DetailRow>
          <DetailRow label="Queued">
            <Timestamp date={job.created} seconds />
          </DetailRow>
          {waiting ? (
            <DetailRow label="Runs">
              <Timestamp date={job.runAfter} seconds />
            </DetailRow>
          ) : null}
          {job.started ? (
            <DetailRow label="Last started">
              <Timestamp date={job.started} seconds />
            </DetailRow>
          ) : null}
          {job.finished ? (
            <DetailRow label="Finished">
              <Timestamp date={job.finished} seconds />
            </DetailRow>
          ) : null}
          <DetailRow label="Last error">
            {job.lastError ? (
              <span className={LONG_TEXT}>{job.lastError}</span>
            ) : (
              <MissingValue />
            )}
          </DetailRow>
          <DetailRow label="Correlation ID">
            <span className="wrap-anywhere">{job.correlationId}</span>
          </DetailRow>
          <DetailRow label="Payload">
            <span className={`${LONG_TEXT} text-xs`}>
              {JSON.stringify(job.payload, null, 2)}
            </span>
          </DetailRow>
        </dl>
      ) : null}
    </DialogTemplate>
  );
}
