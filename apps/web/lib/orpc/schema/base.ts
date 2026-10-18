import { createSelectSchema } from 'drizzle-zod';

import * as schema from '@otr/core/db/schema';

const rawPlayerSelectSchema = createSelectSchema(schema.players);
export const playerSelectSchema = rawPlayerSelectSchema.omit({
  searchVector: true,
  previousUsernames: true,
});

export const userSelectSchema = createSelectSchema(schema.users);

const rawBeatmapsetSelectSchema = createSelectSchema(schema.beatmapsets);
export const beatmapsetSelectSchema = rawBeatmapsetSelectSchema.omit({
  searchVector: true,
});

const rawBeatmapSelectSchema = createSelectSchema(schema.beatmaps);
export const beatmapSelectSchema = rawBeatmapSelectSchema.omit({
  searchVector: true,
});
export const beatmapAttributeSelectSchema = createSelectSchema(
  schema.beatmapAttributes
);

export const gameSelectSchema = createSelectSchema(schema.games);
export const gameScoreSelectSchema = createSelectSchema(schema.gameScores);

const rawMatchSelectSchema = createSelectSchema(schema.matches);
export const matchSelectSchema = rawMatchSelectSchema.omit({
  searchVector: true,
});

export const matchRosterSelectSchema = createSelectSchema(schema.matchRosters);

export const playerMatchStatsSelectSchema = createSelectSchema(
  schema.playerMatchStats
);
export const playerTournamentStatsSelectSchema = createSelectSchema(
  schema.playerTournamentStats
);
export const ratingAdjustmentSelectSchema = createSelectSchema(
  schema.ratingAdjustments
);

const rawTournamentSelectSchema = createSelectSchema(schema.tournaments);
export const tournamentSelectSchema = rawTournamentSelectSchema.omit({
  searchVector: true,
  matchRankVector: true,
  // Internal link the data worker maintains; not part of the public API.
  forumPostId: true,
});

export const tournamentAdminNoteSelectSchema = createSelectSchema(
  schema.tournamentAdminNotes
);
export const playerRatingSelectSchema = createSelectSchema(
  schema.playerRatings
);

export const dataReportSelectSchema = createSelectSchema(schema.dataReports);
