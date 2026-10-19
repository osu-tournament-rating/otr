import {
  MatchDetail,
  MatchPlayer,
  PlayerMatchStats,
  RatingAdjustment,
} from '@/lib/orpc/schema/match';
import { type Ruleset, Team, VerificationStatus } from '@otr/core/osu';
import { TierName, getTierFromRating } from '@/lib/utils/tierData';
import {
  formatAccuracy,
  formatCount,
  formatNumber,
  formatRating,
} from '@/lib/kit/format/number';

export interface HighlightPlayer {
  id: number;
  osuId: number;
  username: string;
}

export interface HighlightTierIcon {
  tier: TierName;
  subTier: number | undefined;
}

export type HighlightIcon =
  'Swords' | 'Users' | 'Gamepad2' | 'TrendingUp' | 'Medal' | 'Crosshair';

export interface HighlightStat {
  id: string;
  label: string;
  value: string;
  sublabel?: string;
  icon: HighlightIcon;
  player?: HighlightPlayer;
  tierIcon?: HighlightTierIcon;
  metric?: string;
  helpText?: string;
}

/** The help behind Player performance, shared with its loading screen. */
export const PLAYER_PERFORMANCE_INFO = 'Averages per game';

export type TeamColor = 'red' | 'blue';

export interface ProcessedPlayerStats {
  playerId: number;
  username: string;
  osuId: number;
  team?: TeamColor;
  won: boolean;
  gamesWon: number;
  gamesLost: number;
  gamesPlayed: number;
  matchCost: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  volatilityBefore: number | null;
  volatilityAfter: number | null;
  volatilityDelta: number | null;
  averageScore: number;
  averageAccuracy: number;
  averageMisses: number;
  averagePlacement: number;
}

function getRosterTeamMap(match: MatchDetail): Map<number, TeamColor> {
  const playerTeams = new Map<number, TeamColor>();

  for (const roster of match.rosters ?? []) {
    const team =
      roster.team === Team.Red
        ? 'red'
        : roster.team === Team.Blue
          ? 'blue'
          : undefined;

    if (!team) continue;

    for (const playerId of roster.roster) {
      playerTeams.set(playerId, team);
    }
  }

  return playerTeams;
}

export function processMatchStatistics(
  match: MatchDetail,
  players: MatchPlayer[]
): ProcessedPlayerStats[] {
  if (!match.playerMatchStats?.length) {
    return [];
  }

  const playerMap = new Map(players.map((player) => [player.id, player]));
  const playerTeamMap = getRosterTeamMap(match);
  const ratingAdjustmentMap = new Map<number, RatingAdjustment>();

  for (const adjustment of match.ratingAdjustments ?? []) {
    if (!ratingAdjustmentMap.has(adjustment.playerId)) {
      ratingAdjustmentMap.set(adjustment.playerId, adjustment);
    }
  }

  return match.playerMatchStats.flatMap(
    (playerStats: PlayerMatchStats): ProcessedPlayerStats[] => {
      const playerInfo = playerMap.get(playerStats.playerId);
      const ratingAdjustment = ratingAdjustmentMap.get(playerStats.playerId);

      if (!playerInfo) return [];

      return [
        {
          playerId: playerStats.playerId,
          username: playerInfo.username,
          osuId: playerInfo.osuId,
          team: playerTeamMap.get(playerStats.playerId),
          won: Boolean(
            match.winRecord &&
            !match.winRecord.isTied &&
            match.winRecord.winnerRoster?.includes(playerStats.playerId)
          ),
          gamesWon: playerStats.gamesWon,
          gamesLost: playerStats.gamesLost,
          gamesPlayed: playerStats.gamesPlayed,
          matchCost: playerStats.matchCost,
          ratingBefore: ratingAdjustment?.ratingBefore ?? null,
          ratingAfter: ratingAdjustment?.ratingAfter ?? null,
          ratingDelta: ratingAdjustment?.ratingDelta ?? null,
          volatilityBefore: ratingAdjustment?.volatilityBefore ?? null,
          volatilityAfter: ratingAdjustment?.volatilityAfter ?? null,
          volatilityDelta: ratingAdjustment?.volatilityDelta ?? null,
          averageScore: playerStats.averageScore,
          averageAccuracy: playerStats.averageAccuracy,
          averageMisses: playerStats.averageMisses,
          averagePlacement: playerStats.averagePlacement,
        },
      ];
    }
  );
}

