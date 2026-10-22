/**
 * Validation messages for the tournament fields, shared by the submission
 * form, the admin edit dialog and their server schemas. Each one is a
 * statement about the field, naming it as its label does.
 */

import { formatCount } from '@/lib/kit/format/number';

export const TOURNAMENT_NAME_REQUIRED_MESSAGE = 'Tournament name is required';
export const TOURNAMENT_ABBREVIATION_REQUIRED_MESSAGE =
  'Tournament abbreviation is required';

export const FORUM_POST_URL_REQUIRED_MESSAGE = 'Forum post URL is required';
/** The submission rule: a forum topic or a page in the wiki's tournaments section. */
export const FORUM_POST_URL_SOURCE_MESSAGE =
  "Forum post URL must be from osu.ppy.sh forums or the osu! wiki's tournaments section";
/** The admin edit rule: a link under either prefix. */
export const FORUM_POST_URL_PREFIX_MESSAGE =
  'Forum post URL must be from "https://osu.ppy.sh/community/forums/topics/" or "https://osu.ppy.sh/wiki/en/Tournaments/"';

export const RULESET_REQUIRED_MESSAGE = 'Ruleset is required';

export const RANK_RESTRICTION_REQUIRED_MESSAGE = 'Rank restriction is required';
export const RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE =
  'Rank restriction must be a whole number';
export const RANK_RESTRICTION_MINIMUM_MESSAGE =
  'Rank restriction must be at least 1';

export const LOBBY_SIZE_REQUIRED_MESSAGE = 'Lobby size is required';
export const LOBBY_SIZE_MINIMUM_MESSAGE = 'Lobby size must be at least 1';
export const LOBBY_SIZE_MAXIMUM_MESSAGE = 'Lobby size cannot exceed 8';

/** A lazer room link with "Played on osu!lazer" unticked. */
export const ROOM_LINKS_NEED_LAZER_MESSAGE =
  'Room links need Played on osu!lazer ticked';
/** A stable match link with "Played on osu!lazer" ticked. */
export const MATCH_LINKS_NEED_STABLE_MESSAGE =
  'Match links need Played on osu!lazer unticked';
/** Stable match links and lazer room links in one submission. */
export const MIXED_MATCH_LINKS_MESSAGE =
  'Matches cannot mix match links and room links';

/** `Matches cannot exceed 1,000`. */
export const maxMatchIdsMessage = (max: number) =>
  `Matches cannot exceed ${formatCount(max)}`;

/** `Beatmaps cannot exceed 1,000`. */
export const maxBeatmapIdsMessage = (max: number) =>
  `Beatmaps cannot exceed ${formatCount(max)}`;
