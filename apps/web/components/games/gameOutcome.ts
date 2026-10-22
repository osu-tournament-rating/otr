import { Team, VerificationStatus } from '@otr/core/osu';

import { TEAM_LABELS } from '@/lib/kit/format/enum-labels';
import { formatCount } from '@/lib/kit/format/number';
import type { Game, GameScore, MatchPlayer } from '@/lib/orpc/schema/match';

/** A game card's result line, and the team whose colour it takes. */
export type Outcome = { text: string; winner: Team | null };

/** Team totals decide the game; scores with no team don't count. */
export function getTeamOutcome(
  scoresByTeam: Map<Team, GameScore[]>
): Outcome | null {
  const totals = [...scoresByTeam.entries()]
    .filter(([team]) => team !== Team.NoTeam)
    .map(([team, scores]) => ({
      team,
      total: scores.reduce((sum, score) => sum + score.score, 0),
    }))
    .filter(({ total }) => total > 0);

  const [first, second] = totals;
  if (!first) return null;

  if (!second) {
    return { text: `Team ${TEAM_LABELS[first.team]} wins`, winner: first.team };
  }
  if (first.total === second.total) {
    return { text: "It's a tie!", winner: null };
  }

  const [winner, loser] =
    first.total > second.total ? [first, second] : [second, first];
  return {
    text: `Team ${TEAM_LABELS[winner.team]} wins by ${formatCount(winner.total - loser.total)}`,
    winner: winner.team,
  };
}

const isRejected = (status: VerificationStatus) =>
  status === VerificationStatus.Rejected ||
  status === VerificationStatus.PreRejected;

type PlayerGame = Pick<Game, 'scores' | 'verificationStatus'>;

/**
 * Whether a 1v1 score decides its game. A score rejected in a game that
 * isn't, such as a referee's, doesn't. A rejected game's scores still decide
 * it, as a team game's do.
 */
const decides = (game: PlayerGame, score: GameScore) =>
  score.score > 0 &&
  (isRejected(game.verificationStatus) ||
    !isRejected(score.verificationStatus));

/**
 * A 1v1 game's scores in the order its card lists them: those that decide
 * it first, then the rest, each best first.
 */
export function rankPlayerScores(game: PlayerGame): GameScore[] {
  return [...game.scores].sort(
    (a, b) =>
      Number(decides(game, b)) - Number(decides(game, a)) || b.score - a.score
  );
}

/** A 1v1 game's result from the two best scores that decide it. */
export function getPlayerOutcome(
  game: PlayerGame,
  players: MatchPlayer[]
): Outcome | null {
  const counted = rankPlayerScores(game).filter((score) =>
    decides(game, score)
  );
  const [first, second] = counted;
  if (!first) return null;

  const name =
    players.find((player) => player.id === first.playerId)?.username ??
    'Unknown player';

  if (!second) {
    return { text: `${name} wins`, winner: null };
  }
  if (first.score === second.score) {
    return { text: "It's a tie!", winner: null };
  }
  return {
    text: `${name} wins by ${formatCount(first.score - second.score)}`,
    winner: null,
  };
}
