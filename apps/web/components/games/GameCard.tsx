'use client';

import { Team } from '@otr/core/osu';

import { formatCount } from '@/lib/kit/format/number';
import type { Game, GameScore, MatchPlayer } from '@/lib/orpc/schema/match';
import { cn } from '@/lib/utils';
import {
  getScoreDisplayLazerMods,
  getScoreDisplayMods,
  resolveGameDisplayMods,
} from '@/lib/utils/mods';

import GameCardHeader from './GameCardHeader';
import {
  getPlayerOutcome,
  getTeamOutcome,
  rankPlayerScores,
} from './gameOutcome';
import ScoreCard from './ScoreCard';

/** The result line's colour: the winning team's text colour. */
const OUTCOME_TEXT_CLASS: Partial<Record<Team, string>> = {
  [Team.Red]: 'text-match-red-foreground',
  [Team.Blue]: 'text-match-blue-foreground',
};

/**
 * One game of a match: its cover header, then the scores, then the result
 * line, on a recessed frame inside the games panel. A team game shows each
 * team's scores, red on the left and blue on the right from desktop width.
 * A 1v1 shows player against player, the winner on the left, with no
 * team colours: its red and blue may be o!TR's own.
 */
export default function GameCard({
  game,
  number,
  players = [],
  countryNames,
  oneVsOne = false,
  highlighted = false,
  highlightScoreId = null,
}: {
  game: Game;
  /** The game's place in the match, counting from 1. */
  number: number;
  players: MatchPlayer[];
  /** The players' country names by code, from the server. */
  countryNames: Record<string, string>;
  /** From a 1v1 tournament, whose sides are players. */
  oneVsOne?: boolean;
  highlighted?: boolean;
  highlightScoreId?: number | null;
}) {
  const sortedScores = [...game.scores].sort((a, b) => b.score - a.score);
  const scoresByTeam = new Map<Team, GameScore[]>();
  for (const score of sortedScores) {
    const team = score.team as Team;
    scoresByTeam.set(team, [...(scoresByTeam.get(team) ?? []), score]);
  }

  const outcome = oneVsOne
    ? getPlayerOutcome(game, players)
    : getTeamOutcome(scoresByTeam);
  const headerMods = resolveGameDisplayMods(game, game.scores);
  const scoreWidth = Math.max(
    0,
    ...game.scores.map((score) => formatCount(score.score).length)
  );
  const renderScores = (scores: GameScore[]) =>
    scores.map((score) => {
      const player = players.find((player) => player.id === score.playerId);
      return (
        <ScoreCard
          key={score.id}
          score={score}
          team={oneVsOne ? Team.NoTeam : (score.team as Team)}
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
  const noTeamScores = scoresByTeam.get(Team.NoTeam) ?? [];
  const playerScores = oneVsOne ? rankPlayerScores(game) : [];
  const [left, right] = oneVsOne
    ? [playerScores.slice(0, 1), playerScores.slice(1)]
    : [scoresByTeam.get(Team.Red) ?? [], scoresByTeam.get(Team.Blue) ?? []];

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
          <div data-side="left" className="team-container flex flex-col gap-1">
            {renderScores(left)}

            {!oneVsOne && noTeamScores.length > 0 ? (
              <div
                data-side="none"
                className="team-container flex flex-col gap-1"
              >
                {renderScores(noTeamScores)}
              </div>
            ) : null}
          </div>

          <div data-side="right" className="team-container flex flex-col gap-1">
            {renderScores(right)}
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
