'use client';

import { RulesetSwitch } from '@/components/kit/lists/RulesetSwitch';
import { useListState } from '@/lib/kit/lists/use-list-state';

import { STATS_PARAMS } from './stats-params';

/** The ruleset every panel under "By ruleset" shows. */
export default function StatsRulesetSwitch() {
  const {
    state: { ruleset },
    setState,
  } = useListState(STATS_PARAMS, { shallow: true });

  return (
    <RulesetSwitch
      value={ruleset}
      onValueChange={(next) => setState({ ruleset: next })}
    />
  );
}
