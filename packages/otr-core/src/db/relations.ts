import { relations } from 'drizzle-orm/relations';
import {
  auth_accounts,
  auth_sessions,
  auth_users,
  apiKeys as apiKeys,
  players,
  playerFriends,
  beatmapsets,
  users,
  filterReports,
  auditEvents,
  games,
  beatmapAudits,
  beatmapAdminNotes,
  gameAudits,
  gameRosters,
  gameScores,
  gameScoreAudits,
  beatmaps,
  filterReportPlayers,
  matches,
  gameAdminNotes,
  gameScoreAdminNotes,
  matchAudits,
  matchRosters,
  matchAdminNotes,
  tournaments,
  playerAdminNotes,
  playerHighestRanks,
  playerOsuRulesetData,
  ratingAdjustments,
  playerRatings,
  oAuthClients,
  playerMatchStats,
  playerTournamentStats,
  tournamentAdminNotes,
  tournamentAudits,
  tournamentForumPosts,
  userSettings,
  beatmapAttributes,
  beatmapFiles,
  oAuthClientAdminNote,
  joinBeatmapCreators,
  joinPooledBeatmaps,
  dataReports,
} from './schema';

export const beatmapsetsRelations = relations(beatmapsets, ({ one, many }) => ({
  player: one(players, {
    fields: [beatmapsets.creatorId],
    references: [players.id],
  }),
  beatmaps: many(beatmaps),
}));

export const authUsersRelations = relations(auth_users, ({ one, many }) => ({
  player: one(players, {
    fields: [auth_users.playerId],
    references: [players.id],
  }),
  accounts: many(auth_accounts),
  sessions: many(auth_sessions),
  apiKeys: many(apiKeys),
}));

export const authApiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(auth_users, {
    fields: [apiKeys.referenceId],
    references: [auth_users.id],
  }),
}));

export const playersRelations = relations(players, ({ many }) => ({
  beatmapsets: many(beatmapsets),
  gameScores: many(gameScores),
  filterReportPlayers: many(filterReportPlayers),
  playerAdminNotes: many(playerAdminNotes),
  playerHighestRanks: many(playerHighestRanks),
  playerOsuRulesetData: many(playerOsuRulesetData),
  ratingAdjustments: many(ratingAdjustments),
  playerMatchStats: many(playerMatchStats),
  playerRatings: many(playerRatings),
  playerTournamentStats: many(playerTournamentStats),
  users: many(users),
  joinBeatmapCreators: many(joinBeatmapCreators),
  authUsers: many(auth_users),
  friends: many(playerFriends, {
    relationName: 'playerFriends_player',
  }),
  friendOf: many(playerFriends, {
    relationName: 'playerFriends_friend',
  }),
}));

export const filterReportsRelations = relations(
  filterReports,
  ({ one, many }) => ({
    user: one(users, {
      fields: [filterReports.userId],
      references: [users.id],
    }),
    filterReportPlayers: many(filterReportPlayers),
  })
);

export const usersRelations = relations(users, ({ one, many }) => ({
  auditEvents: many(auditEvents),
  filterReports: many(filterReports),
  gameAdminNotes: many(gameAdminNotes),
  gameScoreAdminNotes: many(gameScoreAdminNotes),
  matchAdminNotes: many(matchAdminNotes),
  matches_submittedByUserId: many(matches, {
    relationName: 'matches_submittedByUserId_users_id',
  }),
  matches_verifiedByUserId: many(matches, {
    relationName: 'matches_verifiedByUserId_users_id',
  }),
  playerAdminNotes: many(playerAdminNotes),
  oAuthClients: many(oAuthClients),
  tournamentAdminNotes: many(tournamentAdminNotes),
  tournaments_submittedByUserId: many(tournaments, {
    relationName: 'tournaments_submittedByUserId_users_id',
  }),
  tournaments_verifiedByUserId: many(tournaments, {
    relationName: 'tournaments_verifiedByUserId_users_id',
  }),
  userSettings: one(userSettings),
  player: one(players, {
    fields: [users.playerId],
    references: [players.id],
  }),
  dataReports_reporter: many(dataReports, {
    relationName: 'dataReports_reporterUserId_users_id',
  }),
  dataReports_resolvedBy: many(dataReports, {
    relationName: 'dataReports_resolvedByUserId_users_id',
  }),
}));

