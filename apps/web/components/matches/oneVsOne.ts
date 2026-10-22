import type { MatchDetail } from '@/lib/orpc/schema/match';

/**
 * Whether the match is from a 1v1 tournament, shown player against player.
 * Until October 2026 o!TR converted head-to-head 1v1 lobbies to Team Vs and
 * picked red and blue itself, and those games can't be told apart from real
 * Team Vs ones, so a 1v1 never shows red or blue.
 */
export function isOneVsOneMatch(match: Pick<MatchDetail, 'tournament'>) {
  return match.tournament?.lobbySize === 1;
}
