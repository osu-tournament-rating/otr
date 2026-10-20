import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import type { LazerMod } from '@otr/core/osu/lazer-mods';
import {
  GameRejectionReason,
  MatchRejectionReason,
  TournamentRejectionReason,
  VerificationStatus,
  GameWarningFlags,
  MatchWarningFlags,
  Ruleset,
  ScoringType,
  TeamType,
  Team,
  Mods,
  ScoreRejectionReason,
} from '@otr/core/osu';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';
import type {
  AutomationGame,
  AutomationMatch,
  AutomationScore,
  AutomationTournament,
} from './types';
import {
  GameAutomationChecks,
  MatchAutomationChecks,
  ScoreAutomationChecks,
  TournamentAutomationChecks,
} from './index';
import {
  applyGameAutomationResult,
  applyMatchAutomationResult,
  applyScoreAutomationResult,
  captureTournamentProcessingState,
  cascadeTournamentRejection,
  determinePostTournamentStatus,
  isLockedVerificationStatus,
  resetTournamentVerification,
  resetVerificationState,
  shouldSkipAutomation,
  generateTournamentProcessingReport,
} from './tournament-processing-reporter';

interface TournamentAutomationCheckServiceOptions {
  db: DatabaseClient;
  logger: Logger;
  tournamentChecks: TournamentAutomationChecks;
  matchChecks: MatchAutomationChecks;
  gameChecks: GameAutomationChecks;
  scoreChecks: ScoreAutomationChecks;
}

type BeatmapRow = {
  id: number;
  osuId: number;
};

type ScoreRow = {
  id: number;
  score: number;
  mods: number;
  lazerMods: LazerMod[] | null;
  team: number;
  ruleset: number;
  verificationStatus: number;
  rejectionReason: number;
  playerId: number;
  gameId: number;
};

type GameRosterRow = {
  id: number;
  gameId: number;
  team: number;
  roster: number[];
  score: number;
};

type GameRow = {
  id: number;
  osuId: number;
  matchId: number;
  ruleset: number;
  scoringType: number;
  teamType: number;
  mods: number;
  lazerMods: LazerMod[] | null;
  startTime: string;
  endTime: string;
  verificationStatus: number;
  rejectionReason: number;
  warningFlags: number;
  gameScores: ScoreRow[];
  gameRosters: GameRosterRow[];
  beatmap: BeatmapRow | null;
};

type MatchRosterRow = {
  id: number;
  matchId: number;
  team: number;
  roster: number[];
  score: number;
};

type MatchRow = {
  id: number;
  name: string;
  startTime: string | null;
  endTime: string | null;
  verificationStatus: number;
  rejectionReason: number;
  warningFlags: number;
  games: GameRow[];
  matchRosters: MatchRosterRow[];
};

export type TournamentRow = {
  id: number;
  abbreviation: string;
  ruleset: number;
  lobbySize: number;
  verificationStatus: number;
  rejectionReason: number;
  verifiedByUserId?: number | null;
  matches: MatchRow[];
  joinPooledBeatmaps: Array<{ beatmap: BeatmapRow | null }>;
};

export class TournamentAutomationCheckService {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly tournamentChecks: TournamentAutomationChecks;
  private readonly matchChecks: MatchAutomationChecks;
  private readonly gameChecks: GameAutomationChecks;
  private readonly scoreChecks: ScoreAutomationChecks;

  constructor(options: TournamentAutomationCheckServiceOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.tournamentChecks = options.tournamentChecks;
    this.matchChecks = options.matchChecks;
    this.gameChecks = options.gameChecks;
    this.scoreChecks = options.scoreChecks;
  }

