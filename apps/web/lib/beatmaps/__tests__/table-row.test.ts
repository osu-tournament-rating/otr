import { describe, expect, test } from 'bun:test';
import { Mods, Ruleset } from '@otr/core/osu';

import { toTournamentBeatmapTableRows } from '../table-row';
import type {
  TournamentBeatmap,
  TournamentMatchGame,
} from '@/lib/orpc/schema/tournament';
import {
  calculateBeatmapListModDistribution,
  filterBeatmapModDistribution,
} from '@/lib/utils/mods';

const beatmap = (topMods: TournamentBeatmap['topMods']) =>
  ({
    id: 1,
    osuId: 1001,
    ruleset: Ruleset.Osu,
    diffName: 'Extra',
    totalLength: 200,
    bpm: 180,
    cs: 4,
    ar: 9,
    od: 8,
    hp: 5,
    sr: 6,
    beatmapset: null,
    creators: [],
    attributes: [],
    dataFetchStatus: 0,
    topMods,
  }) as unknown as TournamentBeatmap;

const game = (mods: number, osuId: number | null = 1001) =>
  ({
    id: 1,
    mods,
    beatmap: osuId === null ? null : { osuId },
  }) as unknown as TournamentMatchGame;

describe('toTournamentBeatmapTableRows', () => {
  test('shows the per-score mods of a freemod pick', () => {
    const topMods = filterBeatmapModDistribution(
      calculateBeatmapListModDistribution([
        { mods: Mods.Hidden, scoreCount: 4 },
        { mods: Mods.HardRock, scoreCount: 3 },
        { mods: Mods.DoubleTime, scoreCount: 1 },
      ])
    ).map(({ label, mods, percentage }) => ({ mod: label, mods, percentage }));

    const [row] = toTournamentBeatmapTableRows(
      [beatmap(topMods)],
      [game(Mods.None), game(Mods.None)]
    );

    expect(row.topMods).toEqual(topMods);
    expect(row.gameCount).toBe(2);
    expect(row.tournamentCount).toBe(1);
  });

  test('counts only the games played on the pooled beatmap', () => {
    const [row] = toTournamentBeatmapTableRows(
      [beatmap([])],
      [game(Mods.None), game(Mods.Hidden, 2002), game(Mods.None, null)]
    );

    expect(row.gameCount).toBe(1);
  });

  test('falls back to no mods when the pool carries none', () => {
    const [row] = toTournamentBeatmapTableRows([beatmap([])], []);

    expect(row.topMods).toEqual([]);
    expect(row.gameCount).toBe(0);
  });
});

describe('toTournamentBeatmapTableRows mod attributes', () => {
  const topMod = (mod: string, mods: number) => [
    { mod, mods, percentage: 100 },
  ];
  const attribute = (mods: number, sr: number) => ({
    id: mods + 1,
    mods,
    sr,
    ar: 10.33,
    cs: 4,
    od: 9.75,
    hp: 5,
    created: '2026-10-01 00:00:00',
  });
  const withAttributes = (
    topMods: TournamentBeatmap['topMods'],
    attributes: TournamentBeatmap['attributes']
  ) => ({ ...beatmap(topMods), attributes }) as TournamentBeatmap;

  test("shows the leading mod's values, with DT's speed on BPM and length", () => {
    const [row] = toTournamentBeatmapTableRows(
      [
        withAttributes(topMod('DT', Mods.DoubleTime), [
          attribute(Mods.None, 6.1),
          attribute(Mods.DoubleTime, 8.2),
        ]),
      ],
      []
    );

    // 180 BPM * 1.5 = 270; 200 s / 1.5 = 133.3 s, rounded to 133.
    expect(row).toMatchObject({
      sr: 8.2,
      ar: 10.33,
      od: 9.75,
      cs: 4,
      hp: 5,
      bpm: 270,
      totalLength: 133,
    });
  });

  test('keeps nomod values for a leading NM, even with a calculated row', () => {
    const [row] = toTournamentBeatmapTableRows(
      [withAttributes(topMod('NM', Mods.None), [attribute(Mods.None, 6.1)])],
      []
    );

    expect(row).toMatchObject({ sr: 6, ar: 9, bpm: 180, totalLength: 200 });
  });

  test('keeps nomod values when the leading mod has no calculated row', () => {
    const [hardRock, halfTime] = toTournamentBeatmapTableRows(
      [
        withAttributes(topMod('HR', Mods.HardRock), [
          attribute(Mods.DoubleTime, 8.2),
        ]),
        // HT has no stored attributes, so its key matches no row at all.
        withAttributes(topMod('HT', Mods.HalfTime), [
          attribute(Mods.None, 6.1),
        ]),
      ],
      []
    );

    expect(hardRock).toMatchObject({ sr: 6, ar: 9, bpm: 180 });
    expect(halfTime).toMatchObject({ sr: 6, ar: 9, bpm: 180 });
  });
});
