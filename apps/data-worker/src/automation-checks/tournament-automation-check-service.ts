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

  /**
   * Checks the tournament and saves the statuses whose result changed.
   *
   * The read and the save share one repeatable-read transaction, so the
   * database refuses to save over a row someone else changed since the read.
   * The checks then read the tournament again and rerun at once, up to
   * {@link MAX_CHECK_RUNS} runs in all, before the error goes to the job's
   * retry.
   */
  async processAutomationChecks(
    tournamentId: number,
    overrideVerifiedState = false
  ): Promise<boolean> {
    for (let run = 1; ; run++) {
      try {
        const outcome = await this.db.transaction(
          (tx) => this.checkTournament(tx, tournamentId, overrideVerifiedState),
          { isolationLevel: 'repeatable read' }
        );

        if (outcome.report) {
          this.logger.info(outcome.report);
        }

        return outcome.passed;
      } catch (error) {
        if (run >= MAX_CHECK_RUNS || !isConcurrentWriteConflict(error)) {
          throw error;
        }

        this.logger.info(
          'Tournament changed during its automation checks; checking it again',
          { tournamentId, run }
        );
      }
    }
  }

  private async checkTournament(
    tx: Transaction,
    tournamentId: number,
    overrideVerifiedState: boolean
  ): Promise<{ passed: boolean; report: string | null }> {
    const row = await tx.query.tournaments.findFirst({
      where: eq(schema.tournaments.id, tournamentId),
      columns: {
        id: true,
        abbreviation: true,
        ruleset: true,
        lobbySize: true,
        verificationStatus: true,
        rejectionReason: true,
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
      return { passed: false, report: null };
    }

    const tournament = mapTournament(row as unknown as TournamentRow);
    const asRead = structuredClone(tournament);
    const beforeStatus = tournament.verificationStatus;

    if (tournament.verificationStatus !== VerificationStatus.Verified) {
      for (const match of tournament.matches) {
        this.matchChecks.performHeadToHeadConversion(match, tournament);
      }
    }

    if (tournament.verificationStatus === VerificationStatus.Rejected) {
      cascadeTournamentRejection(tournament.matches);
    }

    if (shouldSkipAutomation(tournament, overrideVerifiedState)) {
      this.logger.info('Skipping automation checks for tournament', {
        tournamentId,
        verificationStatus: tournament.verificationStatus,
      });

      await this.saveChangedRows(tx, asRead, tournament);
      return {
        passed: tournament.verificationStatus === VerificationStatus.Verified,
        report: null,
      };
    }

    if (overrideVerifiedState) {
      resetTournamentVerification(tournament);
    }

    for (const match of tournament.matches) {
      resetVerificationState(match, overrideVerifiedState);
    }

    // The scores of a game an admin decided are checked too, apart from the
    // ones an admin decided. Skipping them left the scores the reset above
    // cleared with no status.
    for (const match of tournament.matches) {
      for (const game of match.games) {
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

    await this.saveChangedRows(tx, asRead, tournament);

    return {
      passed: tournament.rejectionReason === TournamentRejectionReason.None,
      report: generateTournamentProcessingReport(processingState),
    };
  }

  /**
   * Saves the columns the checks own, for each row where they differ from
   * `asRead`. A row the checks left as it was is not written, so a change
   * someone else saved to it stands.
   */
  private async saveChangedRows(
    tx: Transaction,
    asRead: AutomationTournament,
    checked: AutomationTournament
  ) {
    const nowIso = new Date().toISOString();
    const changes = changedRows(asRead, checked);

    if (changes.tournament) {
      await tx
        .update(schema.tournaments)
        .set({ ...changes.tournament, updated: nowIso })
        .where(eq(schema.tournaments.id, checked.id));
    }

    for (const { id, values } of changes.matches) {
      await tx
        .update(schema.matches)
        .set({ ...values, updated: nowIso })
        .where(eq(schema.matches.id, id));
    }

    for (const { id, values } of changes.games) {
      await tx
        .update(schema.games)
        .set({ ...values, updated: nowIso })
        .where(eq(schema.games.id, id));
    }

    for (const { id, values } of changes.scores) {
      await tx
        .update(schema.gameScores)
        .set({ ...values, updated: nowIso })
        .where(eq(schema.gameScores.id, id));
    }

    this.logger.info('Persisted tournament automation state', {
      tournamentId: checked.id,
      previousStatus: asRead.verificationStatus,
      currentStatus: checked.verificationStatus,
      changedMatches: changes.matches.length,
      changedGames: changes.games.length,
      changedScores: changes.scores.length,
    });
  }
}

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * How many times a check runs when each run meets another transaction's
 * write, before its error goes to the job's retry and backoff.
 */
export const MAX_CHECK_RUNS = 5;

/**
 * Serialization failures and deadlocks. Drizzle wraps the driver's error, so
 * this walks the cause chain.
 */
const isConcurrentWriteConflict = (error: unknown) => {
  for (let current = error; current;) {
    if (typeof current !== 'object') {
      return false;
    }

    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === '40001' || code === '40P01') {
      return true;
    }

    current = cause;
  }

  return false;
};

type RowChange<T> = { id: number; values: Partial<T> };

/** The columns each row's checks own, and so may write. */
const TOURNAMENT_COLUMNS = ['verificationStatus', 'rejectionReason'] as const;
const MATCH_COLUMNS = [
  'verificationStatus',
  'rejectionReason',
  'warningFlags',
] as const;
const GAME_COLUMNS = [
  'teamType',
  'verificationStatus',
  'rejectionReason',
  'warningFlags',
] as const;
const SCORE_COLUMNS = [
  'team',
  'verificationStatus',
  'rejectionReason',
] as const;

const changedColumns = <T, K extends keyof T>(
  before: T | undefined,
  after: T,
  columns: readonly K[]
): Partial<Pick<T, K>> | null => {
  const values: Partial<Pick<T, K>> = {};
  let changed = false;

  for (const column of columns) {
    if (before?.[column] !== after[column]) {
      values[column] = after[column];
      changed = true;
    }
  }

  return changed ? values : null;
};

/** The owned columns of each row that differ between the two copies. */
const changedRows = (
  asRead: AutomationTournament,
  checked: AutomationTournament
) => {
  const readMatches = new Map(asRead.matches.map((m) => [m.id, m]));
  const readGames = new Map(
    asRead.matches.flatMap((m) => m.games).map((g) => [g.id, g])
  );
  const readScores = new Map(
    asRead.matches
      .flatMap((m) => m.games)
      .flatMap((g) => g.scores)
      .map((s) => [s.id, s])
  );

  const matches: RowChange<AutomationMatch>[] = [];
  const games: RowChange<AutomationGame>[] = [];
  const scores: RowChange<AutomationScore>[] = [];

  for (const match of checked.matches) {
    const matchValues = changedColumns(
      readMatches.get(match.id),
      match,
      MATCH_COLUMNS
    );
    if (matchValues) {
      matches.push({ id: match.id, values: matchValues });
    }

    for (const game of match.games) {
      const gameValues = changedColumns(
        readGames.get(game.id),
        game,
        GAME_COLUMNS
      );
      if (gameValues) {
        games.push({ id: game.id, values: gameValues });
      }

      for (const score of game.scores) {
        const scoreValues = changedColumns(
          readScores.get(score.id),
          score,
          SCORE_COLUMNS
        );
        if (scoreValues) {
          scores.push({ id: score.id, values: scoreValues });
        }
      }
    }
  }

  return {
    tournament: changedColumns(asRead, checked, TOURNAMENT_COLUMNS),
    matches,
    games,
    scores,
  };
};

const mapTournament = (row: TournamentRow): AutomationTournament => ({
  id: row.id,
  abbreviation: row.abbreviation,
  ruleset: row.ruleset as Ruleset,
  lobbySize: row.lobbySize,
  verificationStatus: row.verificationStatus as VerificationStatus,
  rejectionReason: row.rejectionReason as TournamentRejectionReason,
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
