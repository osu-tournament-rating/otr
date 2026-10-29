import { interpolateRgb } from 'd3-interpolate';
import { scaleLinear } from 'd3-scale';

/** A spectrum stop: a star rating and the color it takes. */
export type StarRatingStop = readonly [starRating: number, color: string];

/**
 * A star-rating color function over a list of stops, interpolated the way
 * osu! interpolates its spectrum: gamma-corrected RGB, `lowest` below 0.1
 * stars and `highest` from 9.
 */
export function createStarRatingSpectrum(
  stops: readonly StarRatingStop[],
  lowest: string,
  highest: string
): (starRating: number) => string {
  const spectrum = scaleLinear<string>()
    .domain(stops.map(([starRating]) => starRating))
    .clamp(true)
    .range(stops.map(([, color]) => color))
    .interpolate(interpolateRgb.gamma(2.2));

  return (starRating) => {
    const normalizedRating = Number.isNaN(starRating) ? 0 : starRating;

    if (normalizedRating < 0.1) return lowest;
    if (normalizedRating >= 9) return highest;

    return spectrum(normalizedRating);
  };
}

const difficultySpectrum = createStarRatingSpectrum(
  [
    [0.1, '#4290FB'],
    [1.25, '#4FC0FF'],
    [2, '#4FFFD5'],
    [2.5, '#7CFF4F'],
    [3.3, '#F6F05C'],
    [4.2, '#FF8068'],
    [4.9, '#FF4E6F'],
    [5.8, '#C645B8'],
    [6.7, '#6563DE'],
    [7.7, '#18158E'],
    [9, '#000000'],
  ],
  '#AAAAAA',
  '#000000'
);

type RgbColor = readonly [red: number, green: number, blue: number];

const DARK_FOREGROUND = '#000000';
const LIGHT_FOREGROUND = '#FFFFFF';
const FOREGROUND_LUMINANCE_THRESHOLD = 0.179;

function parseCssColor(color: string): RgbColor {
  if (color.startsWith('#')) {
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];
  }

  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels?.length !== 3) {
    throw new Error(`Unsupported star rating color: ${color}`);
  }

  const [red, green, blue] = channels;
  return [red, green, blue];
}

function relativeLuminance(color: RgbColor): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** osu!'s difficulty spectrum: gray below 0.1, gamma-corrected, black at 9+. */
export function getStarRatingColor(starRating: number): string {
  return difficultySpectrum(starRating);
}

/** Returns whichever neutral foreground has stronger contrast on the pill. */
export function getStarRatingForegroundColor(starRating: number): string {
  const background = parseCssColor(getStarRatingColor(starRating));

  return relativeLuminance(background) > FOREGROUND_LUMINANCE_THRESHOLD
    ? DARK_FOREGROUND
    : LIGHT_FOREGROUND;
}
