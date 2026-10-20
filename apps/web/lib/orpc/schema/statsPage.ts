import { z } from 'zod';

import type { HeadlineTotals } from '@otr/core/platform-stats';

const count = z.number().int().nonnegative();

/**
 * Stored statistics. Each schema checks a row the data worker saved, so its
 * type must match the payload type in `@otr/core/platform-stats`.
 */
export const HeadlineTotalsSchema = z.object({
  tournaments: count,
  matches: count,
  games: count,
  scores: count,
  ratedPlayers: count,
}) satisfies z.ZodType<HeadlineTotals>;

/**
 * Everything the stats page shows beyond `stats.platform`. A stored
 * statistic is null until the data worker has computed it.
 */
export const StatsPageSchema = z.object({
  allRulesets: z.object({
    totals: HeadlineTotalsSchema.nullable(),
  }),
});

export type StatsPage = z.infer<typeof StatsPageSchema>;
export type HeadlineTotalsData = z.infer<typeof HeadlineTotalsSchema>;
