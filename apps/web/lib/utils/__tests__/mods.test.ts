import { describe, expect, it } from 'bun:test';

import { Mods } from '@otr/core/osu';
import {
  BEATMAP_MOD_OTHER_LABEL,
  calculateBeatmapListModDistribution,
  calculateBeatmapModDistribution,
  collapseBeatmapModDistribution,
  deriveGameIsFreeMod,
  filterBeatmapModDistribution,
  getBeatmapModLabel,
  normalizeBeatmapDisplayMods,
  getScoreDisplayLazerMods,
  getScoreDisplayMods,
  resolveGameDisplayMods,
  selectBeatmapListModGroups,
} from '../mods';

describe('beatmap mod display helpers', () => {
  it('removes incidental score mods and formats the remaining combination', () => {
    expect(normalizeBeatmapDisplayMods(Mods.NoFail | Mods.SpunOut)).toBe(
      Mods.None
    );
    expect(getBeatmapModLabel(Mods.NoFail)).toBe('NM');
    expect(getBeatmapModLabel(Mods.NoFail | Mods.Hidden | Mods.HardRock)).toBe(
      'HDHR'
    );
  });

  it('names every key mod, so mania scores never read as No Mod (#1027)', () => {
    for (const [mods, label] of [
      [Mods.Key1, '1K'],
      [Mods.Key2, '2K'],
      [Mods.Key3, '3K'],
      [Mods.Key4, '4K'],
      [Mods.Key7, '7K'],
      [Mods.Key8, '8K'],
      [Mods.Key9, '9K'],
    ] as const) {
      expect(getBeatmapModLabel(mods)).toBe(label);
    }
    expect(getBeatmapModLabel(Mods.Hidden | Mods.Key7)).toBe('HD7K');
    expect(getBeatmapModLabel(Mods.NoFail | Mods.Key7)).toBe('7K');

    const distribution = calculateBeatmapModDistribution([
      { mods: Mods.None, scoreCount: 4 },
      { mods: Mods.Key7, scoreCount: 6 },
    ]);
    expect(distribution.map(({ label }) => label)).toEqual(['7K', 'NM']);
  });

  it('folds Nightcore into DoubleTime everywhere it is displayed', () => {
    expect(normalizeBeatmapDisplayMods(Mods.DoubleTime | Mods.Nightcore)).toBe(
      Mods.DoubleTime
    );
    expect(normalizeBeatmapDisplayMods(Mods.Nightcore)).toBe(Mods.DoubleTime);
    expect(getBeatmapModLabel(Mods.DoubleTime | Mods.Nightcore)).toBe('DT');
    expect(getBeatmapModLabel(Mods.Hidden | Mods.Nightcore)).toBe('HDDT');

    const distribution = calculateBeatmapModDistribution([
      { mods: Mods.DoubleTime, scoreCount: 10 },
      { mods: Mods.DoubleTime | Mods.Nightcore, scoreCount: 5 },
    ]);
    expect(
      distribution.map(({ mods, label, scoreCount }) => ({
        mods,
        label,
        scoreCount,
      }))
    ).toEqual([{ mods: Mods.DoubleTime, label: 'DT', scoreCount: 15 }]);
  });

  it('aggregates score-derived combinations using the detail chart rules', () => {
    const distribution = calculateBeatmapModDistribution([
      { mods: Mods.NoFail, scoreCount: 950 },
      { mods: Mods.None, scoreCount: 9 },
      { mods: Mods.NoFail | Mods.HardRock, scoreCount: 20 },
      { mods: Mods.Hidden, scoreCount: 11 },
      { mods: Mods.DoubleTime, scoreCount: 10 },
    ]);

    expect(
      distribution.map(({ mods, label, scoreCount }) => ({
        mods,
        label,
        scoreCount,
      }))
    ).toEqual([
      { mods: Mods.None, label: 'NM', scoreCount: 959 },
      { mods: Mods.HardRock, label: 'HR', scoreCount: 20 },
      { mods: Mods.Hidden, label: 'HD', scoreCount: 11 },
      { mods: Mods.DoubleTime, label: 'DT', scoreCount: 10 },
    ]);
    expect(distribution[0].percentage).toBeCloseTo(95.9);
    expect(distribution[1].percentage).toBeCloseTo(2);
    expect(distribution[2].percentage).toBeCloseTo(1.1);
    expect(distribution[3].percentage).toBeCloseTo(1);
  });

  it('filters chart entries against their share of all scores', () => {
    expect(
      filterBeatmapModDistribution(
        calculateBeatmapModDistribution([
          { mods: Mods.None, scoreCount: 991 },
          { mods: Mods.Hidden, scoreCount: 9 },
        ])
      ).map(({ label }) => label)
    ).toEqual(['NM']);
  });

  it('collapses combinations below the threshold into a trailing Other slice', () => {
    const distribution = collapseBeatmapModDistribution(
      calculateBeatmapModDistribution([
        { mods: Mods.None, scoreCount: 940 },
        { mods: Mods.Hidden, scoreCount: 50 },
        { mods: Mods.Hidden | Mods.DoubleTime | Mods.HardRock, scoreCount: 5 },
        { mods: Mods.Flashlight, scoreCount: 4 },
        { mods: Mods.Easy, scoreCount: 1 },
      ])
    );

    expect(
      distribution.map(({ label, scoreCount }) => ({ label, scoreCount }))
    ).toEqual([
      { label: 'NM', scoreCount: 940 },
      { label: 'HD', scoreCount: 50 },
      { label: BEATMAP_MOD_OTHER_LABEL, scoreCount: 10 },
    ]);
    expect(distribution[2].percentage).toBeCloseTo(1);
  });

  it('omits the Other slice when every combination meets the threshold', () => {
    expect(
      collapseBeatmapModDistribution(
        calculateBeatmapModDistribution([
          { mods: Mods.None, scoreCount: 90 },
          { mods: Mods.Hidden, scoreCount: 10 },
        ])
      ).map(({ label }) => label)
    ).toEqual(['NM', 'HD']);
  });

  it('returns no usage for empty or invalid counts', () => {
    expect(calculateBeatmapModDistribution([])).toEqual([]);
    expect(
      calculateBeatmapModDistribution([
        { mods: Mods.Hidden, scoreCount: 0 },
        { mods: Mods.HardRock, scoreCount: Number.NaN },
      ])
    ).toEqual([]);
  });
});

