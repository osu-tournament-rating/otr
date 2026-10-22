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

  it('does not flag a player on both sides of a 1v1 played partly head-to-head', () => {
    const games = [
      createGame({
        teamType: TeamType.HeadToHead,
        scores: [
          createScore({ team: Team.NoTeam, playerId: 1 }),
          createScore({ team: Team.NoTeam, playerId: 2 }),
        ],
      }),
      createGame({
        scores: [
          createScore({ team: Team.Red, playerId: 1 }),
          createScore({ team: Team.Blue, playerId: 2 }),
        ],
      }),
    ];

    const match = createMatch({ games });
    const tournament = createTournament({ matches: [match], lobbySize: 1 });

    checker.process(match, tournament);

    expect(match.warningFlags & MatchWarningFlags.OverlappingRosters).toBe(0);
  });
});

describe('MatchAutomationChecks on 1v1 head-to-head matches', () => {
  const { PreVerified, PreRejected, Verified } = VerificationStatus;

  beforeEach(() => {
    resetIds();
  });

  /** A head-to-head game the game checks passed, between `playerIds`. */
  const headToHeadGame = (
    playerIds: number[],
    verificationStatus = PreVerified
  ) =>
    createGame({
      teamType: TeamType.HeadToHead,
      verificationStatus,
      scores: playerIds.map((playerId) =>
        createScore({ team: Team.NoTeam, playerId })
      ),
    });

  const check = (games: ReturnType<typeof createGame>[]) => {
    const match = createMatch({ games, name: 'TT: (one) vs (two)' });
    const tournament = createTournament({ matches: [match], lobbySize: 1 });

    return { match, rejection: checker.process(match, tournament) };
  };

  it('keeps the head-to-head games of a match between two players', () => {
    const { match, rejection } = check([
      headToHeadGame([1, 2]),
      headToHeadGame([1, 2]),
      headToHeadGame([2, 1]),
    ]);

    expect(rejection).toBe(MatchRejectionReason.None);
    expect(match.games.map((game) => game.verificationStatus)).toEqual([
      PreVerified,
      PreVerified,
      PreVerified,
    ]);
  });

  it('rejects the head-to-head games of a match with two pairings in one lobby', () => {
    const { match, rejection } = check([
      ...[1, 2, 3].map(() => headToHeadGame([1, 2])),
      ...[1, 2, 3, 4].map(() => headToHeadGame([3, 4])),
    ]);

    expect(rejection).toBe(MatchRejectionReason.NoValidGames);
    expect(match.games).toHaveLength(7);
    for (const game of match.games) {
      expect(game.verificationStatus).toBe(PreRejected);
      expect(game.rejectionReason).toBe(GameRejectionReason.InvalidTeamType);
    }
  });

  it('rejects the head-to-head games of a match where a substitute played', () => {
    const { match } = check([
      ...[1, 2, 3].map(() => headToHeadGame([1, 2])),
      ...[1, 2, 3, 4].map(() => headToHeadGame([3, 2])),
    ]);

    expect(match.games).toHaveLength(7);
    expect(
      match.games.filter((game) => game.verificationStatus === PreRejected)
    ).toHaveLength(7);
  });

  it('judges the match on its team vs games once its head-to-head games are rejected', () => {
    const teamGame = () =>
      createGame({
        scores: [
          createScore({ team: Team.Red, playerId: 1 }),
          createScore({ team: Team.Blue, playerId: 2 }),
        ],
      });
    const { match, rejection } = check([
      teamGame(),
      teamGame(),
      teamGame(),
      headToHeadGame([1, 3]),
    ]);

    expect(rejection).toBe(MatchRejectionReason.None);
    expect(match.games.map((game) => game.verificationStatus)).toEqual([
      PreVerified,
      PreVerified,
      PreVerified,
      PreRejected,
    ]);
  });

  it('counts only valid scores in valid games toward the players', () => {
    const referee = createScore({
      team: Team.NoTeam,
      playerId: 9,
      score: 0,
      verificationStatus: PreRejected,
    });
    const withReferee = headToHeadGame([1, 2]);
    withReferee.scores.push(referee);

    const { match, rejection } = check([
      withReferee,
      headToHeadGame([1, 2]),
      headToHeadGame([1, 2]),
      // A warmup the game checks rejected, played by someone else.
      headToHeadGame([7, 8], PreRejected),
    ]);

    expect(rejection).toBe(MatchRejectionReason.None);
    expect(match.games.map((game) => game.verificationStatus)).toEqual([
      PreVerified,
      PreVerified,
      PreVerified,
      PreRejected,
    ]);
  });

  it('keeps a head-to-head game an admin verified', () => {
    const { match } = check([
      headToHeadGame([1, 2], Verified),
      headToHeadGame([3, 2]),
      headToHeadGame([3, 2]),
    ]);

    expect(match.games.map((game) => game.verificationStatus)).toEqual([
      Verified,
      PreRejected,
      PreRejected,
    ]);
    expect(match.games[0]?.rejectionReason).toBe(GameRejectionReason.None);
  });
});
