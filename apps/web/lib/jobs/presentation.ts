import { JobQueue } from '@otr/core/jobs/enums';

import {
  JOB_QUEUE_LABELS,
  formatTextValue,
} from '@/lib/kit/format/enum-labels';
import { formatId } from '@/lib/kit/format/number';

/** The queue a stored value names, if this release knows it. */
export const toJobQueue = (queue: string): JobQueue | undefined =>
  Object.values(JobQueue).find((known) => known === queue);

/** A queue's name, or the stored value for a queue this release does not know. */
export const getJobQueueLabel = (queue: string) =>
  formatTextValue(queue, JOB_QUEUE_LABELS);

export interface JobSubject {
  /** What the job works on: "Match 123456", "Automated checks". */
  title: string;
  /** A detail that tells two such jobs apart: "lazer", "resets verified data". */
  detail: string | null;
  /** The page of what it works on, when the site has one. */
  href: string | null;
}

const idOf = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
};

/** What a job works on, read from its payload. */
export function describeJob(
  queue: string,
  payload: Record<string, unknown>
): JobSubject {
  const subject = (
    title: string,
    detail: string | null = null,
    href: string | null = null
  ): JobSubject => ({ title, detail, href });

  switch (queue) {
    case JobQueue.OsuFetch: {
      const matchId = idOf(payload, 'osuMatchId');
      const beatmapId = idOf(payload, 'beatmapId');
      const playerId = idOf(payload, 'osuPlayerId');
      const topicId = idOf(payload, 'topicId');

      switch (payload.type) {
        case 'match':
          if (matchId === null) break;
          return subject(
            `Match ${formatId(matchId)}`,
            payload.isLazer ? 'lazer' : 'stable'
          );
        case 'beatmap':
          if (beatmapId === null) break;
          return subject(
            `Beatmap ${formatId(beatmapId)}`,
            payload.skipAutomationChecks ? 'without automated checks' : null,
            `/beatmaps/${beatmapId}`
          );
        case 'player':
          if (playerId === null) break;
          return subject(`Player ${formatId(playerId)}`);
        case 'forumTopic':
          if (topicId === null) break;
          return subject(`Forum topic ${formatId(topicId)}`);
      }
      break;
    }
    case JobQueue.OsuTrackFetch: {
      const playerId = idOf(payload, 'osuPlayerId');
      if (playerId !== null) return subject(`Player ${formatId(playerId)}`);
      break;
    }
    case JobQueue.TournamentChecks:
      return subject(
        'Automated checks',
        payload.overrideVerifiedState ? 'resets verified data' : null
      );
    case JobQueue.TournamentStats:
      return subject('Tournament stats');
    case JobQueue.BeatmapAttributes: {
      const beatmapId = idOf(payload, 'beatmapId');
      if (beatmapId !== null) {
        return subject(`o!TR beatmap ${formatId(beatmapId)}`);
      }
      break;
    }
  }

  return subject(getJobQueueLabel(queue));
}