describe('beatmap list mod display helpers', () => {
  it('groups layered score mods by their dominant gameplay mod', () => {
    const distribution = calculateBeatmapListModDistribution([
      { mods: Mods.DoubleTime, scoreCount: 10 },
      { mods: Mods.Hidden | Mods.DoubleTime, scoreCount: 20 },
      { mods: Mods.Nightcore, scoreCount: 30 },
      { mods: Mods.Hidden, scoreCount: 5 },
      { mods: Mods.HardRock, scoreCount: 10 },
      { mods: Mods.Hidden | Mods.HardRock, scoreCount: 15 },
      { mods: Mods.Easy, scoreCount: 10 },
      { mods: Mods.Hidden | Mods.Easy, scoreCount: 15 },
      { mods: Mods.DoubleTime | Mods.Easy, scoreCount: 25 },
      { mods: Mods.HalfTime, scoreCount: 10 },
      { mods: Mods.Hidden | Mods.HalfTime, scoreCount: 10 },
      { mods: Mods.HardRock | Mods.HalfTime, scoreCount: 10 },
      { mods: Mods.Flashlight, scoreCount: 10 },
      { mods: Mods.Hidden | Mods.Flashlight, scoreCount: 15 },
    ]);

    expect(
      distribution.map(({ label, scoreCount }) => ({ label, scoreCount }))
    ).toEqual([
      { label: 'DT', scoreCount: 60 },
      { label: 'HT', scoreCount: 30 },
      { label: 'DTEZ', scoreCount: 25 },
      { label: 'EZ', scoreCount: 25 },
      { label: 'FL', scoreCount: 25 },
      { label: 'HR', scoreCount: 25 },
      { label: 'HD', scoreCount: 5 },
    ]);
  });

  it('keeps NM distinct and groups unsupported combinations as Other', () => {
    const distribution = calculateBeatmapListModDistribution([
      { mods: Mods.None, scoreCount: 20 },
      { mods: Mods.Hidden | Mods.HardRock | Mods.Flashlight, scoreCount: 10 },
      { mods: Mods.Easy | Mods.HardRock, scoreCount: 10 },
      { mods: Mods.Easy | Mods.HalfTime, scoreCount: 10 },
      { mods: Mods.SuddenDeath, scoreCount: 10 },
    ]);

    expect(
      distribution.map(({ label, scoreCount }) => ({ label, scoreCount }))
    ).toEqual([
      { label: 'Other', scoreCount: 40 },
      { label: 'NM', scoreCount: 20 },
    ]);
  });

  it('shows the second-ranked group at the inclusive 20% boundary', () => {
    const displayedGroups = selectBeatmapListModGroups(
      calculateBeatmapListModDistribution([
        { mods: Mods.None, scoreCount: 80 },
        { mods: Mods.Hidden, scoreCount: 20 },
      ])
    );

    expect(
      displayedGroups.map(({ label, percentage }) => ({ label, percentage }))
    ).toEqual([
      { label: 'NM', percentage: 80 },
      { label: 'HD', percentage: 20 },
    ]);
  });

  it('hides the second-ranked group below 20%', () => {
    const displayedGroups = selectBeatmapListModGroups(
      calculateBeatmapListModDistribution([
        { mods: Mods.None, scoreCount: 801 },
        { mods: Mods.Hidden, scoreCount: 199 },
      ])
    );

    expect(displayedGroups.map(({ label }) => label)).toEqual(['NM']);
  });

  it('never shows more than two groups', () => {
    const displayedGroups = selectBeatmapListModGroups(
      calculateBeatmapListModDistribution([
        { mods: Mods.None, scoreCount: 40 },
        { mods: Mods.Hidden, scoreCount: 30 },
        { mods: Mods.HardRock, scoreCount: 20 },
        { mods: Mods.DoubleTime, scoreCount: 10 },
      ])
    );

    expect(displayedGroups.map(({ label }) => label)).toEqual(['NM', 'HD']);
  });

  it('keeps the primary group when every group is below 20%', () => {
    const groups = [
      { label: 'NM', percentage: 19 },
      { label: 'HD', percentage: 18 },
      { label: 'HR', percentage: 17 },
    ];

    expect(selectBeatmapListModGroups(groups)).toEqual([groups[0]]);
    expect(selectBeatmapListModGroups([])).toEqual([]);
  });
});

