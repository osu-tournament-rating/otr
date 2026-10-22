import type * as React from 'react';

import TapTooltip from '@/components/tap-tooltip';
import { cn } from '@/lib/utils';

/**
 * A label with a subtle dotted underline that opens how its figure is
 * calculated, on hover, keyboard focus and tap, like InfoButton. Only where
 * the owner chose it over an info button: the tournament match cost.
 */
export function TermTooltip({
  children,
  hint,
  side = 'top',
  align = 'center',
  className,
}: {
  /** The label, such as "Match cost". It names the button. */
  children: React.ReactNode;
  /** The explanation: one short fragment. */
  hint: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <TapTooltip
      side={side}
      align={align}
      triggerClassName={cn(
        'inline w-auto underline decoration-muted-foreground decoration-dotted underline-offset-[3px]',
        className
      )}
      content={<span className="block max-w-56">{hint}</span>}
    >
      {children}
    </TapTooltip>
  );
}
