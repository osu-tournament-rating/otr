import { biggestUpsets } from './stats/biggest-upsets';
import { headlineTotals } from './stats/headline-totals';
import type { PlatformStatDefinition } from './types';

/**
 * Every stored statistic. Each key appears once; the data worker computes
 * them, and the web app serves rows whose version matches.
 */
export const PLATFORM_STATS: readonly PlatformStatDefinition[] = [
  headlineTotals,
  biggestUpsets,
];