describe('resolveGameDisplayMods', () => {
  it('uses the game mods when the game is not freemod', () => {
    expect(
      resolveGameDisplayMods({ isFreeMod: false, mods: Mods.HardRock }, [
        { mods: Mods.None },
      ])
    ).toEqual({ mods: Mods.HardRock, lazerMods: null, freemod: false });
  });

  it('reports the shared score combo for a uniform freemod game', () => {
    // The reported bug: freemod game records NoMod, every player used HD.
    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None }, [
        { mods: Mods.Hidden },
        { mods: Mods.Hidden | Mods.NoFail },
      ])
    ).toEqual({ mods: Mods.Hidden, lazerMods: null, freemod: false });
  });

  it('keeps No Fail when every freemod score has it', () => {
    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None }, [
        { mods: Mods.Hidden | Mods.NoFail },
        { mods: Mods.Hidden | Mods.NoFail },
      ])
    ).toEqual({
      mods: Mods.Hidden | Mods.NoFail,
      lazerMods: null,
      freemod: false,
    });
  });

  it('falls back to FM when freemod combinations genuinely differ', () => {
    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None }, [
        { mods: Mods.Hidden },
        { mods: Mods.HardRock },
      ])
    ).toEqual({ mods: Mods.None, lazerMods: null, freemod: true });
  });

  it('shows the forced mods beside FM', () => {
    expect(
      resolveGameDisplayMods(
        { isFreeMod: true, mods: Mods.FreeModAllowed | Mods.DoubleTime },
        [{ mods: Mods.DoubleTime | Mods.Hidden }, { mods: Mods.DoubleTime }]
      )
    ).toEqual({ mods: Mods.DoubleTime, lazerMods: null, freemod: true });
  });

  it('keeps the FM icon for a freemod game with no scores', () => {
    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None }, [])
    ).toEqual({ mods: Mods.None, lazerMods: null, freemod: true });
  });
});

