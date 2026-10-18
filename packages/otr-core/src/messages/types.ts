/** Payloads for the unified osu! API queue, routed on `type`. */
export type FetchBeatmapPayload = {
  type: 'beatmap';
  beatmapId: number;
  skipAutomationChecks?: boolean;
};

export type FetchMatchPayload = {
  type: 'match';
  osuMatchId: number;
  isLazer: boolean;
};

export type FetchPlayerPayload = {
  type: 'player';
  osuPlayerId: number;
};

/** Fetch a forum topic's opening post and link the tournaments whose forum URL points at it. */
export type FetchForumTopicPayload = {
  type: 'forumTopic';
  topicId: number;
};

export type OsuApiPayload =
  | FetchBeatmapPayload
  | FetchMatchPayload
  | FetchPlayerPayload
  | FetchForumTopicPayload;
