import { beforeEach, describe, expect, it } from 'bun:test';
import {
  GameRejectionReason,
  MatchRejectionReason,
  MatchWarningFlags,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu';

import { MatchAutomationChecks } from '../match-automation-checks';
import {
  createGame,
  createMatch,
  createScore,
  createTournament,
  resetIds,
} from '../test-utils';

const checker = new MatchAutomationChecks();

describe('MatchAutomationChecks', () => {
  beforeEach(() => {
    resetIds();
  });

  it('flags matches without end time', () => {
    const match = createMatch({
      endTime: null,
      games: [createGame({})],
    });
    const tournament = createTournament({ matches: [match] });

    const result = checker.process(match, tournament);

    expect(result & MatchRejectionReason.NoEndTime).not.toBe(0);
  });

  it('flags matches with no games', () => {
    const match = createMatch({ games: [] });
    const tournament = createTournament({ matches: [match] });

    const result = checker.process(match, tournament);

    expect(result & MatchRejectionReason.NoGames).not.toBe(0);
  });

  it('flags matches with no valid games', () => {
    const game = createGame({
      verificationStatus: VerificationStatus.Rejected,
    });
    const match = createMatch({ games: [game] });
    const tournament = createTournament({ matches: [match] });

    const result = checker.process(match, tournament);

    expect(result & MatchRejectionReason.NoValidGames).not.toBe(0);
  });

  it('rejects a match with fewer than three valid games', () => {
    for (const count of [1, 2]) {
      const games = Array.from({ length: count }, () => createGame({}));
      const match = createMatch({ games, name: 'TT: Qualified Match' });
      const tournament = createTournament({ matches: [match] });

      expect(checker.process(match, tournament)).toBe(
        MatchRejectionReason.UnexpectedGameCount
      );
    }
  });

  it('counts only valid games toward the game count', () => {
    const games = [
      createGame({}),
      createGame({}),
      createGame({ verificationStatus: VerificationStatus.PreRejected }),
      createGame({ verificationStatus: VerificationStatus.Rejected }),
    ];
    const match = createMatch({ games, name: 'TT: Qualified Match' });
    const tournament = createTournament({ matches: [match] });

    expect(checker.process(match, tournament)).toBe(
      MatchRejectionReason.UnexpectedGameCount
    );
  });

  it('applies warning when few games are valid', () => {
    const games = [createGame({}), createGame({}), createGame({})];
    const match = createMatch({ games, name: 'TT: Qualified Match' });
    const tournament = createTournament({ matches: [match] });

    const result = checker.process(match, tournament);

    expect(result).toBe(MatchRejectionReason.None);
    expect(match.warningFlags & MatchWarningFlags.LowGameCount).not.toBe(0);
  });

  it('flags name prefix mismatches', () => {
    const match = createMatch({ name: 'ABC: Something' });
    const tournament = createTournament({
      abbreviation: 'DEF',
      matches: [match],
    });

    const result = checker.process(match, tournament);

    expect(result & MatchRejectionReason.NamePrefixMismatch).not.toBe(0);
  });

  it('sets warning for unexpected name formats', () => {
    const match = createMatch({ name: 'Random Lobby Name' });
    const tournament = createTournament({ matches: [match] });

    checker.process(match, tournament);

    expect(
      match.warningFlags & MatchWarningFlags.UnexpectedNameFormat
    ).not.toBe(0);
  });

  it('adds warning when more than two unique beatmaps are not pooled', () => {
    const games = [
      createGame({
        rejectionReason: GameRejectionReason.BeatmapNotPooled,
        beatmap: { id: 1, osuId: 1001 },
      }),
      createGame({
        rejectionReason: GameRejectionReason.BeatmapNotPooled,
        beatmap: { id: 2, osuId: 1002 },
      }),
      createGame({
        rejectionReason: GameRejectionReason.BeatmapNotPooled,
        beatmap: { id: 3, osuId: 1003 },
      }),
    ];
    const match = createMatch({ games });
    const tournament = createTournament({ matches: [match] });

    checker.process(match, tournament);

    expect(
      match.warningFlags & MatchWarningFlags.UnexpectedBeatmapsFound
    ).not.toBe(0);
  });

  it('does not warn when replayed warmup results in only two unique unpooled beatmaps', () => {
    const games = [
      createGame({
        rejectionReason: GameRejectionReason.BeatmapNotPooled,
        beatmap: { id: 1, osuId: 1001 },
      }),
      createGame({
        rejectionReason: GameRejectionReason.BeatmapNotPooled,
        beatmap: { id: 2, osuId: 1001 },
      }),
      createGame({
        rejectionReason: GameRejectionReason.BeatmapNotPooled,
        beatmap: { id: 3, osuId: 1002 },
      }),
    ];
    const match = createMatch({ games });
    const tournament = createTournament({ matches: [match] });

    checker.process(match, tournament);

    expect(match.warningFlags & MatchWarningFlags.UnexpectedBeatmapsFound).toBe(
      0
    );
  });

  it('detects overlapping rosters across games', () => {
    const games = [
      createGame({
        scores: [
          createScore({ team: Team.Red, playerId: 1 }),
          createScore({ team: Team.Blue, playerId: 2 }),
        ],
      }),
      createGame({
        scores: [
          createScore({ team: Team.Red, playerId: 3 }),
          createScore({ team: Team.Blue, playerId: 1 }),
        ],
      }),
    ];

    const match = createMatch({ games });
    const tournament = createTournament({ matches: [match] });

    checker.process(match, tournament);

    expect(match.warningFlags & MatchWarningFlags.OverlappingRosters).not.toBe(
      0
    );
  });

  it('converts eligible HeadToHead games to TeamVs', () => {
    const scoresGame1 = [
      createScore({ team: Team.NoTeam, playerId: 1 }),
      createScore({ team: Team.NoTeam, playerId: 2 }),
    ];

    const headToHeadGame = createGame({
      teamType: TeamType.HeadToHead,
      scores: scoresGame1,
    });

    const match = createMatch({ games: [headToHeadGame] });
    const tournament = createTournament({ matches: [match], lobbySize: 1 });

    checker.performHeadToHeadConversion(match, tournament);

    const [convertedGame] = match.games;

    expect(convertedGame?.teamType).toBe(TeamType.TeamVs);
    expect(
      convertedGame?.scores.find((score) => score.playerId === 1)?.team
    ).toBe(Team.Red);
    expect(
      convertedGame?.scores.find((score) => score.playerId === 2)?.team
    ).toBe(Team.Blue);
  });
});
