import { describe, expect, it } from 'bun:test';
import { Team, VerificationStatus } from '@otr/core/osu';

import type { GameScore, MatchPlayer } from '@/lib/orpc/schema/match';

import { getPlayerOutcome, rankPlayerScores } from '../gameOutcome';

const players = [
  { id: 1, username: 'Kahli' },
  { id: 2, username: 'woahsia' },
  { id: 9, username: 'referee' },
] as MatchPlayer[];

/** A 1v1 score of no team, as a head-to-head lobby records it. */
const score = (
  playerId: number,
  value: number,
  verificationStatus = VerificationStatus.PreVerified
) =>
  ({
    id: playerId,
    playerId,
    score: value,
    team: Team.NoTeam,
    verificationStatus,
  }) as GameScore;

const game = (
  scores: GameScore[],
  verificationStatus = VerificationStatus.PreVerified
) => ({ scores, verificationStatus });

describe('getPlayerOutcome', () => {
  it('names the 1v1 winner and the margin, with no team colour', () => {
    expect(
      getPlayerOutcome(game([score(2, 800_000), score(1, 812_345)]), players)
    ).toEqual({ text: 'Kahli wins by 12,345', winner: null });
  });

  it('leaves out a score rejected in a game that is not', () => {
    const referee = score(9, 900_000, VerificationStatus.PreRejected);

    expect(
      getPlayerOutcome(
        game([referee, score(2, 812_345), score(1, 800_000)]),
        players
      )?.text
    ).toBe('woahsia wins by 12,345');
  });

  it('still decides a rejected game from its rejected scores', () => {
    const { Rejected } = VerificationStatus;

    expect(
      getPlayerOutcome(
        game(
          [score(1, 812_345, Rejected), score(2, 800_000, Rejected)],
          Rejected
        ),
        players
      )?.text
    ).toBe('Kahli wins by 12,345');
  });
});

describe('rankPlayerScores', () => {
  it('lists the winner first and a rejected referee after both players', () => {
    const referee = score(9, 900_000, VerificationStatus.PreRejected);

    expect(
      rankPlayerScores(
        game([score(2, 800_000), referee, score(1, 812_345)])
      ).map((entry) => entry.playerId)
    ).toEqual([1, 2, 9]);
  });
});
