/**
 * Where a background job, or the work it does, stands on the admin jobs
 * page and a tournament's progress. `retrying` is a job waiting out its
 * backoff after an error, and `stalled` is work with no job queued to do it.
 */
export const JOB_BADGE_STATES = [
  'queued',
  'delayed',
  'retrying',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'stalled',
] as const;

export type JobBadgeState = (typeof JOB_BADGE_STATES)[number];

export interface JobStateCopy {
  /** The state's one name. */
  name: string;
  /** Waiting and finished work is neutral; trouble is amber, giving up red. */
  tone: 'neutral' | 'success' | 'warning' | 'destructive';
}

export const JOB_STATE_COPY: Record<JobBadgeState, JobStateCopy> = {
  queued: { name: 'Queued', tone: 'neutral' },
  delayed: { name: 'Delayed', tone: 'neutral' },
  retrying: { name: 'Retrying', tone: 'warning' },
  running: { name: 'Running', tone: 'neutral' },
  succeeded: { name: 'Succeeded', tone: 'success' },
  failed: { name: 'Failed', tone: 'destructive' },
  cancelled: { name: 'Cancelled', tone: 'neutral' },
  stalled: { name: 'Stalled', tone: 'warning' },
};

export function getJobStateCopy(state: JobBadgeState): JobStateCopy {
  return JOB_STATE_COPY[state];
}