  async processAutomationChecks(
    tournamentId: number,
    overrideVerifiedState = false
  ): Promise<boolean> {
    const row = await this.db.query.tournaments.findFirst({
      where: eq(schema.tournaments.id, tournamentId),
      columns: {
        id: true,
        abbreviation: true,
        ruleset: true,
        lobbySize: true,
        verificationStatus: true,
        rejectionReason: true,
        verifiedByUserId: true,
      },
      with: {
        matches: {
          columns: {
            id: true,
            name: true,
            startTime: true,
            endTime: true,
            verificationStatus: true,
            rejectionReason: true,
            warningFlags: true,
          },
          with: {
            games: {
              columns: {
                id: true,
                osuId: true,
                ruleset: true,
                scoringType: true,
                teamType: true,
                mods: true,
                lazerMods: true,
                startTime: true,
                endTime: true,
                verificationStatus: true,
                rejectionReason: true,
                warningFlags: true,
                matchId: true,
              },
              with: {
                gameScores: {
                  columns: {
                    id: true,
                    score: true,
                    mods: true,
                    lazerMods: true,
                    team: true,
                    ruleset: true,
                    verificationStatus: true,
                    rejectionReason: true,
                    playerId: true,
                    gameId: true,
                  },
                },
                gameRosters: {
                  columns: {
                    id: true,
                    gameId: true,
                    team: true,
                    roster: true,
                    score: true,
                  },
                },
                beatmap: {
                  columns: {
                    id: true,
                    osuId: true,
                  },
                },
              },
            },
            matchRosters: {
              columns: {
                id: true,
                matchId: true,
                team: true,
                roster: true,
                score: true,
              },
            },
          },
        },
        joinPooledBeatmaps: {
          columns: {
            pooledBeatmapsId: true,
          },
          with: {
            beatmap: {
              columns: {
                id: true,
                osuId: true,
              },
            },
          },
        },
      },
    });

    if (!row) {
      this.logger.warn('Tournament not found for automation checks', {
        tournamentId,
      });
      return false;
    }

    const tournament = mapTournament(row as unknown as TournamentRow);
    const beforeStatus = tournament.verificationStatus;

    if (tournament.verificationStatus !== VerificationStatus.Verified) {
      for (const match of tournament.matches) {
        this.matchChecks.performHeadToHeadConversion(match, tournament);
      }
    }

    if (tournament.verificationStatus === VerificationStatus.Rejected) {
      // The admin who rejected the tournament rejects the matches it reaches.
      // An override resets them below, so it credits no one.
      if (!overrideVerifiedState) {
        for (const match of tournament.matches) {
          if (match.verificationStatus !== VerificationStatus.Rejected) {
            match.verifiedByUserId = tournament.verifiedByUserId ?? null;
          }
        }
      }
      cascadeTournamentRejection(tournament.matches);
    }

    if (shouldSkipAutomation(tournament, overrideVerifiedState)) {
      this.logger.info('Skipping automation checks for tournament', {
        tournamentId,
        verificationStatus: tournament.verificationStatus,
      });

      await this.persistTournamentState(tournament, beforeStatus);
      return tournament.verificationStatus === VerificationStatus.Verified;
    }

    if (overrideVerifiedState) {
      resetTournamentVerification(tournament);
    }

    for (const match of tournament.matches) {
      resetVerificationState(match, overrideVerifiedState);
    }

    for (const match of tournament.matches) {
      for (const game of match.games) {
        const skipGameAutomation =
          !overrideVerifiedState &&
          isLockedVerificationStatus(game.verificationStatus);

        if (skipGameAutomation) {
          continue;
        }

        for (const score of game.scores) {
          if (
            !overrideVerifiedState &&
            isLockedVerificationStatus(score.verificationStatus)
          ) {
            continue;
          }

          const scoreRejection = this.scoreChecks.process(
            score,
            tournament.ruleset
          );
          applyScoreAutomationResult(score, scoreRejection);
        }
      }
    }

    for (const match of tournament.matches) {
      for (const game of match.games) {
        if (
          !overrideVerifiedState &&
          isLockedVerificationStatus(game.verificationStatus)
        ) {
          continue;
        }

        const gameRejection = this.gameChecks.process(game, tournament);
        applyGameAutomationResult(game, gameRejection);
      }
    }

    for (const match of tournament.matches) {
      if (
        !overrideVerifiedState &&
        isLockedVerificationStatus(match.verificationStatus)
      ) {
        continue;
      }

      const matchRejection = this.matchChecks.process(match, tournament);
      applyMatchAutomationResult(match, matchRejection);
    }

    const tournamentRejectionReason = this.tournamentChecks.process(tournament);
    tournament.verificationStatus = determinePostTournamentStatus(
      tournamentRejectionReason
    );
    tournament.rejectionReason = tournamentRejectionReason;

    const processingState = captureTournamentProcessingState(
      tournament,
      beforeStatus
    );

    await this.persistTournamentState(tournament, beforeStatus);

    const report = generateTournamentProcessingReport(processingState);
    this.logger.info(report);

    return tournament.rejectionReason === TournamentRejectionReason.None;
  }

