import { biggestComebacks } from './stats/biggest-comebacks';
import { biggestUpsets } from './stats/biggest-upsets';
import { closestGames } from './stats/closest-games';
import { headlineTotals } from './stats/headline-totals';
import { higherRatedWins } from './stats/higher-rated-wins';
import { strongestFields } from './stats/strongest-fields';
import type { PlatformStatDefinition } from './types';

/**
 * Every stored statistic. Each key appears once; the data worker computes
 * them, and the web app serves rows whose version matches.
 */
export const PLATFORM_STATS: readonly PlatformStatDefinition[] = [
  headlineTotals,
  higherRatedWins,
  biggestUpsets,
  closestGames,
  biggestComebacks,
  strongestFields,
];
