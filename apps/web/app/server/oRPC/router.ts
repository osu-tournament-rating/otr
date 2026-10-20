import { os } from '@orpc/server';

import {
  getLeaderboard,
  getLeaderboardFriends,
} from './procedures/leaderboardProcedures';
import { getMatch, getMatchMerge } from './procedures/matchesProcedures';
import {
  deleteGameAdmin,
  lookupGamesAdmin,
  mergeGameAdmin,
  updateGameAdmin,
} from './procedures/games/adminProcedures';
import {
  deleteMatchAdmin,
  deleteMatchPlayerScoresAdmin,
  mergeMatchAdmin,
  updateMatchAdmin,
} from './procedures/matches/adminProcedures';
import {
  deleteScoreAdmin,
  updateScoreAdmin,
} from './procedures/scores/adminProcedures';
import {
  getPlayer,
  getPlayerBeatmaps,
  getPlayerStats,
  getPlayerTournamentHistory,
  getPlayerTournaments,
} from './procedures/playerProcedures';
import { getPlayerRatings } from './procedures/playerRatingsProcedures';
import { lookupPlayers } from './procedures/players/lookupProcedures';
import { getBeatmapStats } from './procedures/beatmapProcedures';
import { listBeatmaps } from './procedures/beatmapListProcedures';
import { updateBeatmapAdmin } from './procedures/beatmaps/adminProcedures';
import { searchEntities } from './procedures/searchProcedures';
import {
  deleteMyAccount,
  deleteMyFriends,
  getCurrentUser,
  getUser,
  getUserSettings,
  updateUserSettings,
} from './procedures/userProcedures';
import {
  banUserAdmin,
  listUserApiKeysAdmin,
  lookupAuthUserAdmin,
  searchPlayersAdmin,
} from './procedures/users/adminProcedures';
import {
  getTournament,
  listTournaments,
  listTournamentsPage,
} from './procedures/tournamentsProcedures';
import { submitTournament } from './procedures/tournaments/tournamentSubmissionProcedure';
import {
  acceptTournamentPreVerificationStatuses,
  deleteTournamentAdmin,
  deleteTournamentBeatmapsAdmin,
  refetchTournamentBeatmaps,
  refetchTournamentMatchData,
  resetTournamentAutomatedChecks,
  updateTournamentAdmin,
} from './procedures/tournaments/adminProcedures';
import { manageTournamentBeatmapsAdmin } from './procedures/tournaments/beatmapAdminProcedures';
import { manageTournamentMatchesAdmin } from './procedures/tournaments/matchAdminProcedures';
import {
  createBeatmapAdminNote,
  createGameAdminNote,
  createMatchAdminNote,
  createScoreAdminNote,
  createTournamentAdminNote,
  deleteBeatmapAdminNote,
  deleteGameAdminNote,
  deleteMatchAdminNote,
  deleteScoreAdminNote,
  deleteTournamentAdminNote,
  updateBeatmapAdminNote,
  updateGameAdminNote,
  updateMatchAdminNote,
  updateScoreAdminNote,
  updateTournamentAdminNote,
} from './procedures/adminNotesProcedures';
import { getPlatformStats } from './procedures/statsProcedures';
import {
  getRecentlyVerifiedTournaments,
  getStatsPage,
} from './procedures/stats/statsPageProcedures';
import {
  filterRegistrants,
  getFilterReport,
} from './procedures/filteringProcedures';
import {
  deleteUserApiKey,
  generateUserApiKey,
  getUserApiKeys,
} from './procedures/apiKeyProcedures';
import { massEnqueue } from './procedures/admin/massEnqueueProcedures';
import {
  createReport,
  getMyUnreadReportCount,
  getReport,
  getReportTemplates,
  getUnseenReportCount,
  listMyReports,
  listReports,
  markMyReportViewed,
  markReportsViewed,
  reopenReport,
  resolveReport,
} from './procedures/reports/reportProcedures';
import {
  getAuditEntityName,
  getEntityAuditTimeline,
  getAuditEventFeed,
  getEventDetails,
} from './procedures/auditProcedures';
import {
  getDescendantAuditCounts,
  getDescendantAuditTimeline,
} from './procedures/audit/descendantProcedures';

export interface InitialContext {
  headers: Headers;
}

const base = os.$context<InitialContext>();

