import {
  GameRejectionReason,
  MatchRejectionReason,
  MatchWarningFlags,
  TeamType,
} from '@otr/core/osu';

import type { AutomationMatch, AutomationTournament } from './types';
import { ensureMatchRosters, rosterOverlaps } from './rosters-helper';
import {
  addWarningFlag,
  isPlaceholderDate,
  isPreVerifiedOrVerified,
} from './utils';

export interface MatchAutomationChecksOptions {
  logger?: {
    trace(message: string, context?: Record<string, unknown>): void;
  };
}

export class MatchAutomationChecks {
  private readonly logger?: MatchAutomationChecksOptions['logger'];

  constructor(options: MatchAutomationChecksOptions = {}) {
    this.logger = options.logger;
  }

  process(
    match: AutomationMatch,
    tournament: AutomationTournament
  ): MatchRejectionReason {
    match.warningFlags = MatchWarningFlags.None;

    this.applyBeatmapWarning(match);
    this.applyNameFormatWarning(match);
    this.checkRosterIntegrity(match);

    let rejection = MatchRejectionReason.None;

    rejection |= this.checkEndTime(match);
    rejection |= this.checkGameCounts(match);
    rejection |= this.checkNamePrefix(match, tournament);

    if (
      rejection !== MatchRejectionReason.None ||
      match.warningFlags !== MatchWarningFlags.None
    ) {
      this.logger?.trace('Match automation processed', {
        matchId: match.id,
        rejection,
        warningFlags: match.warningFlags,
      });
    }

    return rejection;
  }

  private checkEndTime(match: AutomationMatch): MatchRejectionReason {
    if (!match.endTime || isPlaceholderDate(match.endTime)) {
      this.logger?.trace('Match automation check: missing end time', {
        matchId: match.id,
        endTime: match.endTime,
      });
      return MatchRejectionReason.NoEndTime;
    }

    return MatchRejectionReason.None;
  }

  private checkGameCounts(match: AutomationMatch): MatchRejectionReason {
    if (match.games.length === 0) {
      this.logger?.trace('Match automation check: no games', {
        matchId: match.id,
      });
      return MatchRejectionReason.NoGames;
    }

    const validGames = match.games.filter((game) =>
      isPreVerifiedOrVerified(game.verificationStatus)
    );

    if (validGames.length === 0) {
      this.logger?.trace('Match automation check: no valid games', {
        matchId: match.id,
      });
      return MatchRejectionReason.NoValidGames;
    }

    if (validGames.length < 3) {
      this.logger?.trace('Match automation check: unexpected game count', {
        matchId: match.id,
        validGames: validGames.length,
      });
      return MatchRejectionReason.UnexpectedGameCount;
    }

    if (validGames.length === 3 || validGames.length === 4) {
      match.warningFlags = addWarningFlag(
        match.warningFlags,
        MatchWarningFlags.LowGameCount
      );
    }

    return MatchRejectionReason.None;
  }

  private checkNamePrefix(
    match: AutomationMatch,
    tournament: AutomationTournament
  ): MatchRejectionReason {
    if (
      match.name.toLowerCase().startsWith(tournament.abbreviation.toLowerCase())
    ) {
      return MatchRejectionReason.None;
    }

    this.logger?.trace('Match automation check: name prefix mismatch', {
      matchId: match.id,
      matchName: match.name,
      abbreviation: tournament.abbreviation,
    });

    return MatchRejectionReason.NamePrefixMismatch;
  }

  private applyBeatmapWarning(match: AutomationMatch) {
    const unpooledBeatmapIds = new Set<number>();

    for (const game of match.games) {
      if (
        (game.rejectionReason & GameRejectionReason.BeatmapNotPooled) ===
          GameRejectionReason.BeatmapNotPooled &&
        game.beatmap
      ) {
        unpooledBeatmapIds.add(game.beatmap.osuId);
      }
    }

    if (unpooledBeatmapIds.size > 2) {
      match.warningFlags = addWarningFlag(
        match.warningFlags,
        MatchWarningFlags.UnexpectedBeatmapsFound
      );
    }
  }

  private applyNameFormatWarning(match: AutomationMatch) {
    const matchesPattern = MATCH_NAME_PATTERNS.some((pattern) =>
      pattern.test(match.name)
    );

    if (!matchesPattern) {
      match.warningFlags = addWarningFlag(
        match.warningFlags,
        MatchWarningFlags.UnexpectedNameFormat
      );
    }
  }

  /**
   * Warns when a player played for more than one team. Head-to-head games
   * are left out: each player there is a side of their own, so no player can
   * be on two of them.
   */
  private checkRosterIntegrity(match: AutomationMatch) {
    const validGames = match.games.filter(
      (game) =>
        isPreVerifiedOrVerified(game.verificationStatus) &&
        game.teamType !== TeamType.HeadToHead
    );

    const rosters = ensureMatchRosters({ ...match, games: validGames });

    if (rosterOverlaps(rosters)) {
      match.warningFlags = addWarningFlag(
        match.warningFlags,
        MatchWarningFlags.OverlappingRosters
      );
    }
  }
}

export const MATCH_NAME_PATTERNS = [/^.*(\(.+\)\s*vs\.?\s*\(.+\)).*$/i];
