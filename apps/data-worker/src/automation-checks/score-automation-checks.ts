import { Ruleset, ScoreRejectionReason } from '@otr/core/osu';

import type { AutomationScore } from './types';
import { combineRejection, hasInvalidMods } from './utils';

const SCORE_MINIMUM = 1000;

export interface ScoreAutomationChecksOptions {
  logger?: {
    trace(message: string, context?: Record<string, unknown>): void;
  };
}

export class ScoreAutomationChecks {
  private readonly logger?: ScoreAutomationChecksOptions['logger'];

  constructor(options: ScoreAutomationChecksOptions = {}) {
    this.logger = options.logger;
  }

  process(
    score: AutomationScore,
    tournamentRuleset: Ruleset
  ): ScoreRejectionReason {
    let rejection = ScoreRejectionReason.None;

    if (score.score <= SCORE_MINIMUM) {
      rejection = combineRejection(
        rejection,
        ScoreRejectionReason.ScoreBelowMinimum
      );
      this.logger?.trace('Score automation check: below minimum', {
        scoreId: score.id,
        score: score.score,
      });
    }

    if (hasInvalidMods(score.mods, score.lazerMods)) {
      rejection = combineRejection(rejection, ScoreRejectionReason.InvalidMods);
      this.logger?.trace('Score automation check: invalid mods', {
        scoreId: score.id,
        mods: score.mods,
        lazerMods: score.lazerMods,
      });
    }

    if (score.ruleset !== tournamentRuleset) {
      rejection = combineRejection(
        rejection,
        ScoreRejectionReason.RulesetMismatch
      );
      this.logger?.trace('Score automation check: ruleset mismatch', {
        scoreId: score.id,
        scoreRuleset: score.ruleset,
        tournamentRuleset,
      });
    }

    return rejection;
  }
}
