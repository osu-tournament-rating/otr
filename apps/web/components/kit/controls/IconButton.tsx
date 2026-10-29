import { Slottable } from '@radix-ui/react-slot';
import type * as React from 'react';

import { ON_ART_CONTROL_CLASSES } from '@/components/kit/controls/Button';
import { Button as BaseButton } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { KitIcon } from '@/lib/kit/layout/icon';
import { cn } from '@/lib/utils';

/**
 * - `ghost`: the default. A muted icon that fills on hover, for section
 *   headers, rows, toolbars inside panels and dialog headers.
 * - `outline`: a bordered square beside inputs and other outline buttons.
 * - `overlay`: the round dark pill on cover art.
 */
export type IconButtonVariant = 'ghost' | 'outline' | 'overlay';

/** The same three heights as Button: 32px, 36px and 40px. */
export type IconButtonSize = 'sm' | 'default' | 'lg';

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'size-8',
  default: 'size-9',
  lg: 'size-10',
};

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  // The hover fill comes from the shadcn ghost variant.
  ghost: 'text-muted-foreground',
  outline: '',
  overlay: ON_ART_CONTROL_CLASSES,
};

// The fill that stays while the menu, popover or dialog the button opens is
// open. A disclosure toggle goes without it: an expanded row is not an open
// menu, and Radix Collapsible sets the same `data-state="open"`.
const OPEN_CLASSES: Record<IconButtonVariant, string> = {
  ghost: 'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
  outline: 'data-[state=open]:bg-accent',
  // In ON_ART_CONTROL_CLASSES.
  overlay: '',
};

const DESTRUCTIVE_CLASSES =
  'text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20 data-[state=open]:bg-destructive/10 data-[state=open]:text-destructive dark:hover:bg-destructive/20 dark:focus-visible:ring-destructive/40';

export type IconButtonProps = Omit<
  React.ComponentProps<'button'>,
  'children'
> & {
  /** The accessible name and the tooltip, in sentence case: "View audit history". */
  label: string;
  /** The lucide glyph. With `asChild` it goes inside the child element. */
  icon?: KitIcon;
  /**
   * Tooltip text when it should differ from `label`. `false` drops the
   * tooltip, only for an X that closes or clears, which needs no
   * explanation.
   */
  tooltip?: React.ReactNode | false;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Red icon and fill, for a single destructive action outside a menu. */
  destructive?: boolean;
  /**
   * Makes the button a disclosure toggle for content that expands in place,
   * such as a row's details: it sets `aria-expanded` and keeps the resting
   * look while open, because the open fill means "this menu is open". Leave
   * it undefined on menu, popover and dialog triggers.
   */
  expanded?: boolean;
  /** Draws the button on its child, such as a `Link`. */
  asChild?: boolean;
  /** A custom glyph in place of `icon`, or the element `asChild` draws on. */
  children?: React.ReactNode;
};

/**
 * The one icon-only button: a square (round on art) with a hover fill, an
 * accessible name and a tooltip that repeats it, except on an X that closes
 * or clears. Put it inside DialogTrigger
 * or DropdownMenuTrigger with `asChild`; the tooltip stays on the button.
 */
export function IconButton({
  label,
  icon: Icon,
  tooltip,
  tooltipSide = 'top',
  variant = 'ghost',
  size = 'sm',
  destructive = false,
  expanded,
  asChild = false,
  type,
  className,
  children,
  ...props
}: IconButtonProps) {
  const disclosure = expanded !== undefined;

  const button = (
    <BaseButton
      data-slot="icon-button"
      variant={variant === 'ghost' ? 'ghost' : 'outline'}
      size="icon"
      asChild={asChild}
      type={asChild ? type : (type ?? 'button')}
      aria-label={label}
      aria-expanded={expanded}
      className={cn(
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        !disclosure && OPEN_CLASSES[variant],
        destructive && variant !== 'overlay' && DESTRUCTIVE_CLASSES,
        className
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden /> : null}
      <Slottable>{children}</Slottable>
    </BaseButton>
  );

  if (tooltip === false) return button;

  // The tooltip only names the button, so it closes as the pointer leaves.
  // Kept open on hover, it would cover the next control the pointer heads
  // for, such as the Admin menu above a hero's actions.
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={6} collisionPadding={8}>
        {tooltip ?? label}
      </TooltipContent>
    </Tooltip>
  );
}