export const router = base.router({
  admin: {
    massEnqueue,
  },
  reports: {
    templates: getReportTemplates,
    create: createReport,
    list: listReports,
    get: getReport,
    resolve: resolveReport,
    reopen: reopenReport,
    unseenCount: getUnseenReportCount,
    markViewed: markReportsViewed,
    listMine: listMyReports,
    markMineViewed: markMyReportViewed,
    myUnreadCount: getMyUnreadReportCount,
  },
  user: {
    get: getUser,
  },
  users: {
    me: getCurrentUser,
    deleteMe: deleteMyAccount,
    deleteMyFriends: deleteMyFriends,
    getSettings: getUserSettings,
    updateSettings: updateUserSettings,
    admin: {
      search: searchPlayersAdmin,
      lookup: lookupAuthUserAdmin,
      ban: banUserAdmin,
      apiKeys: listUserApiKeysAdmin,
    },
  },
  leaderboard: {
    list: getLeaderboard,
    friends: getLeaderboardFriends,
  },
  search: {
    query: searchEntities,
  },
  matches: {
    get: getMatch,
    getMerge: getMatchMerge,
    admin: {
      update: updateMatchAdmin,
      delete: deleteMatchAdmin,
      deletePlayerScores: deleteMatchPlayerScoresAdmin,
      merge: mergeMatchAdmin,
    },
    adminNotes: {
      create: createMatchAdminNote,
      update: updateMatchAdminNote,
      delete: deleteMatchAdminNote,
    },
  },
  games: {
    admin: {
      update: updateGameAdmin,
      delete: deleteGameAdmin,
      merge: mergeGameAdmin,
      lookup: lookupGamesAdmin,
    },
    adminNotes: {
      create: createGameAdminNote,
      update: updateGameAdminNote,
      delete: deleteGameAdminNote,
    },
  },
  scores: {
    admin: {
      update: updateScoreAdmin,
      delete: deleteScoreAdmin,
    },
    adminNotes: {
      create: createScoreAdminNote,
      update: updateScoreAdminNote,
      delete: deleteScoreAdminNote,
    },
  },
  players: {
    get: getPlayer,
    beatmaps: getPlayerBeatmaps,
    stats: getPlayerStats,
    tournaments: getPlayerTournaments,
    tournamentHistory: getPlayerTournamentHistory,
    ratings: getPlayerRatings,
    lookup: lookupPlayers,
  },
  beatmaps: {
    list: listBeatmaps,
    stats: getBeatmapStats,
    admin: {
      update: updateBeatmapAdmin,
    },
    adminNotes: {
      create: createBeatmapAdminNote,
      update: updateBeatmapAdminNote,
      delete: deleteBeatmapAdminNote,
    },
  },
  stats: {
    platform: getPlatformStats,
    page: getStatsPage,
    recentlyVerified: getRecentlyVerifiedTournaments,
  },
  filtering: {
    filter: filterRegistrants,
    report: getFilterReport,
  },
  apiClients: {
    getKeys: getUserApiKeys,
    generateKey: generateUserApiKey,
    deleteKey: deleteUserApiKey,
  },
  audit: {
    timeline: getEntityAuditTimeline,
    events: getAuditEventFeed,
    eventDetails: getEventDetails,
    descendants: getDescendantAuditTimeline,
    descendantCounts: getDescendantAuditCounts,
    entityName: getAuditEntityName,
  },
  tournaments: {
    list: listTournaments,
    listPage: listTournamentsPage,
    get: getTournament,
    submit: submitTournament,
    adminNotes: {
      create: createTournamentAdminNote,
      update: updateTournamentAdminNote,
      delete: deleteTournamentAdminNote,
    },
    admin: {
      update: updateTournamentAdmin,
      resetAutomatedChecks: resetTournamentAutomatedChecks,
      acceptPreVerificationStatuses: acceptTournamentPreVerificationStatuses,
      delete: deleteTournamentAdmin,
      manageBeatmaps: manageTournamentBeatmapsAdmin,
      manageMatches: manageTournamentMatchesAdmin,
      deleteBeatmaps: deleteTournamentBeatmapsAdmin,
      refetchMatchData: refetchTournamentMatchData,
      refetchBeatmaps: refetchTournamentBeatmaps,
    },
  },
});

export type Router = typeof router;
