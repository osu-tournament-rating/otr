import { describe, expect, it } from 'bun:test';
import { Mods } from '@otr/core/osu';
import rosuPackage from 'rosu-pp-js/package.json';

import {
  CALCULATOR,
  calculateBeatmapAttributes,
  sliderCurveCost,
  type CalculatedAttributes,
  type CalculationResult,
} from '../calculator';

// rosu-pp-js reports 0.138 stars for bytes that are not a map, so a real
// calculation has to land well clear of it.
const EMPTY_MAP_STARS = 0.138;

const BASE = { ar: 9, cs: 4, od: 8, hp: 5 };

const syntheticOsuFile = ({
  mode = 0,
  hitObjects = [],
}: { mode?: number; hitObjects?: string[] } = {}) =>
  [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: audio.mp3',
    `Mode: ${mode}`,
    '',
    '[Metadata]',
    'Title:Synthetic',
    'Artist:o!TR',
    'Creator:o!TR',
    'Version:Test',
    '',
    '[Difficulty]',
    `HPDrainRate:${BASE.hp}`,
    `CircleSize:${BASE.cs}`,
    `OverallDifficulty:${BASE.od}`,
    `ApproachRate:${BASE.ar}`,
    'SliderMultiplier:1.4',
    'SliderTickRate:1',
    '',
    '[TimingPoints]',
    '0,300,4,2,0,60,1,0',
    '',
    '[HitObjects]',
    '64,64,1000,1,0,0:0:0:0:',
    '448,320,1150,1,0,0:0:0:0:',
    '64,320,1300,1,0,0:0:0:0:',
    '448,64,1450,1,0,0:0:0:0:',
    '256,192,1600,1,0,0:0:0:0:',
    '96,192,1750,1,0,0:0:0:0:',
    '416,192,1900,1,0,0:0:0:0:',
    '256,32,2050,1,0,0:0:0:0:',
    '256,352,2200,1,0,0:0:0:0:',
    '128,96,2350,1,0,0:0:0:0:',
    '384,288,2500,1,0,0:0:0:0:',
    '128,288,2650,1,0,0:0:0:0:',
    '64,192,2800,2,0,B|192:64|320:64|448:192,1,420',
    '448,320,3850,1,0,0:0:0:0:',
    '64,64,4000,1,0,0:0:0:0:',
    ...hitObjects,
    '',
  ].join('\n');

/** A slider at `time` whose curve has the given control points. */
const sliderLine = (time: number, points: string[]) =>
  `64,192,${time},2,0,B|${points.join('|')},1,420`;

const curvePoints = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `${100 + (index % 300)}:${100 + ((index * 7) % 200)}`
  );

const encode = (text: string) => new TextEncoder().encode(text);

const expectOk = (result: CalculationResult) => {
  if (result.status !== 'ok') {
    throw new Error(`expected ok, got unsupported: ${result.reason}`);
  }
  return result.attributes;
};

const calculate = (mods: number[]) => {
  const attributes = expectOk(
    calculateBeatmapAttributes(encode(syntheticOsuFile()), mods)
  );
  return new Map<number, CalculatedAttributes>(
    attributes.map((row) => [row.mods, row])
  );
};

