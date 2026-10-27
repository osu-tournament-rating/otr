import type * as React from 'react';
import type { Ruleset } from '@otr/core/osu';

import RulesetIcon from '@/components/icons/RulesetIcon';
import TapTooltip from '@/components/tap-tooltip';
import { getRulesetFullName, getRulesetLabel } from '@/lib/kit/format/ruleset';
import { cn } from '@/lib/utils';

/**
 * A ruleset's icon and short name, `taiko`, for rows, tiles and metadata
 * lines. `iconOnly` keeps just the icon, named by a tooltip that opens on
 * hover, focus and tap. Not a picker: ruleset controls live with the list
 * toolbar.
 */
export function RulesetName({
  ruleset,
  iconOnly = false,
  showIcon = true,
  className,
  ...props
}: {
  ruleset: Ruleset;
  /** Only the icon, with the full name (`osu!taiko`) in a tooltip. */
  iconOnly?: boolean;
  /** Set false for the bare label, as in a sentence. */
  showIcon?: boolean;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>) {
  const fullName = getRulesetFullName(ruleset);
  const icon = (
    <RulesetIcon
      ruleset={ruleset}
      aria-hidden="true"
      className="size-4 shrink-0 self-center fill-muted-foreground"
    />
  );

  if (iconOnly) {
    return (
      <span className={cn('inline-flex align-middle', className)} {...props}>
        <TapTooltip
          content={fullName}
          side="top"
          triggerAriaLabel={fullName}
          triggerClassName="inline-flex w-auto"
        >
          {icon}
        </TapTooltip>
      </span>
    );
  }

  // The label sets the baseline. With the icon first and every item
  // centered, the line would sit on the icon's bottom edge instead, and the
  // whole name would ride above the text beside it, as in a hero's meta row.
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 whitespace-nowrap',
        className
      )}
      {...props}
    >
      {showIcon ? icon : null}
      {getRulesetLabel(ruleset)}
    </span>
  );
}
