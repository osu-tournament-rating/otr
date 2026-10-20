import { formatCount } from '@/lib/kit/format/number';
import type { JobBadgeState } from '@/lib/kit/status/job';
import type {
  FetchProgress,
  JobStageState,
  ProgressIssue,
} from '@/lib/orpc/schema/tournamentProgress';

/**
 * Where a tournament's matches or beatmaps stand, as its progress panel
 * says it: `12 of 40 still fetching`, `All 40 fetched` (`1 fetched` for
 * one), or what came of
 * them once none is left (`38 fetched · 1 not found · 1 failed`). Null when
 * it has none.
 */
export function describeFetchProgress(progress: FetchProgress): string | null {
  const { total, inFlight, fetched, notFound, failed } = progress;
  if (total === 0) return null;

  if (inFlight > 0) {
    return `${formatCount(inFlight)} of ${formatCount(total)} still fetching`;
  }
  if (fetched === total) {
    return total === 1 ? '1 fetched' : `All ${formatCount(total)} fetched`;
  }

  return [
    `${formatCount(fetched)} fetched`,
    notFound > 0 ? `${formatCount(notFound)} not found` : null,
    failed > 0 ? `${formatCount(failed)} failed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The share of matches or beatmaps no longer in flight, 0 to 100. */
export const fetchedPercent = ({ total, inFlight }: FetchProgress) =>
  total === 0 ? 100 : ((total - inFlight) / total) * 100;

/** What checks say while matches or beatmaps are still being fetched. */
export const CHECKS_WAITING_LINE = 'Waiting for every match and beatmap';

/** The badge for a checks or stats stage, when its job has a state to show. */
export function jobStageBadge(state: JobStageState): JobBadgeState | null {
  switch (state) {
    case 'queued':
    case 'retrying':
    case 'running':
    case 'failed':
    case 'cancelled':
      return state;
    case 'done':
      return 'succeeded';
    default:
      return null;
  }
}

/** What an issue is about: "Match 123456", "Automated checks". */
export function describeIssueSubject(issue: ProgressIssue): {
  title: string;
  href: string | null;
} {
  switch (issue.kind) {
    case 'match':
      return {
        title: `Match ${issue.osuId ?? ''}`.trim(),
        href: issue.entityId === null ? null : `/matches/${issue.entityId}`,
      };
    case 'beatmap':
      return {
        title: `Beatmap ${issue.osuId ?? ''}`.trim(),
        href: issue.osuId === null ? null : `/beatmaps/${issue.osuId}`,
      };
    case 'checks':
      return { title: 'Automated checks', href: null };
    case 'stats':
      return { title: 'Tournament stats', href: null };
  }
}
