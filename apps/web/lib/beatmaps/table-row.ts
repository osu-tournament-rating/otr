import { Mods, type Ruleset } from '@otr/core/osu';

import type { BeatmapListSortKey } from '@/lib/beatmaps/list-params';
import { getModdedDifficultyStats } from '@/lib/beatmaps/mod-attributes';
import {
  getBeatmapArtist,
  getBeatmapTitle,
  isDeletedTournamentBeatmap,
} from '@/lib/beatmaps/presentation';
import type {
  BeatmapListItem,
  BeatmapListTopMod,
} from '@/lib/orpc/schema/beatmapList';
import type {
  TournamentBeatmap,
  TournamentMatchGame,
} from '@/lib/orpc/schema/tournament';

/**
 * The flat shape the beatmap table renders: global counts from the beatmap list,
 * tournament-scoped counts from a pool.
 */
export interface BeatmapTableRow {
  id: number;
  osuId: number;
  artist: string;
  title: string;
  diffName: string;
  /** A name, never a player object; the row's link covers the whole identity block. */
  creator: string | null;
  beatmapsetOsuId: number | null;
  ruleset: Ruleset;
  sr: number;
  bpm: number;
  totalLength: number;
  cs: number;
  ar: number;
  od: number;
  hp: number;
  gameCount: number;
  tournamentCount: number;
  topMods: BeatmapListTopMod[];
  /** osu! no longer serves the beatmap. Only tournament pools track this. */
  isDeleted: boolean;
}

export function toBeatmapTableRows(
  beatmaps: BeatmapListItem[]
): BeatmapTableRow[] {
  return beatmaps.map((beatmap) => ({
    id: beatmap.id,
    osuId: beatmap.osuId,
    artist: beatmap.artist,
    title: beatmap.title,
    diffName: beatmap.diffName,
    creator: beatmap.creator,
    beatmapsetOsuId: beatmap.beatmapsetOsuId,
    ruleset: beatmap.ruleset,
    sr: beatmap.sr,
    bpm: beatmap.bpm,
    totalLength: beatmap.totalLength,
    cs: beatmap.cs,
    ar: beatmap.ar,
    od: beatmap.od,
    hp: beatmap.hp,
    gameCount: beatmap.verifiedGameCount,
    tournamentCount: beatmap.verifiedTournamentCount,
    topMods: beatmap.topMods ?? [],
    isDeleted: false,
  }));
}

/** How often each pooled beatmap was played, in one pass over the games. */
function buildUsageIndex(games: TournamentMatchGame[]): Map<number, number> {
  const gameCounts = new Map<number, number>();

  for (const game of games) {
    const osuId = game.beatmap?.osuId;
    if (osuId === undefined || osuId === null) continue;

    gameCounts.set(osuId, (gameCounts.get(osuId) ?? 0) + 1);
  }

  return gameCounts;
}

export function toTournamentBeatmapTableRows(
  beatmaps: TournamentBeatmap[],
  games: TournamentMatchGame[]
): BeatmapTableRow[] {
  const gameCounts = buildUsageIndex(games);

  return beatmaps.map((beatmap) => {
    const creator = beatmap.creators[0] ?? beatmap.beatmapset?.creator;
    const [leadingMod] = beatmap.topMods;
    // A pooled beatmap reads like a mappool sheet: its values under the mod
    // it was played with most. NM keeps osu!'s own values, like the list's.
    const stats =
      (leadingMod &&
        leadingMod.mods !== Mods.None &&
        getModdedDifficultyStats(
          beatmap,
          beatmap.attributes,
          leadingMod.mods
        )) ||
      beatmap;

    return {
      id: beatmap.id,
      osuId: beatmap.osuId,
      artist: getBeatmapArtist(beatmap) || 'Unknown artist',
      title: getBeatmapTitle(beatmap) || 'Unknown title',
      diffName: beatmap.diffName || 'Unknown difficulty',
      creator: creator?.username ?? null,
      beatmapsetOsuId: beatmap.beatmapset?.osuId ?? null,
      ruleset: beatmap.ruleset,
      sr: stats.sr,
      bpm: stats.bpm,
      totalLength: stats.totalLength,
      cs: stats.cs,
      ar: stats.ar,
      od: stats.od,
      hp: stats.hp,
      gameCount: gameCounts.get(beatmap.osuId) ?? 0,
      tournamentCount: 1,
      topMods: beatmap.topMods,
      isDeleted: isDeletedTournamentBeatmap(beatmap),
    };
  });
}

const SORT_VALUE: Record<
  BeatmapListSortKey,
  (row: BeatmapTableRow) => number | string
> = {
  sr: (row) => row.sr,
  bpm: (row) => row.bpm,
  cs: (row) => row.cs,
  ar: (row) => row.ar,
  od: (row) => row.od,
  hp: (row) => row.hp,
  length: (row) => row.totalLength,
  gameCount: (row) => row.gameCount,
  tournamentCount: (row) => row.tournamentCount,
  creator: (row) => row.creator ?? '',
};

/** Client-side sorting, for the surfaces holding the whole set in memory. */
export function sortBeatmapTableRows(
  rows: BeatmapTableRow[],
  sort: BeatmapListSortKey,
  descending: boolean
): BeatmapTableRow[] {
  const valueOf = SORT_VALUE[sort];

  return [...rows].sort((left, right) => {
    const leftValue = valueOf(left);
    const rightValue = valueOf(right);
    const order =
      typeof leftValue === 'string' && typeof rightValue === 'string'
        ? leftValue.localeCompare(rightValue)
        : Number(leftValue) - Number(rightValue);

    return descending ? -order : order;
  });
}