export const auditEventsRelations = relations(auditEvents, ({ one, many }) => ({
  actionUser: one(users, {
    fields: [auditEvents.actionUserId],
    references: [users.id],
  }),
  beatmapAudits: many(beatmapAudits),
  gameAudits: many(gameAudits),
  gameScoreAudits: many(gameScoreAudits),
  matchAudits: many(matchAudits),
  tournamentAudits: many(tournamentAudits),
}));

export const beatmapAuditsRelations = relations(beatmapAudits, ({ one }) => ({
  event: one(auditEvents, {
    fields: [beatmapAudits.eventId],
    references: [auditEvents.id],
  }),
  beatmap: one(beatmaps, {
    fields: [beatmapAudits.referenceId],
    references: [beatmaps.id],
  }),
}));

export const beatmapAdminNotesRelations = relations(
  beatmapAdminNotes,
  ({ one }) => ({
    beatmap: one(beatmaps, {
      fields: [beatmapAdminNotes.referenceId],
      references: [beatmaps.id],
    }),
    user: one(users, {
      fields: [beatmapAdminNotes.adminUserId],
      references: [users.id],
    }),
  })
);

export const gameAuditsRelations = relations(gameAudits, ({ one }) => ({
  event: one(auditEvents, {
    fields: [gameAudits.eventId],
    references: [auditEvents.id],
  }),
  game: one(games, {
    fields: [gameAudits.referenceId],
    references: [games.id],
  }),
}));

export const gamesRelations = relations(games, ({ one, many }) => ({
  gameAudits: many(gameAudits),
  gameRosters: many(gameRosters),
  gameScores: many(gameScores),
  beatmap: one(beatmaps, {
    fields: [games.beatmapId],
    references: [beatmaps.id],
  }),
  match: one(matches, {
    fields: [games.matchId],
    references: [matches.id],
  }),
  gameAdminNotes: many(gameAdminNotes),
}));

export const gameRostersRelations = relations(gameRosters, ({ one }) => ({
  game: one(games, {
    fields: [gameRosters.gameId],
    references: [games.id],
  }),
}));