describe('calculateBeatmapAttributes', () => {
  it('calculates nomod attributes from the file', () => {
    const nomod = calculate([0]).get(0)!;

    expect(nomod.sr).toBeGreaterThan(EMPTY_MAP_STARS * 10);
    expect(nomod).toMatchObject({ mods: 0, ...BASE });
  });

  it('scales CS, HP and OD with HardRock and Easy, rounded to 2 decimals', () => {
    const rows = calculate([0, Mods.HardRock, Mods.Easy]);
    const hardRock = rows.get(Mods.HardRock)!;
    const easy = rows.get(Mods.Easy)!;

    // CS 4 * 1.3 comes back from rosu-pp-js as 5.199999809265137.
    expect(hardRock.cs).toBe(5.2);
    expect(hardRock.hp).toBe(7);
    expect(hardRock.ar).toBe(10);
    expect(hardRock.od).toBe(10);

    expect(easy.cs).toBe(2);
    expect(easy.hp).toBe(2.5);
    expect(easy.ar).toBe(4.5);
    expect(easy.od).toBe(4);
  });

  it('includes the DoubleTime clock rate in SR and AR', () => {
    const rows = calculate([0, Mods.DoubleTime]);
    const nomod = rows.get(0)!;
    const doubleTime = rows.get(Mods.DoubleTime)!;

    expect(doubleTime.sr).toBeGreaterThan(nomod.sr);
    expect(doubleTime.ar).toBeGreaterThan(nomod.ar);
    // AR 9 preempt (600 ms) at 1.5x is 400 ms, which is AR 10.33.
    expect(doubleTime.ar).toBeCloseTo(10.33, 2);
    expect(doubleTime.cs).toBe(nomod.cs);
  });

  it('does not lower SR with Hidden', () => {
    const rows = calculate([0, Mods.Hidden]);

    expect(rows.get(Mods.Hidden)!.sr).toBeGreaterThanOrEqual(rows.get(0)!.sr);
  });

  it('returns one row per distinct key, in the order given', () => {
    const keys = [
      0,
      Mods.Hidden | Mods.HardRock,
      Mods.Hidden,
      Mods.HardRock | Mods.Hidden,
      Mods.Easy | Mods.Hidden | Mods.DoubleTime,
      0,
    ];

    const attributes = expectOk(
      calculateBeatmapAttributes(encode(syntheticOsuFile()), keys)
    );

    expect(attributes.map((row) => row.mods)).toEqual([
      0,
      Mods.Hidden | Mods.HardRock,
      Mods.Hidden,
      Mods.Easy | Mods.Hidden | Mods.DoubleTime,
    ]);
    for (const row of attributes) {
      expect(row.sr).toBeGreaterThan(EMPTY_MAP_STARS);
    }
  });

  it('returns the same values for the same file', () => {
    const bytes = encode(syntheticOsuFile());

    expect(calculateBeatmapAttributes(bytes, [0, Mods.DoubleTime])).toEqual(
      calculateBeatmapAttributes(bytes, [0, Mods.DoubleTime])
    );
  });

  it('rejects maps for other rulesets', () => {
    const result = calculateBeatmapAttributes(
      encode(syntheticOsuFile({ mode: 3 })),
      [0]
    );

    expect(result.status).toBe('unsupported');
  });

  it('rejects a slider curve too costly to calculate', () => {
    const bytes = encode(
      syntheticOsuFile({ hitObjects: [sliderLine(5000, curvePoints(12_000))] })
    );

    expect(calculateBeatmapAttributes(bytes, [0])).toEqual({
      status: 'unsupported',
      reason: 'slider curves too complex to calculate',
    });
  });

  it('accepts long sliders split into short segments', () => {
    // Each red anchor (a repeated point) starts a new segment.
    const points = curvePoints(500).flatMap((point) => [point, point]);
    const bytes = encode(
      syntheticOsuFile({
        hitObjects: Array.from({ length: 40 }, (_, index) =>
          sliderLine(5000 + index * 1000, points)
        ),
      })
    );

    expect(calculateBeatmapAttributes(bytes, [0]).status).toBe('ok');
  });

  it('rejects empty and garbage files', () => {
    const files = [
      new Uint8Array(),
      encode('<!DOCTYPE html><html><body>Not found</body></html>'),
      Uint8Array.from({ length: 256 }, (_, index) => (index * 37) % 256),
    ];

    for (const bytes of files) {
      expect(calculateBeatmapAttributes(bytes, [0]).status).toBe('unsupported');
    }
  });
});

describe('sliderCurveCost', () => {
  const cost = (...lines: string[]) =>
    sliderCurveCost(encode(`[HitObjects]\n${lines.join('\n')}\n`));

  it('squares the control points of each curve segment', () => {
    // The leading curve type closes a segment of just the slider's position
    // and stands in for it in the next, which has four points.
    expect(cost('0,0,1000,2,0,B|1:1|2:2|3:3,1,100')).toBe(1 + 4 ** 2);
    // A repeated point ends a segment and starts the next.
    expect(cost('0,0,1000,2,0,B|1:1|1:1|2:2|3:3,1,100')).toBe(
      1 + 2 ** 2 + 3 ** 2
    );
    // So does a curve type in the middle of a lazer path.
    expect(cost('0,0,1000,6,0,B|1:1|P|2:2|3:3,1,100')).toBe(
      1 + 2 ** 2 + 3 ** 2
    );
  });

  it('adds up every slider and skips other objects and sections', () => {
    expect(
      cost(
        '0,0,1000,2,0,B|1:1|2:2,1,100',
        '0,0,2000,1,0,0:0:0:0:',
        '0,0,3000,2,0,L|5:5,1,100',
        '[Colours]',
        '0,0,4000,2,0,B|1:1|2:2,1,100'
      )
    ).toBe(1 + 3 ** 2 + 1 + 2 ** 2);
    expect(sliderCurveCost(encode('osu file format v14\n'))).toBe(0);
  });
});

describe('CALCULATOR', () => {
  it('names the installed rosu-pp-js version', () => {
    expect(CALCULATOR).toBe(`rosu-pp-js@${rosuPackage.version}`);
  });
});
