import type { OsuApiPayload } from '../messages/types';
import { JobQueue } from './enums';

export interface JobPayloads {
  [JobQueue.OsuFetch]: OsuApiPayload;
  [JobQueue.OsuTrackFetch]: { osuPlayerId: number };
  [JobQueue.TournamentChecks]: {
    tournamentId: number;
    overrideVerifiedState: boolean;
  };
  [JobQueue.TournamentStats]: { tournamentId: number };
  [JobQueue.BeatmapAttributes]: {
    /** o!TR beatmaps.id */
    beatmapId: number;
    /** MD5 osu! currently reports; a stored file with another checksum is downloaded again. */
    checksum?: string;
  };
  /** Recomputes the platform stats that are due; see platform-stats/. */
  [JobQueue.PlatformStats]: Record<string, never>;
}

export type JobPayload<Q extends JobQueue> = JobPayloads[Q];

const osuFetchKey = (payload: OsuApiPayload): string => {
  switch (payload.type) {
    case 'match':
      return `match:${payload.osuMatchId}:${payload.isLazer ? 'lazer' : 'stable'}`;
    case 'beatmap':
      return `beatmap:${payload.beatmapId}${payload.skipAutomationChecks ? ':nochecks' : ''}`;
    case 'player':
      return `player:${payload.osuPlayerId}`;
    case 'forumTopic':
      return `forumTopic:${payload.topicId}`;
  }
};

/**
 * The key two requests for the same work share, so the second merges into the
 * first while it is pending or running. It holds every payload field that
 * changes what the job does; fields whose newest value is always right, such
 * as an attribute job's checksum, merge instead. Null never merges.
 */
export const jobDedupKeys: {
  [Q in JobQueue]: (payload: JobPayload<Q>) => string | null;
} = {
  [JobQueue.OsuFetch]: osuFetchKey,
  [JobQueue.OsuTrackFetch]: (payload) => `player:${payload.osuPlayerId}`,
  [JobQueue.TournamentChecks]: (payload) =>
    `tournament:${payload.tournamentId}${payload.overrideVerifiedState ? ':override' : ''}`,
  // The processor inserts these inside its REPEATABLE READ transaction, where
  // a conflict with a row committed after its snapshot would roll back the
  // whole rating run. Stats rewrite in one transaction, so duplicates are
  // harmless.
  [JobQueue.TournamentStats]: () => null,
  [JobQueue.BeatmapAttributes]: (payload) => `beatmap:${payload.beatmapId}`,
  // One refresh at a time: a request merges into a waiting or running one.
  [JobQueue.PlatformStats]: () => 'platform',
};
