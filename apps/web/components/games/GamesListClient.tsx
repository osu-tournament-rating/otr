'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import GameCard from './GameCard';
import type { Game, MatchPlayer } from '@/lib/orpc/schema/match';

interface GamesListClientProps {
  games: Game[];
  players: MatchPlayer[];
  /** The players' country names by code, from `getCountryNames` on the server. */
  countryNames: Record<string, string>;
  /** From a 1v1 tournament: games show player against player. */
  oneVsOne?: boolean;
}

export default function GamesListClient({
  games,
  players,
  countryNames,
  oneVsOne = false,
}: GamesListClientProps) {
  const searchParams = useSearchParams();
  const gameIdParam = searchParams.get('gameId');
  const scoreIdParam = searchParams.get('scoreId');

  const [highlightGameId, setHighlightGameId] = useState<number | null>(
    gameIdParam ? Number(gameIdParam) : null
  );
  const [highlightScoreId, setHighlightScoreId] = useState<number | null>(
    scoreIdParam ? Number(scoreIdParam) : null
  );

  useEffect(() => {
    const targetId = gameIdParam
      ? `game-${gameIdParam}`
      : scoreIdParam
        ? `score-${scoreIdParam}`
        : null;

    if (targetId) {
      const element = document.getElementById(targetId);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }
  }, [gameIdParam, scoreIdParam]);

  useEffect(() => {
    if (highlightGameId || highlightScoreId) {
      const timer = setTimeout(() => {
        setHighlightGameId(null);
        setHighlightScoreId(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightGameId, highlightScoreId]);

  const sortedGames = [...games].sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
    return aTime - bTime;
  });

  return (
    <div className="flex flex-col gap-4">
      {sortedGames.map((game, index) => (
        <GameCard
          key={game.id}
          game={game}
          number={index + 1}
          players={players.filter((player) =>
            game.scores.map((s) => s.playerId).includes(player.id)
          )}
          countryNames={countryNames}
          oneVsOne={oneVsOne}
          highlighted={game.id === highlightGameId}
          highlightScoreId={highlightScoreId}
        />
      ))}
    </div>
  );
}
