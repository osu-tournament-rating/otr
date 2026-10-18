import {
  Beatmap,
  BeatmapAttributesBuilder,
  Difficulty,
  GameMode,
} from 'rosu-pp-js';

/**
 * Bump together with the pinned rosu-pp-js version; a change recomputes every
 * row. Values follow the osu! algorithm that this rosu-pp-js release
 * implements, which can lag behind osu!'s own star rating.
 */
export const CALCULATOR = 'rosu-pp-js@4.0.1';

export interface CalculatedAttributes {
  mods: number;
  sr: number;
  ar: number;
  cs: number;
  od: number;
  hp: number;
}

export type CalculationResult =
  | { status: 'ok'; attributes: CalculatedAttributes[] }
  | { status: 'unsupported'; reason: string };

// rosu-pp-js objects hold wasm memory; free it right away instead of waiting
// for the garbage collector.
const withFree = <TResource extends { free(): void }, TResult>(
  resource: TResource,
  use: (resource: TResource) => TResult
): TResult => {
  try {
    return use(resource);
  } finally {
    resource.free();
  }
};

// rosu-pp-js approximates each bezier curve in time that grows with the
// square of its control points, and it runs on the worker's only thread, so
// one curve of 80,000 points blocks every consumer for minutes; isSuspicious()
// lets that through. This bound is about as much work as one curve of 10,000
// points, roughly 0.25 s per mods key.
const MAX_SLIDER_CURVE_COST = 10_000 ** 2;
const SLIDER_TYPE_BIT = 2;
const HIT_OBJECTS_SECTION = '[HitObjects]';

/**
 * The sum of the squared control point counts of every slider curve segment,
 * counting each curve as bezier. A segment ends at a repeated point (a red
 * anchor) or, in lazer files, where the path names another curve type.
 */
export const sliderCurveCost = (bytes: Uint8Array) => {
  const text = new TextDecoder().decode(bytes);
  const start = text.indexOf(HIT_OBJECTS_SECTION);

  if (start === -1) {
    return 0;
  }

  const lines = text.slice(start + HIT_OBJECTS_SECTION.length).split('\n');
  let cost = 0;

  for (const line of lines) {
    if (line.startsWith('[')) {
      break;
    }

    const [x, y, , type, , curve] = line.split(',', 6);

    if (curve === undefined || (Number(type) & SLIDER_TYPE_BIT) === 0) {
      continue;
    }

    // The slider's position is the curve's first control point.
    let previous = `${x}:${y}`;
    let points = 1;

    for (const token of curve.split('|')) {
      if (token === previous || /^[a-z]/i.test(token)) {
        cost += points ** 2;
        points = 1;
      } else {
        points += 1;
      }

      previous = token;
    }

    cost += points ** 2;
  }

  return cost;
};

// rosu-pp-js returns f32 values widened to double (CS 4 with HR is
// 5.199999809265137), so two decimals drop the noise.
const roundStat = (value: number) => Math.round(value * 100) / 100;

const calculateForMods = (map: Beatmap, mods: number): CalculatedAttributes => {
  const sr = withFree(new Difficulty({ mods }), (difficulty) =>
    withFree(difficulty.calculate(map), (attributes) => attributes.stars)
  );

  // build() consumes the builder, so only the attributes it returns are freed.
  return withFree(
    new BeatmapAttributesBuilder({ map, mods }).build(),
    ({ ar, cs, od, hp }) => ({ mods, sr, ar, cs, od, hp })
  );
};

/**
 * Calculates osu! standard difficulty attributes for each beatmap_attributes
 * mods key. Unsupported when the file is not a usable osu! standard map:
 * rosu-pp-js parses any bytes, so an empty or garbage file only shows up as a
 * map without hit objects.
 */
export const calculateBeatmapAttributes = (
  bytes: Uint8Array,
  mods: Iterable<number>
): CalculationResult => {
  let map: Beatmap;
  try {
    map = new Beatmap(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unsupported', reason: `parse failed: ${message}` };
  }

  try {
    if (map.mode !== GameMode.Osu) {
      return {
        status: 'unsupported',
        reason: `not an osu! standard map (mode ${map.mode})`,
      };
    }

    if (map.nObjects === 0) {
      return { status: 'unsupported', reason: 'no hit objects' };
    }

    if (map.isSuspicious()) {
      return { status: 'unsupported', reason: 'suspicious hit objects' };
    }

    if (sliderCurveCost(bytes) > MAX_SLIDER_CURVE_COST) {
      return {
        status: 'unsupported',
        reason: 'slider curves too complex to calculate',
      };
    }

    const attributes: CalculatedAttributes[] = [];
    for (const key of new Set(mods)) {
      const calculated = calculateForMods(map, key);
      const { sr, ar, cs, od, hp } = calculated;

      if (![sr, ar, cs, od, hp].every(Number.isFinite)) {
        return {
          status: 'unsupported',
          reason: `non-finite attributes for mods ${key}`,
        };
      }

      attributes.push({
        mods: key,
        sr,
        ar: roundStat(ar),
        cs: roundStat(cs),
        od: roundStat(od),
        hp: roundStat(hp),
      });
    }

    return { status: 'ok', attributes };
  } finally {
    map.free();
  }
};
