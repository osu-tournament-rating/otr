import { beforeEach, describe, expect, it } from 'bun:test';
import {
  GameRejectionReason,
  GameWarningFlags,
  Mods,
  Ruleset,
  ScoringType,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu';

import { GameAutomationChecks } from '../game-automation-checks';
import {
  createBeatmap,
  createGame,
  createMatch,
  createScore,
  createTournament,
  resetIds,
} from '../test-utils';

const checker = new GameAutomationChecks();

describe('GameAutomationChecks', () => {
  beforeEach(() => {
    resetIds();
  });

  it('requires TeamVs team type', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      teamType: TeamType.HeadToHead,
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.InvalidTeamType).not.toBe(0);
  });

  it('requires ScoreV2 scoring', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      scoringType: ScoringType.Score,
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.InvalidScoringType).not.toBe(0);
  });

  it('flags missing scores', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({ scores: [], matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.NoScores).not.toBe(0);
  });

  it('flags when no valid scores remain', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const scores = [
      createScore({ verificationStatus: VerificationStatus.Rejected }),
      createScore({ verificationStatus: VerificationStatus.PreRejected }),
    ];

    const game = createGame({ scores, matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.NoValidScores).not.toBe(0);
  });

  it('flags lobby mismatches', () => {
    const tournament = createTournament({ lobbySize: 3 });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const scores = [
      createScore({ team: Team.Red, playerId: 1 }),
      createScore({ team: Team.Red, playerId: 2 }),
      createScore({ team: Team.Blue, playerId: 3 }),
      createScore({ team: Team.Blue, playerId: 4 }),
    ];

    const game = createGame({ scores, matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.LobbySizeMismatch).not.toBe(0);
  });

  it('passes when lobby counts align', () => {
    const tournament = createTournament({ lobbySize: 2 });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const scores = [
      createScore({ team: Team.Red, playerId: 1 }),
      createScore({ team: Team.Red, playerId: 2 }),
      createScore({ team: Team.Blue, playerId: 3 }),
      createScore({ team: Team.Blue, playerId: 4 }),
    ];

    const game = createGame({ scores, matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result).toBe(GameRejectionReason.None);
  });

  it('flags unbalanced teams', () => {
    const tournament = createTournament({ lobbySize: 2 });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const scores = [
      createScore({ team: Team.Red, playerId: 1 }),
      createScore({ team: Team.Red, playerId: 2 }),
      createScore({ team: Team.Red, playerId: 3 }),
      createScore({ team: Team.Blue, playerId: 4 }),
    ];

    const game = createGame({ scores, matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.LobbySizeMismatch).not.toBe(0);
  });

  it('flags ruleset mismatches', () => {
    const tournament = createTournament({ ruleset: Ruleset.Osu });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      ruleset: Ruleset.Taiko,
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.RulesetMismatch).not.toBe(0);
  });

  it('flags invalid mods', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({ mods: Mods.SuddenDeath, matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.InvalidMods).not.toBe(0);
  });

  it('flags invalid lazer mods', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      lazerMods: [{ acronym: 'AP' }],
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.InvalidMods).not.toBe(0);
  });

  it('accepts lazer fun mods', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      lazerMods: [{ acronym: 'BR' }, { acronym: 'FR' }],
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.InvalidMods).toBe(0);
  });

  it('flags missing end time', () => {
    const tournament = createTournament();
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      endTime: '0001-01-01T00:00:00.000Z',
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.NoEndTime).not.toBe(0);
  });

  it('passes when beatmap is in pool', () => {
    const beatmap = createBeatmap({ osuId: 123 });
    const tournament = createTournament({ pooledBeatmaps: [beatmap] });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({ beatmap, matchId: match.id });

    const result = checker.process(game, tournament);

    expect(result).toBe(GameRejectionReason.None);
  });

  it('flags beatmap not in pool when pool exists', () => {
    const tournament = createTournament({
      pooledBeatmaps: [createBeatmap({ osuId: 456 })],
    });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      beatmap: createBeatmap({ osuId: 123 }),
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.BeatmapNotPooled).not.toBe(0);
  });

  it('sets warning when beatmap used once with no pool', () => {
    const tournament = createTournament({ pooledBeatmaps: [] });
    const match = createMatch({ games: [] });
    const secondaryMatch = createMatch({ games: [] });
    const game = createGame({ matchId: match.id });
    const otherGame = createGame({ matchId: secondaryMatch.id });
    match.games = [game];
    secondaryMatch.games = [otherGame];
    tournament.matches = [match, secondaryMatch];

    const result = checker.process(game, tournament);

    expect(result).toBe(GameRejectionReason.None);
    expect(game.warningFlags & GameWarningFlags.BeatmapUsedOnce).not.toBe(0);
  });

  it('combines multiple rejection reasons', () => {
    const tournament = createTournament({ ruleset: Ruleset.Osu, lobbySize: 4 });
    const match = createMatch({ games: [] });
    tournament.matches = [match];

    const game = createGame({
      teamType: TeamType.HeadToHead,
      scoringType: ScoringType.Accuracy,
      ruleset: Ruleset.Taiko,
      mods: Mods.SuddenDeath,
      endTime: '0001-01-01T00:00:00.000Z',
      scores: [],
      matchId: match.id,
    });

    const result = checker.process(game, tournament);

    expect(result & GameRejectionReason.InvalidTeamType).not.toBe(0);
    expect(result & GameRejectionReason.InvalidScoringType).not.toBe(0);
    expect(result & GameRejectionReason.RulesetMismatch).not.toBe(0);
    expect(result & GameRejectionReason.InvalidMods).not.toBe(0);
    expect(result & GameRejectionReason.NoEndTime).not.toBe(0);
    expect(result & GameRejectionReason.NoScores).not.toBe(0);
  });
});
