import type { MessageMetadata } from './values';

/** Metadata plus a message-specific payload. */
export type MessageEnvelope<TPayload> = MessageMetadata & TPayload;

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

/** Message type for the `data.osu` queue. */
export type FetchOsuMessage = MessageEnvelope<OsuApiPayload>;

// Legacy aliases.
export type FetchBeatmapMessage = MessageEnvelope<FetchBeatmapPayload>;
export type FetchMatchMessage = MessageEnvelope<FetchMatchPayload>;
export type FetchPlayerMessage = MessageEnvelope<FetchPlayerPayload>;

export type FetchPlayerOsuTrackMessage = MessageEnvelope<{
  osuPlayerId: number;
}>;

export type ProcessTournamentAutomationCheckMessage = MessageEnvelope<{
  tournamentId: number;
  overrideVerifiedState: boolean;
}>;

export type ProcessTournamentStatsMessage = MessageEnvelope<{
  tournamentId: number;
}>;

/** Store a beatmap's .osu file and calculate its attributes. */
export type ProcessBeatmapAttributesMessage = MessageEnvelope<{
  /** o!TR beatmaps.id */
  beatmapId: number;
  /** MD5 osu! currently reports; a stored file with another checksum is downloaded again. */
  checksum?: string;
}>;

export type KnownQueueMessage =
  | FetchOsuMessage
  | FetchPlayerOsuTrackMessage
  | ProcessTournamentAutomationCheckMessage
  | ProcessTournamentStatsMessage
  | ProcessBeatmapAttributesMessage;

export type { MessageMetadata } from './values';