function createHighlightPlayer(player: ProcessedPlayerStats): HighlightPlayer {
  return {
    id: player.playerId,
    osuId: player.osuId,
    username: player.username,
  };
}

function createResultStat(
  match: MatchDetail,
  players: ProcessedPlayerStats[]
): HighlightStat {
  const winRecord = match.winRecord;

  if (winRecord) {
    const teamScores = new Map<Team, number>();

    if (winRecord.winnerTeam !== null) {
      teamScores.set(winRecord.winnerTeam, winRecord.winnerPoints);
    }
    if (winRecord.loserTeam !== null) {
      teamScores.set(winRecord.loserTeam, winRecord.loserPoints);
    }

    const redScore = teamScores.get(Team.Red);
    const blueScore = teamScores.get(Team.Blue);
    const winner = players.find((player) =>
      winRecord.winnerRoster?.includes(player.playerId)
    );

    return {
      id: 'match-result',
      label: 'Match result',
      value:
        redScore !== undefined && blueScore !== undefined
          ? `${formatCount(redScore)}–${formatCount(blueScore)}`
          : `${formatCount(winRecord.winnerPoints)}–${formatCount(winRecord.loserPoints)}`,
      sublabel: winRecord.isTied
        ? 'Draw'
        : winRecord.winnerTeam === Team.Red
          ? 'Red wins'
          : winRecord.winnerTeam === Team.Blue
            ? 'Blue wins'
            : winner
              ? `${winner.username} wins`
              : 'Final score',
      icon: 'Swords',
      helpText: winRecord.isTied ? 'Excludes rejected games' : undefined,
    };
  }

  return {
    id: 'match-result',
    label: 'Match result',
    value: '—',
    sublabel: 'Result unavailable',
    icon: 'Swords',
  };
}

export function calculateHighlightStats(
  players: ProcessedPlayerStats[],
  match: MatchDetail
): HighlightStat[] {
  if (players.length === 0) {
    return [];
  }

  const ratedGames = (match.games ?? []).filter(
    (game) => game.verificationStatus === VerificationStatus.Verified
  ).length;
  const playersWithRatings = players.filter(
    (player): player is ProcessedPlayerStats & { ratingAfter: number } =>
      player.ratingAfter !== null
  );
  const averageRating = playersWithRatings.length
    ? playersWithRatings.reduce(
        (total, player) => total + player.ratingAfter,
        0
      ) / playersWithRatings.length
    : null;
  const averageTier =
    averageRating === null ? null : getTierFromRating(averageRating);
  const topMatchCost = players.reduce((previous, current) =>
    current.matchCost > previous.matchCost ? current : previous
  );
  const topAccuracy = players.reduce((previous, current) =>
    current.averageAccuracy > previous.averageAccuracy ? current : previous
  );

  return [
    createResultStat(match, players),
    {
      id: 'players',
      label: 'Players',
      value: formatCount(players.length),
      icon: 'Users',
    },
    {
      id: 'rated-games',
      label: 'Rated games',
      value: formatCount(ratedGames),
      icon: 'Gamepad2',
    },
    {
      id: 'average-rating',
      label: 'Average rating',
      value: formatRating(averageRating),
      sublabel: averageRating === null ? 'Ratings unavailable' : undefined,
      icon: 'TrendingUp',
      tierIcon: averageTier
        ? { tier: averageTier.tier, subTier: averageTier.subTier }
        : undefined,
    },
    {
      id: 'match-cost',
      label: 'Top match cost',
      value: formatMatchCost(topMatchCost.matchCost),
      icon: 'Medal',
      player: createHighlightPlayer(topMatchCost),
    },
    {
      id: 'accuracy',
      label: 'Top accuracy',
      value: formatAccuracy(topAccuracy.averageAccuracy),
      icon: 'Crosshair',
      metric: 'avg',
      player: createHighlightPlayer(topAccuracy),
    },
  ];
}

/**
 * A player's profile in the match's ruleset, as the score cards link it, so
 * a mania match never opens someone's osu! profile.
 */
export function playerProfileHref(playerId: number, ruleset?: Ruleset): string {
  return ruleset === undefined
    ? `/players/${playerId}`
    : `/players/${playerId}?ruleset=${ruleset}`;
}

/** A match cost, always with two decimals: `1.31`. */
export function formatMatchCost(matchCost: number): string {
  return formatNumber(matchCost, { decimals: 2 });
}

/** A per-game average such as misses or placement, to one decimal: `8.2`. */
export function formatAverage(value: number): string {
  return formatNumber(value, { decimals: 1 });
}