  private async persistTournamentState(
    tournament: AutomationTournament,
    beforeStatus: VerificationStatus
  ) {
    const nowIso = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.tournaments)
        .set({
          verificationStatus: tournament.verificationStatus,
          rejectionReason: tournament.rejectionReason,
          updated: nowIso,
        })
        .where(eq(schema.tournaments.id, tournament.id));

      for (const match of tournament.matches) {
        await tx
          .update(schema.matches)
          .set({
            verificationStatus: match.verificationStatus,
            rejectionReason: match.rejectionReason,
            warningFlags: match.warningFlags,
            verifiedByUserId: match.verifiedByUserId,
            updated: nowIso,
          })
          .where(eq(schema.matches.id, match.id));

        for (const game of match.games) {
          await tx
            .update(schema.games)
            .set({
              teamType: game.teamType,
              verificationStatus: game.verificationStatus,
              rejectionReason: game.rejectionReason,
              warningFlags: game.warningFlags,
              updated: nowIso,
            })
            .where(eq(schema.games.id, game.id));

          for (const score of game.scores) {
            await tx
              .update(schema.gameScores)
              .set({
                team: score.team,
                verificationStatus: score.verificationStatus,
                rejectionReason: score.rejectionReason,
                updated: nowIso,
              })
              .where(eq(schema.gameScores.id, score.id));
          }
        }
      }
    });

    this.logger.info('Persisted tournament automation state', {
      tournamentId: tournament.id,
      previousStatus: beforeStatus,
      currentStatus: tournament.verificationStatus,
    });
  }
}

const mapTournament = (row: TournamentRow): AutomationTournament => ({
  id: row.id,
  abbreviation: row.abbreviation,
  ruleset: row.ruleset as Ruleset,
  lobbySize: row.lobbySize,
  verificationStatus: row.verificationStatus as VerificationStatus,
  rejectionReason: row.rejectionReason as TournamentRejectionReason,
  verifiedByUserId: row.verifiedByUserId ?? null,
  matches: row.matches.map(mapMatch),
  pooledBeatmaps: row.joinPooledBeatmaps
    .map((entry) => entry.beatmap)
    .filter((beatmap): beatmap is BeatmapRow => beatmap != null)
    .map((beatmap) => ({ id: beatmap.id, osuId: beatmap.osuId })),
});

const mapMatch = (match: MatchRow): AutomationMatch => ({
  id: match.id,
  name: match.name,
  startTime: match.startTime,
  endTime: match.endTime,
  verificationStatus: match.verificationStatus as VerificationStatus,
  rejectionReason: match.rejectionReason as MatchRejectionReason,
  warningFlags: match.warningFlags as MatchWarningFlags,
  games: match.games.map(mapGame),
  rosters: match.matchRosters.map(mapMatchRoster),
});

const mapGame = (game: GameRow): AutomationGame => ({
  id: game.id,
  osuId: game.osuId,
  matchId: game.matchId,
  ruleset: game.ruleset as Ruleset,
  scoringType: game.scoringType as ScoringType,
  teamType: game.teamType as TeamType,
  mods: game.mods as Mods,
  lazerMods: game.lazerMods,
  startTime: game.startTime,
  endTime: game.endTime,
  verificationStatus: game.verificationStatus as VerificationStatus,
  rejectionReason: game.rejectionReason as GameRejectionReason,
  warningFlags: game.warningFlags as GameWarningFlags,
  beatmap: game.beatmap
    ? { id: game.beatmap.id, osuId: game.beatmap.osuId }
    : null,
  scores: game.gameScores.map(mapScore),
  rosters: game.gameRosters.map(mapGameRoster),
});

const mapScore = (score: ScoreRow): AutomationScore => ({
  id: score.id,
  score: score.score,
  mods: score.mods as Mods,
  lazerMods: score.lazerMods,
  team: score.team as Team,
  ruleset: score.ruleset as Ruleset,
  verificationStatus: score.verificationStatus as VerificationStatus,
  rejectionReason: score.rejectionReason as ScoreRejectionReason,
  playerId: score.playerId,
  gameId: score.gameId,
});

const mapGameRoster = (
  roster: GameRosterRow
): AutomationGame['rosters'][number] => ({
  id: roster.id,
  gameId: roster.gameId,
  team: roster.team as Team,
  roster: roster.roster,
  score: roster.score,
});

const mapMatchRoster = (
  roster: MatchRosterRow
): AutomationMatch['rosters'][number] => ({
  id: roster.id,
  matchId: roster.matchId,
  team: roster.team as Team,
  roster: roster.roster,
  score: roster.score,
});