export const gameScoresRelations = relations(gameScores, ({ one, many }) => ({
  game: one(games, {
    fields: [gameScores.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [gameScores.playerId],
    references: [players.id],
  }),
  gameScoreAudits: many(gameScoreAudits),
  gameScoreAdminNotes: many(gameScoreAdminNotes),
}));

export const gameScoreAuditsRelations = relations(
  gameScoreAudits,
  ({ one }) => ({
    event: one(auditEvents, {
      fields: [gameScoreAudits.eventId],
      references: [auditEvents.id],
    }),
    gameScore: one(gameScores, {
      fields: [gameScoreAudits.referenceId],
      references: [gameScores.id],
    }),
  })
);

export const beatmapsRelations = relations(beatmaps, ({ one, many }) => ({
  beatmapset: one(beatmapsets, {
    fields: [beatmaps.beatmapsetId],
    references: [beatmapsets.id],
  }),
  setOwnerOverride: one(players, {
    fields: [beatmaps.setOwnerIdOverride],
    references: [players.id],
  }),
  games: many(games),
  beatmapAttributes: many(beatmapAttributes),
  beatmapFile: one(beatmapFiles),
  beatmapAudits: many(beatmapAudits),
  beatmapAdminNotes: many(beatmapAdminNotes),
  joinBeatmapCreators: many(joinBeatmapCreators),
  joinPooledBeatmaps: many(joinPooledBeatmaps),
}));

export const filterReportPlayersRelations = relations(
  filterReportPlayers,
  ({ one }) => ({
    filterReport: one(filterReports, {
      fields: [filterReportPlayers.filterReportId],
      references: [filterReports.id],
    }),
    player: one(players, {
      fields: [filterReportPlayers.playerId],
      references: [players.id],
    }),
  })
);

export const matchesRelations = relations(matches, ({ one, many }) => ({
  games: many(games),
  matchAudits: many(matchAudits),
  matchRosters: many(matchRosters),
  matchAdminNotes: many(matchAdminNotes),
  tournament: one(tournaments, {
    fields: [matches.tournamentId],
    references: [tournaments.id],
  }),
  user_submittedByUserId: one(users, {
    fields: [matches.submittedByUserId],
    references: [users.id],
    relationName: 'matches_submittedByUserId_users_id',
  }),
  user_verifiedByUserId: one(users, {
    fields: [matches.verifiedByUserId],
    references: [users.id],
    relationName: 'matches_verifiedByUserId_users_id',
  }),
  ratingAdjustments: many(ratingAdjustments),
  playerMatchStats: many(playerMatchStats),
}));

export const gameAdminNotesRelations = relations(gameAdminNotes, ({ one }) => ({
  game: one(games, {
    fields: [gameAdminNotes.referenceId],
    references: [games.id],
  }),
  user: one(users, {
    fields: [gameAdminNotes.adminUserId],
    references: [users.id],
  }),
}));

export const gameScoreAdminNotesRelations = relations(
  gameScoreAdminNotes,
  ({ one }) => ({
    gameScore: one(gameScores, {
      fields: [gameScoreAdminNotes.referenceId],
      references: [gameScores.id],
    }),
    user: one(users, {
      fields: [gameScoreAdminNotes.adminUserId],
      references: [users.id],
    }),
  })
);

export const matchAuditsRelations = relations(matchAudits, ({ one }) => ({
  event: one(auditEvents, {
    fields: [matchAudits.eventId],
    references: [auditEvents.id],
  }),
  match: one(matches, {
    fields: [matchAudits.referenceId],
    references: [matches.id],
  }),
}));

export const matchRostersRelations = relations(matchRosters, ({ one }) => ({
  match: one(matches, {
    fields: [matchRosters.matchId],
    references: [matches.id],
  }),
}));

export const matchAdminNotesRelations = relations(
  matchAdminNotes,
  ({ one }) => ({
    match: one(matches, {
      fields: [matchAdminNotes.referenceId],
      references: [matches.id],
    }),
    user: one(users, {
      fields: [matchAdminNotes.adminUserId],
      references: [users.id],
    }),
  })
);

export const tournamentsRelations = relations(tournaments, ({ one, many }) => ({
  matches: many(matches),
  playerTournamentStats: many(playerTournamentStats),
  tournamentAdminNotes: many(tournamentAdminNotes),
  tournamentAudits: many(tournamentAudits),
  user_submittedByUserId: one(users, {
    fields: [tournaments.submittedByUserId],
    references: [users.id],
    relationName: 'tournaments_submittedByUserId_users_id',
  }),
  user_verifiedByUserId: one(users, {
    fields: [tournaments.verifiedByUserId],
    references: [users.id],
    relationName: 'tournaments_verifiedByUserId_users_id',
  }),
  joinPooledBeatmaps: many(joinPooledBeatmaps),
  forumPost: one(tournamentForumPosts, {
    fields: [tournaments.forumPostId],
    references: [tournamentForumPosts.id],
  }),
}));

export const tournamentForumPostsRelations = relations(
  tournamentForumPosts,
  ({ many }) => ({
    tournaments: many(tournaments),
  })
);

export const playerAdminNotesRelations = relations(
  playerAdminNotes,
  ({ one }) => ({
    player: one(players, {
      fields: [playerAdminNotes.referenceId],
      references: [players.id],
    }),
    user: one(users, {
      fields: [playerAdminNotes.adminUserId],
      references: [users.id],
    }),
  })
);

export const playerHighestRanksRelations = relations(
  playerHighestRanks,
  ({ one }) => ({
    player: one(players, {
      fields: [playerHighestRanks.playerId],
      references: [players.id],
    }),
  })
);

export const playerOsuRulesetDataRelations = relations(
  playerOsuRulesetData,
  ({ one }) => ({
    player: one(players, {
      fields: [playerOsuRulesetData.playerId],
      references: [players.id],
    }),
  })
);

export const ratingAdjustmentsRelations = relations(
  ratingAdjustments,
  ({ one }) => ({
    match: one(matches, {
      fields: [ratingAdjustments.matchId],
      references: [matches.id],
    }),
    playerRating: one(playerRatings, {
      fields: [ratingAdjustments.playerRatingId],
      references: [playerRatings.id],
    }),
    player: one(players, {
      fields: [ratingAdjustments.playerId],
      references: [players.id],
    }),
  })
);

export const playerRatingsRelations = relations(
  playerRatings,
  ({ one, many }) => ({
    ratingAdjustments: many(ratingAdjustments),
    player: one(players, {
      fields: [playerRatings.playerId],
      references: [players.id],
    }),
  })
);

export const oAuthClientsRelations = relations(
  oAuthClients,
  ({ one, many }) => ({
    user: one(users, {
      fields: [oAuthClients.userId],
      references: [users.id],
    }),
    oAuthClientAdminNotes: many(oAuthClientAdminNote),
  })
);

export const playerMatchStatsRelations = relations(
  playerMatchStats,
  ({ one }) => ({
    match: one(matches, {
      fields: [playerMatchStats.matchId],
      references: [matches.id],
    }),
    player: one(players, {
      fields: [playerMatchStats.playerId],
      references: [players.id],
    }),
  })
);

export const playerTournamentStatsRelations = relations(
  playerTournamentStats,
  ({ one }) => ({
    player: one(players, {
      fields: [playerTournamentStats.playerId],
      references: [players.id],
    }),
    tournament: one(tournaments, {
      fields: [playerTournamentStats.tournamentId],
      references: [tournaments.id],
    }),
  })
);

export const tournamentAdminNotesRelations = relations(
  tournamentAdminNotes,
  ({ one }) => ({
    tournament: one(tournaments, {
      fields: [tournamentAdminNotes.referenceId],
      references: [tournaments.id],
    }),
    user: one(users, {
      fields: [tournamentAdminNotes.adminUserId],
      references: [users.id],
    }),
  })
);

export const tournamentAuditsRelations = relations(
  tournamentAudits,
  ({ one }) => ({
    event: one(auditEvents, {
      fields: [tournamentAudits.eventId],
      references: [auditEvents.id],
    }),
    tournament: one(tournaments, {
      fields: [tournamentAudits.referenceId],
      references: [tournaments.id],
    }),
  })
);

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const beatmapAttributesRelations = relations(
  beatmapAttributes,
  ({ one }) => ({
    beatmap: one(beatmaps, {
      fields: [beatmapAttributes.beatmapId],
      references: [beatmaps.id],
    }),
  })
);

export const beatmapFilesRelations = relations(beatmapFiles, ({ one }) => ({
  beatmap: one(beatmaps, {
    fields: [beatmapFiles.beatmapId],
    references: [beatmaps.id],
  }),
}));

export const oAuthClientAdminNoteRelations = relations(
  oAuthClientAdminNote,
  ({ one }) => ({
    oAuthClient: one(oAuthClients, {
      fields: [oAuthClientAdminNote.referenceId],
      references: [oAuthClients.id],
    }),
  })
);

export const playerFriendsRelations = relations(playerFriends, ({ one }) => ({
  player: one(players, {
    fields: [playerFriends.playerId],
    references: [players.id],
    relationName: 'playerFriends_player',
  }),
  friend: one(users, {
    fields: [playerFriends.friendId],
    references: [users.playerId],
  }),
  friendPlayer: one(players, {
    fields: [playerFriends.friendId],
    references: [players.id],
    relationName: 'playerFriends_friend',
  }),
}));

export const joinBeatmapCreatorsRelations = relations(
  joinBeatmapCreators,
  ({ one }) => ({
    beatmap: one(beatmaps, {
      fields: [joinBeatmapCreators.createdBeatmapsId],
      references: [beatmaps.id],
    }),
    player: one(players, {
      fields: [joinBeatmapCreators.creatorsId],
      references: [players.id],
    }),
  })
);

export const joinPooledBeatmapsRelations = relations(
  joinPooledBeatmaps,
  ({ one }) => ({
    beatmap: one(beatmaps, {
      fields: [joinPooledBeatmaps.pooledBeatmapsId],
      references: [beatmaps.id],
    }),
    tournament: one(tournaments, {
      fields: [joinPooledBeatmaps.tournamentsPooledInId],
      references: [tournaments.id],
    }),
  })
);

export const dataReportsRelations = relations(dataReports, ({ one }) => ({
  reporter: one(users, {
    fields: [dataReports.reporterUserId],
    references: [users.id],
    relationName: 'dataReports_reporterUserId_users_id',
  }),
  resolvedBy: one(users, {
    fields: [dataReports.resolvedByUserId],
    references: [users.id],
    relationName: 'dataReports_resolvedByUserId_users_id',
  }),
}));
