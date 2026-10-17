import {
  GameRejectionReason,
  GameWarningFlags,
  MatchRejectionReason,
  MatchWarningFlags,
  Mods,
  Ruleset,
  ScoreRejectionReason,
  ScoringType,
  Team,
  TeamType,
  TournamentRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';

import type {
  AutomationBeatmap,
  AutomationGame,
  AutomationGameRoster,
  AutomationMatch,
  AutomationMatchRoster,
  AutomationScore,
  AutomationTournament,
} from './types';

let nextId = 1;

const generateId = () => nextId++;

export const resetIds = () => {
  nextId = 1;
};

export const createScore = (
  overrides: Partial<AutomationScore> = {}
): AutomationScore => ({
  id: overrides.id ?? generateId(),
  score: overrides.score ?? 100000,
  mods: overrides.mods ?? Mods.None,
  lazerMods: overrides.lazerMods ?? null,
  team: overrides.team ?? Team.Red,
  ruleset: overrides.ruleset ?? Ruleset.Osu,
  verificationStatus:
    overrides.verificationStatus ?? VerificationStatus.PreVerified,
  rejectionReason: overrides.rejectionReason ?? ScoreRejectionReason.None,
  playerId: overrides.playerId ?? generateId(),
  gameId: overrides.gameId,
});

export const createGameRoster = (
  overrides: Partial<AutomationGameRoster> = {}
): AutomationGameRoster => ({
  id: overrides.id ?? generateId(),
  gameId: overrides.gameId ?? 0,
  team: overrides.team ?? Team.Red,
  roster: overrides.roster ?? [1, 2],
  score: overrides.score ?? 1,
});

export const createGame = (
  overrides: Partial<AutomationGame> = {}
): AutomationGame => {
  const id = overrides.id ?? generateId();
  const game: AutomationGame = {
    id,
    osuId: overrides.osuId ?? 1000 + id,
    matchId: overrides.matchId ?? 0,
    ruleset: overrides.ruleset ?? Ruleset.Osu,
    scoringType: overrides.scoringType ?? ScoringType.ScoreV2,
    teamType: overrides.teamType ?? TeamType.TeamVs,
    mods: overrides.mods ?? Mods.None,
    lazerMods: overrides.lazerMods ?? null,
    startTime:
      overrides.startTime !== undefined
        ? overrides.startTime
        : new Date('2024-01-01T00:00:00Z').toISOString(),
    endTime:
      overrides.endTime !== undefined
        ? overrides.endTime
        : new Date('2024-01-01T01:00:00Z').toISOString(),
    verificationStatus:
      overrides.verificationStatus ?? VerificationStatus.PreVerified,
    rejectionReason: overrides.rejectionReason ?? GameRejectionReason.None,
    warningFlags: overrides.warningFlags ?? GameWarningFlags.None,
    beatmap:
      overrides.beatmap ??
      (overrides.beatmap === null
        ? null
        : {
            id: generateId(),
            osuId: 2000 + id,
          }),
    scores: overrides.scores ?? [
      createScore({ team: Team.Red, playerId: 1, gameId: id }),
      createScore({ team: Team.Red, playerId: 2, gameId: id }),
      createScore({ team: Team.Blue, playerId: 3, gameId: id }),
      createScore({ team: Team.Blue, playerId: 4, gameId: id }),
    ],
    rosters: overrides.rosters ?? [],
  };

  game.scores = game.scores.map((score) => ({
    ...score,
    gameId: score.gameId ?? id,
  }));

  game.rosters = game.rosters.map((roster) => ({ ...roster }));

  return game;
};

export const createMatchRoster = (
  overrides: Partial<AutomationMatchRoster> = {}
): AutomationMatchRoster => ({
  id: overrides.id ?? generateId(),
  matchId: overrides.matchId ?? 0,
  team: overrides.team ?? Team.Red,
  roster: overrides.roster ?? [1, 2],
  score: overrides.score ?? 1,
});

export const createMatch = (
  overrides: Partial<AutomationMatch> = {}
): AutomationMatch => {
  const id = overrides.id ?? generateId();
  const games = overrides.games ?? [createGame({ matchId: id })];
  const match: AutomationMatch = {
    id,
    name: overrides.name ?? `Match ${id}`,
    startTime:
      overrides.startTime !== undefined
        ? overrides.startTime
        : new Date('2024-01-01T00:00:00Z').toISOString(),
    endTime:
      overrides.endTime !== undefined
        ? overrides.endTime
        : new Date('2024-01-01T02:00:00Z').toISOString(),
    verificationStatus:
      overrides.verificationStatus ?? VerificationStatus.PreVerified,
    rejectionReason: overrides.rejectionReason ?? MatchRejectionReason.None,
    warningFlags: overrides.warningFlags ?? MatchWarningFlags.None,
    games,
    rosters: overrides.rosters ?? [],
  };

  match.games = match.games.map((game) => ({
    ...game,
    matchId: match.id,
  }));

  match.rosters = match.rosters.map((roster) => ({ ...roster, matchId: id }));

  return match;
};

export const createTournament = (
  overrides: Partial<AutomationTournament> = {}
): AutomationTournament => {
  const id = overrides.id ?? generateId();
  const matches = overrides.matches ?? [createMatch({})];
  const tournament: AutomationTournament = {
    id,
    abbreviation: overrides.abbreviation ?? 'TT',
    ruleset: overrides.ruleset ?? Ruleset.Osu,
    lobbySize: overrides.lobbySize ?? 2,
    verificationStatus: overrides.verificationStatus ?? VerificationStatus.None,
    rejectionReason:
      overrides.rejectionReason ?? TournamentRejectionReason.None,
    matches,
    pooledBeatmaps: overrides.pooledBeatmaps ?? [],
  };

  tournament.matches = tournament.matches.map((match) => ({
    ...match,
  }));

  return tournament;
};

export const createBeatmap = (
  overrides: Partial<AutomationBeatmap> = {}
): AutomationBeatmap => ({
  id: overrides.id ?? generateId(),
  osuId: overrides.osuId ?? 987654,
});

export const cloneTournament = (
  tournament: AutomationTournament
): AutomationTournament => ({
  ...tournament,
  matches: tournament.matches.map((match) => ({
    ...match,
    games: match.games.map((game) => ({
      ...game,
      beatmap: game.beatmap ? { ...game.beatmap } : null,
      scores: game.scores.map((score) => ({ ...score })),
      rosters: game.rosters.map((roster) => ({ ...roster })),
    })),
    rosters: match.rosters.map((roster) => ({ ...roster })),
  })),
  pooledBeatmaps: tournament.pooledBeatmaps.map((beatmap) => ({ ...beatmap })),
});
