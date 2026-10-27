import type * as React from 'react';
import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react';

import {
  type DeltaDirection,
  formatRatingDelta,
  getDeltaDirection,
} from '@/lib/kit/format/number';
import { cn } from '@/lib/utils';

const ARROWS = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
} satisfies Record<DeltaDirection, LucideIcon>;

/**
 * A rating change: coloured text with an arrow and one decimal (`+12.3`),
 * never a pill. The sign and the arrow carry the direction; green for a
 * gain and red for a loss only reinforce it. It inherits the font size, so
 * it fits table cells, tiles and tooltips alike.
 */
export function RatingDelta({
  value,
  lowerIsBetter = false,
  className,
  ...props
}: {
  value: number;
  /** Colour a fall as good, as for volatility. The arrow still follows the sign. */
  lowerIsBetter?: boolean;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>) {
  const direction = getDeltaDirection(value);
  const Arrow = ARROWS[direction];
  const improved = direction === (lowerIsBetter ? 'down' : 'up');

  return (
    <span
      data-direction={direction}
      className={cn(
        // `items-baseline` with the arrow centred on its own: the number,
        // not the arrow, gives the box its baseline, so it sits on the
        // line's baseline and adds no height to the line (with
        // `items-center` the arrow's bottom took the baseline and a 20px
        // line grew to 22px).
        'inline-flex items-baseline gap-0.5 font-medium whitespace-nowrap tabular-nums',
        direction === 'flat'
          ? 'text-muted-foreground'
          : improved
            ? 'text-success-foreground'
            : 'text-destructive',
        className
      )}
      {...props}
    >
      <Arrow aria-hidden="true" className="size-[1em] shrink-0 self-center" />
      {formatRatingDelta(value)}
    </span>
  );
}