describe('resolveGameDisplayMods with lazer mods', () => {
  it('uses the game lazer mods when the game is not freemod', () => {
    const lazerMods = [{ acronym: 'DT', settings: { speed_change: 1.2 } }];

    expect(
      resolveGameDisplayMods(
        { isFreeMod: false, mods: Mods.DoubleTime, lazerMods },
        []
      )
    ).toEqual({ mods: Mods.DoubleTime, lazerMods, freemod: false });
  });

  it('reports lazer mods every score shares, ignoring NF', () => {
    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None }, [
        {
          mods: Mods.Hidden,
          lazerMods: [{ acronym: 'HD' }, { acronym: 'DA' }],
        },
        {
          mods: Mods.Hidden | Mods.NoFail,
          lazerMods: [{ acronym: 'HD' }, { acronym: 'DA' }, { acronym: 'NF' }],
        },
      ]).lazerMods
    ).toEqual([{ acronym: 'HD' }, { acronym: 'DA' }]);
  });

  it('drops lazer mods when the scores differ in them', () => {
    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None }, [
        { mods: Mods.Hidden, lazerMods: [{ acronym: 'HD' }] },
        {
          mods: Mods.Hidden,
          lazerMods: [{ acronym: 'HD' }, { acronym: 'BR' }],
        },
      ])
    ).toEqual({ mods: Mods.Hidden, lazerMods: null, freemod: false });
  });
});

describe('getScoreDisplayMods', () => {
  it('moves No Fail to the header when every score in a No Mod lobby has it', () => {
    const scores = [{ mods: Mods.NoFail }, { mods: Mods.NoFail }];
    const game = { mods: Mods.None };
    const header = resolveGameDisplayMods(
      { ...game, isFreeMod: deriveGameIsFreeMod(game.mods, scores) },
      scores
    );

    expect(header).toEqual({
      mods: Mods.NoFail,
      lazerMods: null,
      freemod: false,
    });
    expect(scores.map((s) => getScoreDisplayMods(s.mods, header.mods))).toEqual(
      [Mods.None, Mods.None]
    );
  });

  it('shows nothing when a score matches its forced lobby', () => {
    const lobby = Mods.NoFail | Mods.DoubleTime;
    const header = resolveGameDisplayMods({ isFreeMod: false, mods: lobby }, [
      { mods: lobby },
    ]);

    expect(header.mods).toBe(lobby);
    expect(getScoreDisplayMods(lobby, header.mods)).toBe(Mods.None);
  });

  it('shows nothing when every freemod score shares one combination', () => {
    const scores = [
      { mods: Mods.Hidden | Mods.HardRock },
      { mods: Mods.Hidden | Mods.HardRock },
    ];
    const header = resolveGameDisplayMods(
      { isFreeMod: true, mods: Mods.None },
      scores
    );

    expect(scores.map((s) => getScoreDisplayMods(s.mods, header.mods))).toEqual(
      [Mods.None, Mods.None]
    );
  });

  it('shows each score its mods beyond the forced ones when they vary', () => {
    expect(
      getScoreDisplayMods(Mods.DoubleTime | Mods.Hidden, Mods.DoubleTime)
    ).toBe(Mods.Hidden);
    expect(getScoreDisplayMods(Mods.HardRock, Mods.None)).toBe(Mods.HardRock);
  });

  it('shows No Fail on the scores that differ by it alone', () => {
    const scores = [{ mods: Mods.Hidden | Mods.NoFail }, { mods: Mods.Hidden }];
    const header = resolveGameDisplayMods(
      { isFreeMod: true, mods: Mods.None },
      scores
    );

    expect(header).toEqual({
      mods: Mods.Hidden,
      lazerMods: null,
      freemod: false,
    });
    expect(scores.map((s) => getScoreDisplayMods(s.mods, header.mods))).toEqual(
      [Mods.NoFail, Mods.None]
    );
  });

  it('shows Nightcore on a score in a Double Time lobby', () => {
    expect(
      getScoreDisplayMods(Mods.DoubleTime | Mods.Nightcore, Mods.DoubleTime)
    ).toBe(Mods.Nightcore);
  });
});

