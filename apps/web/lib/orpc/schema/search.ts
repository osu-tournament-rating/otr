import { z } from 'zod';

import {
  beatmapSelectSchema,
  matchSelectSchema,
  playerRatingSelectSchema,
  playerSelectSchema,
  tournamentSelectSchema,
} from './base';
import { RulesetSchema, VerificationStatusSchema } from './constants';
import { TierProgressSchema } from './leaderboard';

export const SearchRequestSchema = z.object({
  searchKey: z.string().trim().min(2).max(100),
});

export const PlayerSearchResultSchema = playerSelectSchema
  .pick({
    id: true,
    osuId: true,
    username: true,
  })
  .extend({
    rating: playerRatingSelectSchema.shape.rating.nullable(),
    ruleset: RulesetSchema.nullable(),
    globalRank: playerRatingSelectSchema.shape.globalRank.nullable(),
    tierProgress: TierProgressSchema.nullable(),
    isFriend: z.boolean().optional(),
    matchedPreviousUsername: z.string().nullable().optional(),
  });

const tournamentSearchBaseSchema = tournamentSelectSchema.pick({
  id: true,
  name: true,
  ruleset: true,
  verificationStatus: true,
  rejectionReason: true,
  lobbySize: true,
  abbreviation: true,
  isLazer: true,
});

export const TournamentSearchResultSchema = tournamentSearchBaseSchema
  .omit({
    abbreviation: true,
  })
  .extend({
    ruleset: RulesetSchema,
    verificationStatus: VerificationStatusSchema,
    abbreviation: tournamentSearchBaseSchema.shape.abbreviation.nullable(),
    verifiedByUsername: z.string().nullable(),
    /** Verified, but the weekly rating run has not rated it yet. */
    pendingRating: z.boolean(),
  });

const matchSearchBaseSchema = matchSelectSchema.pick({
  id: true,
  osuId: true,
  name: true,
});

export const MatchSearchResultSchema = matchSearchBaseSchema
  .omit({
    osuId: true,
  })
  .extend({
    osuId: matchSearchBaseSchema.shape.osuId.nullable(),
    tournamentName: z.string(),
  });

const beatmapSearchBaseSchema = beatmapSelectSchema.pick({
  id: true,
  osuId: true,
  diffName: true,
  sr: true,
  ruleset: true,
});

export const BeatmapSearchResultSchema = beatmapSearchBaseSchema.extend({
  ruleset: RulesetSchema,
  artist: z.string(),
  title: z.string(),
  creator: z.string().nullable(),
  beatmapsetOsuId: z.number().int().nonnegative().nullable(),
  gameCount: z.number().int().nonnegative(),
  tournamentCount: z.number().int().nonnegative(),
});

export const SearchResponseSchema = z.object({
  players: PlayerSearchResultSchema.array(),
  tournaments: TournamentSearchResultSchema.array(),
  matches: MatchSearchResultSchema.array(),
  beatmaps: BeatmapSearchResultSchema.array(),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type PlayerSearchResult = z.infer<typeof PlayerSearchResultSchema>;
export type TournamentSearchResult = z.infer<
  typeof TournamentSearchResultSchema
>;
export type MatchSearchResult = z.infer<typeof MatchSearchResultSchema>;
export type BeatmapSearchResult = z.infer<typeof BeatmapSearchResultSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
