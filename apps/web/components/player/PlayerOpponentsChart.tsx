'use client';

import type { Ruleset } from '@otr/core/osu';
import { Swords } from 'lucide-react';

import { OPPONENT_COLOR } from '@/lib/kit/color/categorical';
import type { PlayerFrequency } from '@/lib/orpc/schema/playerStats';

import PlayerFrequencyChart from './PlayerFrequencyChart';

export default function PlayerOpponentsChart({
  className,
  opponents,
  ruleset,
}: {
  className?: string;
  opponents: PlayerFrequency[];
  /** The ruleset the profile shows; the chart's links open it too. */
  ruleset: Ruleset;
}) {
  return (
    <PlayerFrequencyChart
      className={className}
      data={opponents}
      title="Frequent opponents"
      icon={Swords}
      emptyTitle="No opponent data"
      ruleset={ruleset}
      color={OPPONENT_COLOR.css}
    />
  );
}