describe('deriveGameIsFreeMod', () => {
  it('is freemod when scores vary from a NoMod game', () => {
    expect(deriveGameIsFreeMod(Mods.None, [{ mods: Mods.Hidden }])).toBe(true);
  });

  it('is not freemod when a NoMod game only has NoMod/NoFail scores', () => {
    expect(
      deriveGameIsFreeMod(Mods.None, [
        { mods: Mods.None },
        { mods: Mods.NoFail },
      ])
    ).toBe(false);
  });

  it('is freemod when the game carries the freemod-allowed flag', () => {
    expect(deriveGameIsFreeMod(Mods.FreeModAllowed, [])).toBe(true);
  });

  it('is not freemod for a forced-mod game', () => {
    expect(deriveGameIsFreeMod(Mods.HardRock, [{ mods: Mods.HardRock }])).toBe(
      false
    );
  });
});

describe('resolveGameDisplayMods No Fail for lazer games', () => {
  it('adds No Fail to the lobby lazer mods when every score has it', () => {
    expect(
      resolveGameDisplayMods(
        { isFreeMod: false, mods: Mods.Hidden, lazerMods: [{ acronym: 'HD' }] },
        [
          {
            mods: Mods.Hidden | Mods.NoFail,
            lazerMods: [{ acronym: 'HD' }, { acronym: 'NF' }],
          },
        ]
      ).lazerMods
    ).toEqual([{ acronym: 'HD' }, { acronym: 'NF' }]);
  });

  it('shows the required lazer mods with FM when freemod scores differ', () => {
    const lazerMods = [{ acronym: 'DA', settings: { approach_rate: 9 } }];

    expect(
      resolveGameDisplayMods({ isFreeMod: true, mods: Mods.None, lazerMods }, [
        { mods: Mods.Hidden, lazerMods: [{ acronym: 'HD' }, ...lazerMods] },
        { mods: Mods.HardRock, lazerMods: [{ acronym: 'HR' }, ...lazerMods] },
      ])
    ).toEqual({ mods: Mods.None, lazerMods, freemod: true });
  });
});

describe('getScoreDisplayLazerMods', () => {
  it('drops the lazer mods the header shows with the same settings', () => {
    expect(
      getScoreDisplayLazerMods(
        [
          { acronym: 'DT', settings: { speed_change: 1.2 } },
          { acronym: 'HD' },
          { acronym: 'DA', settings: { approach_rate: 9 } },
        ],
        [
          { acronym: 'DT', settings: { speed_change: 1.2 } },
          { acronym: 'DA', settings: { approach_rate: 10 } },
        ]
      )
    ).toEqual([
      { acronym: 'HD' },
      { acronym: 'DA', settings: { approach_rate: 9 } },
    ]);
  });

  it('keeps a stable score on its flags and a lazer score without a header list', () => {
    expect(getScoreDisplayLazerMods(null, [{ acronym: 'HD' }])).toBeNull();
    expect(getScoreDisplayLazerMods([{ acronym: 'HD' }], null)).toEqual([
      { acronym: 'HD' },
    ]);
  });
});
