import { createStarRatingSpectrum } from '@/lib/beatmaps/star-rating-color';

/**
 * osu!'s difficulty spectrum. Use it as a solid pill fill with
 * `getStarRatingForegroundColor` for the text, which always clears 4.5:1.
 */
export {
  getStarRatingColor,
  getStarRatingForegroundColor,
} from '@/lib/beatmaps/star-rating-color';

/*
 * The spectrum at each of osu!'s stops and halfway between them, with only
 * its OKLab lightness moved (darker for light cards, lighter for dark ones)
 * until it clears 3:1 against the muted surface of that theme. The values
 * were computed once; between them the colors are interpolated like the
 * spectrum itself, so no color math runs in the browser.
 */
const MARK_STOPS: readonly (readonly [
  starRating: number,
  light: string,
  dark: string,
])[] = [
  [0.1, '#3c8af4', '#4290fb'],
  [0.68, '#2b91e2', '#49aafd'],
  [1.25, '#0993d0', '#4fc0ff'],
  [1.63, '#0099a1', '#4fe3eb'],
  [2, '#009c78', '#4fffd5'],
  [2.25, '#009f4a', '#68ffa3'],
  [2.5, '#00a200', '#7cff4f'],
  [2.9, '#6d9900', '#c5f856'],
  [3.3, '#978f00', '#f6f05c'],
  [3.75, '#b6800a', '#fbc262'],
  [4.2, '#df634d', '#ff8068'],
  [4.55, '#e9575a', '#ff6b6c'],
  [4.9, '#f84769', '#ff4e6f'],
  [5.35, '#e54a99', '#e54a99'],
  [5.8, '#c645b8', '#c645b8'],
  [6.25, '#9f56cc', '#9f56cc'],
  [6.7, '#6563de', '#6563de'],
  [7.2, '#4b49bb', '#5a5ccf'],
  [7.7, '#18158e', '#4760d8'],
  [8.35, '#120f68', '#4f63be'],
  [8.99, '#030210', '#696a83'],
];

const getLightMarkColor = createStarRatingSpectrum(
  MARK_STOPS.map(([starRating, light]) => [starRating, light]),
  '#8b8b8b',
  '#000000'
);

const getDarkMarkColor = createStarRatingSpectrum(
  MARK_STOPS.map(([starRating, , dark]) => [starRating, dark]),
  '#aaaaaa',
  '#696969'
);

/**
 * A star-rating color for icons, text tints and chart marks on a card: the
 * spectrum color stepped darker for light cards and lighter for dark ones, so
 * it clears 3:1 in each theme while keeping its hue. It returns
 * `light-dark()`, which follows the theme's `color-scheme`.
 */
export function getStarRatingMarkColor(starRating: number): string {
  return `light-dark(${getLightMarkColor(starRating)}, ${getDarkMarkColor(starRating)})`;
}
