import AllRuleset from '@/public/icons/rulesets/all.svg';
import Standard from '@/public/icons/rulesets/osu.svg';
import Taiko from '@/public/icons/rulesets/taiko.svg';
import Catch from '@/public/icons/rulesets/catch.svg';
import Mania from '@/public/icons/rulesets/mania.svg';
import Mania4k from '@/public/icons/rulesets/mania4k.svg';
import Mania7k from '@/public/icons/rulesets/mania7k.svg';
import { FC, SVGProps } from 'react';

import { Ruleset } from '@otr/core/osu';
import { cn } from '@/lib/utils';

const iconMap = {
  [Ruleset.Osu]: Standard,
  [Ruleset.Taiko]: Taiko,
  [Ruleset.Catch]: Catch,
  [Ruleset.ManiaOther]: Mania,
  [Ruleset.Mania4k]: Mania4k,
  [Ruleset.Mania7k]: Mania7k,
} satisfies { [key in Ruleset]: FC<SVGProps<SVGElement>> };

export default function RulesetIcon({
  ruleset,
  className,
  ...rest
}: { ruleset: Ruleset | 'all' } & SVGProps<SVGElement>) {
  const Icon = ruleset === 'all' ? AllRuleset : iconMap[ruleset];

  return (
    <Icon
      className={cn('antialiased [will-change:transform]', className)}
      {...rest}
    />
  );
}

/**
 * The all-rulesets glyph in its text colour, for a slot that takes a lucide
 * icon (`KitIcon`), such as a SectionHeader's.
 */
export function AllRulesetsIcon({
  className,
  ...props
}: {
  className?: string;
  'aria-hidden'?: boolean;
}) {
  return (
    <RulesetIcon
      ruleset="all"
      className={cn('fill-current', className)}
      {...props}
    />
  );
}
