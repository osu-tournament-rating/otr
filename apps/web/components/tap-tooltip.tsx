'use client';

import { ReactNode, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ACCENT_SURFACE_CLASSES } from '@/lib/kit/color/tokens';
import { cn } from '@/lib/utils';

interface TapTooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
  /** Concise accessible name for the trigger. */
  triggerAriaLabel?: string;
}

/** Hover shows a tooltip; click or Enter pins the same content in a popover. */
export default function TapTooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
  triggerClassName,
  triggerAriaLabel,
}: TapTooltipProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip open={tooltipOpen && !popoverOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={triggerAriaLabel}
              className={cn(
                'block w-full rounded text-left',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                triggerClassName
              )}
            >
              {children}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
        >
          {content}
        </TooltipContent>
      </Tooltip>
      {/* Same surface as the tooltip above: accent, no border */}
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          'w-auto max-w-[calc(100vw-2rem)] border-0 p-3 text-xs',
          ACCENT_SURFACE_CLASSES
        )}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}
