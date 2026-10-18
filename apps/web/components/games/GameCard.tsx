'use client';

import { Team } from '@otr/core/osu';

import { TEAM_LABELS } from '@/lib/kit/format/enum-labels';
import { formatCount } from '@/lib/kit/format/number';
import type { Game, GameScore, MatchPlayer } from '@/lib/orpc/schema/match';
import { cn } from '@/lib/utils';
import {
  getScoreDisplayLazerMods,
  getScoreDisplayMods,
  resolveGameDisplayMods,
} from '@/lib/utils/mods';

import GameCardHeader from './GameCardHeader';
import ScoreCard from './ScoreCard';

/** The result line's colour: the winning team's text colour. */
const OUTCOME_TEXT_CLASS: Partial<Record<Team, string>> = {
  [Team.Red]: 'text-match-red-foreground',
  [Team.Blue]: 'text-match-blue-foreground',
};

type Outcome = { text: string; winner: Team | null };

/** Team totals decide the game; scores with no team don't count. */
function getOutcome(scoresByTeam: Map<Team, GameScore[]>): Outcome | null {
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

/**
 * One game of a match: its cover header, then each team's scores (red on
 * the left, blue on the right from desktop width), then the result line,
 * on a recessed frame inside the games panel.
 */
export default function GameCard({
  game,
  number,
  players = [],
  countryNames,
  highlighted = false,
  highlightScoreId = null,
}: {
  game: Game;
  /** The game's place in the match, counting from 1. */
  number: number;
  players: MatchPlayer[];
  /** The players' country names by code, from the server. */
  countryNames: Record<string, string>;
  highlighted?: boolean;
  highlightScoreId?: number | null;
}) {
  const scoresByTeam = new Map<Team, GameScore[]>();
  for (const score of [...game.scores].sort((a, b) => b.score - a.score)) {
    const team = score.team as Team;
    scoresByTeam.set(team, [...(scoresByTeam.get(team) ?? []), score]);
  }

  const outcome = getOutcome(scoresByTeam);
  const headerMods = resolveGameDisplayMods(game, game.scores);
  const scoreWidth = Math.max(
    0,
    ...game.scores.map((score) => formatCount(score.score).length)
  );
  const renderScores = (team: Team) =>
    (scoresByTeam.get(team) ?? []).map((score) => {
      const player = players.find((player) => player.id === score.playerId);
      return (
        <ScoreCard
          key={score.id}
          score={score}
          mods={getScoreDisplayMods(score.mods, headerMods.mods)}
          lazerMods={getScoreDisplayLazerMods(
            score.lazerMods,
            headerMods.lazerMods
          )}
          scoreWidth={scoreWidth}
          matchId={game.matchId}
          gameNumber={number}
          player={player}
          countryName={
            player?.country ? countryNames[player.country] : undefined
          }
          highlighted={score.id === highlightScoreId}
        />
      );
    });
  const hasNoTeamScores = (scoresByTeam.get(Team.NoTeam)?.length ?? 0) > 0;

  return (
    <div
      id={`game-${game.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-game-frame p-3 transition-all duration-300',
        highlighted && 'ring-2 ring-primary'
      )}
    >
      <GameCardHeader game={game} number={number} mods={headerMods} />
      {game.scores.length === 0 ? (
        <div className="rounded-lg border bg-score-card p-4 text-center text-sm text-muted-foreground">
          No scores available
        </div>
      ) : (
        <div className="flex flex-row flex-wrap gap-1 lg:gap-0">
          <div data-team="Red" className="team-container flex flex-col gap-1">
            {renderScores(Team.Red)}

            {hasNoTeamScores ? (
              <div
                data-team="NoTeam"
                className="team-container flex flex-col gap-1"
              >
                {renderScores(Team.NoTeam)}
              </div>
            ) : null}
          </div>

          <div data-team="Blue" className="team-container flex flex-col gap-1">
            {renderScores(Team.Blue)}
          </div>
        </div>
      )}
      {outcome ? (
        <div
          data-testid="game-outcome"
          className="mt-2 rounded-lg border p-2 text-center"
        >
          <p
            className={cn(
              'text-lg font-semibold tabular-nums',
              (outcome.winner !== null && OUTCOME_TEXT_CLASS[outcome.winner]) ||
                'text-foreground'
            )}
          >
            {outcome.text}
          </p>
        </div>
      ) : null}
    </div>
  );
}
