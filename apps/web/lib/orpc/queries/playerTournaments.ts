import { cache } from 'react';

import { orpc } from '@/lib/orpc/orpc';
import type { PlayerTournamentHistoryItem } from '@/lib/orpc/schema/tournament';
import { Ruleset } from '@otr/core/osu';

export type PlayerTournamentsRequest = {
  id: number;
  dateMin?: Date;
  dateMax?: Date;
  ruleset?: Ruleset;
};

const toISOStringOrUndefined = (value?: Date) =>
  value ? value.toISOString() : undefined;

export async function getPlayerTournamentHistory({
  id,
  dateMin,
  dateMax,
  ruleset,
}: PlayerTournamentsRequest): Promise<PlayerTournamentHistoryItem[]> {
  return orpc.players.tournamentHistory({
    id,
    keyType: 'otr',
    dateMin: toISOStringOrUndefined(dateMin),
    dateMax: toISOStringOrUndefined(dateMax),
    ruleset,
  });
}

export const getPlayerTournamentHistoryCached = cache(
  async (playerId: number, dateMin?: Date, dateMax?: Date, ruleset?: Ruleset) =>
    getPlayerTournamentHistory({ id: playerId, dateMin, dateMax, ruleset })
);
