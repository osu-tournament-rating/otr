import {
  GameRejectionReason,
  GameWarningFlags,
  ScoringType,
  TeamType,
} from '@otr/core/osu';

import type { AutomationGame, AutomationTournament } from './types';
import { gameHasQualifiedRoster } from './rosters-helper';
import {
  addGameRejection,
  addWarningFlag,
  hasInvalidMods,
  isPlaceholderDate,
  isPreVerifiedOrVerified,
} from './utils';

const VALID_TEAM_TYPES = [TeamType.TeamVs];
const VALID_SCORING_TYPES = [ScoringType.ScoreV2, ScoringType.Lazer];

export interface GameAutomationChecksOptions {
  logger?: {
    trace(message: string, context?: Record<string, unknown>): void;
  };
}

export class GameAutomationChecks {
  private readonly logger?: GameAutomationChecksOptions['logger'];

  constructor(options: GameAutomationChecksOptions = {}) {
    this.logger = options.logger;
  }

  process(
    game: AutomationGame,
    tournament: AutomationTournament
  ): GameRejectionReason {
    let rejection = GameRejectionReason.None;

    game.warningFlags = GameWarningFlags.None;

    rejection = addGameRejection(
      rejection,
      this.checkBeatmapUsage(game, tournament)
    );

    rejection = addGameRejection(rejection, this.checkEndTime(game));

    rejection = addGameRejection(rejection, this.checkMods(game));

    rejection = addGameRejection(
      rejection,
      this.checkRuleset(game, tournament)
    );

    rejection = addGameRejection(
      rejection,
      this.checkScoreCounts(game, tournament)
    );

    rejection = addGameRejection(rejection, this.checkScoringType(game));

    rejection = addGameRejection(rejection, this.checkTeamType(game));

    return rejection;
  }

  private checkTeamType(game: AutomationGame): GameRejectionReason {
    if (VALID_TEAM_TYPES.includes(game.teamType)) {
      return GameRejectionReason.None;
    }

    this.logger?.trace('Game automation check: invalid team type', {
      gameId: game.id,
      teamType: game.teamType,
    });
    return GameRejectionReason.InvalidTeamType;
  }

  private checkScoringType(game: AutomationGame): GameRejectionReason {
    if (VALID_SCORING_TYPES.includes(game.scoringType)) {
      return GameRejectionReason.None;
    }

    this.logger?.trace('Game automation check: invalid scoring type', {
      gameId: game.id,
      scoringType: game.scoringType,
    });
    return GameRejectionReason.InvalidScoringType;
  }

  private checkScoreCounts(
    game: AutomationGame,
    tournament: AutomationTournament
  ): GameRejectionReason {
    if (game.scores.length === 0) {
      this.logger?.trace('Game automation check: no scores', {
        gameId: game.id,
      });
      return GameRejectionReason.NoScores;
    }

    const validScores = game.scores.filter((score) =>
      isPreVerifiedOrVerified(score.verificationStatus)
    );

    if (validScores.length === 0) {
      this.logger?.trace('Game automation check: no valid scores', {
        gameId: game.id,
      });
      return GameRejectionReason.NoValidScores;
    }

    const evenScoreCount = validScores.length % 2 === 0;
    const lobbyMatches = evenScoreCount
      ? gameHasQualifiedRoster(game, tournament.lobbySize)
      : false;

    if (!lobbyMatches) {
      this.logger?.trace('Game automation check: lobby size mismatch', {
        gameId: game.id,
        validScores: validScores.length,
        lobbySize: tournament.lobbySize,
      });
      return GameRejectionReason.LobbySizeMismatch;
    }

    return GameRejectionReason.None;
  }

  private checkRuleset(
    game: AutomationGame,
    tournament: AutomationTournament
  ): GameRejectionReason {
    if (game.ruleset === tournament.ruleset) {
      return GameRejectionReason.None;
    }

    this.logger?.trace('Game automation check: ruleset mismatch', {
      gameId: game.id,
      gameRuleset: game.ruleset,
      tournamentRuleset: tournament.ruleset,
    });
    return GameRejectionReason.RulesetMismatch;
  }

  private checkMods(game: AutomationGame): GameRejectionReason {
    if (!hasInvalidMods(game.mods, game.lazerMods)) {
      return GameRejectionReason.None;
    }

    this.logger?.trace('Game automation check: invalid mods', {
      gameId: game.id,
      mods: game.mods,
      lazerMods: game.lazerMods,
    });
    return GameRejectionReason.InvalidMods;
  }

  private checkEndTime(game: AutomationGame): GameRejectionReason {
    if (!isPlaceholderDate(game.endTime)) {
      return GameRejectionReason.None;
    }

    this.logger?.trace('Game automation check: missing end time', {
      gameId: game.id,
      endTime: game.endTime,
    });
    return GameRejectionReason.NoEndTime;
  }

  private checkBeatmapUsage(
    game: AutomationGame,
    tournament: AutomationTournament
  ): GameRejectionReason {
    if (!game.beatmap) {
      return GameRejectionReason.None;
    }

    const pool = new Set(
      tournament.pooledBeatmaps.map((beatmap) => beatmap.osuId)
    );

    if (pool.size > 0) {
      if (!pool.has(game.beatmap.osuId)) {
        this.logger?.trace('Game automation check: beatmap not in pool', {
          gameId: game.id,
          beatmapId: game.beatmap.osuId,
        });
        return GameRejectionReason.BeatmapNotPooled;
      }

      return GameRejectionReason.None;
    }

    const occurrences = tournament.matches
      .flatMap((match) => match.games)
      .filter(
        (otherGame) => otherGame.beatmap?.osuId === game.beatmap?.osuId
      ).length;

    if (occurrences === 1) {
      game.warningFlags = addWarningFlag(
        game.warningFlags,
        GameWarningFlags.BeatmapUsedOnce
      );
      this.logger?.trace('Game automation check: beatmap used once', {
        gameId: game.id,
        beatmapId: game.beatmap.osuId,
      });
    }

    return GameRejectionReason.None;
  }
}
