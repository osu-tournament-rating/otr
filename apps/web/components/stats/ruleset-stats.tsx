'use client';

import type { Ruleset } from '@otr/core/osu';
import { createContext, type ReactNode, useContext } from 'react';

import { useListState } from '@/lib/kit/lists/use-list-state';
import type { RulesetStatsData } from '@/lib/orpc/schema/statsPage';

import { STATS_PARAMS } from './stats-params';

interface RulesetStatsContextValue {
  byRuleset: readonly RulesetStatsData[];
  /** English names of every country in `byRuleset`, from the server. */
  countryNames: Readonly<Record<string, string>>;
}

const RulesetStatsContext = createContext<RulesetStatsContextValue | null>(
  null
);

/**
 * Holds every ruleset's statistics once for the panels under the page's
 * ruleset switch, so the page sends them once however many panels read
 * them.
 */
export function RulesetStatsProvider({
  byRuleset,
  countryNames,
  children,
}: RulesetStatsContextValue & { children: ReactNode }) {
  return (
    <RulesetStatsContext.Provider value={{ byRuleset, countryNames }}>
      {children}
    </RulesetStatsContext.Provider>
  );
}

/**
 * The page's ruleset (`?ruleset=`). Every ruleset's data is on the page, so
 * a switch rewrites the address in place instead of rendering the page
 * again.
 */
export function useStatsRuleset(): Ruleset {
  return useListState(STATS_PARAMS, { shallow: true }).state.ruleset;
}

/** The page's ruleset's statistics, with the country names. */
export function useRulesetStats(): {
  ruleset: Ruleset;
  stats: RulesetStatsData | undefined;
  countryNames: Readonly<Record<string, string>>;
} {
  const ruleset = useStatsRuleset();
  const context = useContext(RulesetStatsContext);

  return {
    ruleset,
    stats: context?.byRuleset.find((entry) => entry.ruleset === ruleset),
    countryNames: context?.countryNames ?? {},
  };
}
