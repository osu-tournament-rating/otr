import type * as React from 'react';

import { isCountContent } from '@/lib/kit/status/count';
import { cn } from '@/lib/utils';

export type BadgeTone =
  'neutral' | 'primary' | 'success' | 'warning' | 'destructive';
export type BadgeSize = 'sm' | 'md' | 'lg';
export type BadgeShape = 'pill' | 'rounded';

/** A domain colour (mods, tiers, star rating) and the text colour it needs. */
export interface BadgeCustomColor {
  background: string;
  foreground: string;
}

type BadgeColorProps =
  | {
      /** `soft` is the default label; `outline` sits quieter on tinted surfaces. */
      variant?: 'soft' | 'outline';
      tone?: BadgeTone;
      customColor?: never;
    }
  | {
      /** Solid fills are for counts; warning and red never fill solid. */
      variant: 'solid';
      tone?: 'neutral' | 'primary' | 'success';
      customColor?: never;
    }
  | {
      /** Over cover art only. */
      variant: 'overlay';
      tone?: never;
      customColor?: never;
    }
  | {
      customColor: BadgeCustomColor;
      variant?: never;
      tone?: never;
    };

export type BadgeProps = Omit<React.ComponentProps<'span'>, 'color'> &
  BadgeColorProps & {
    size?: BadgeSize;
    shape?: BadgeShape;
    /** A domain colour shown as the small chip in front of the label. */
    swatch?: string;
  };

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'h-5 min-w-5 gap-1 px-1.5 text-xs [&>svg]:size-3',
  md: 'h-6 min-w-6 gap-1.5 px-2 text-xs [&>svg]:size-3.5',
  lg: 'h-8 min-w-8 gap-1.5 px-2.5 text-sm [&>svg]:size-4',
};

const SHAPE_CLASSES: Record<BadgeShape, string> = {
  pill: 'rounded-full',
  rounded: 'rounded-md',
};

const SOFT_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-transparent bg-secondary text-secondary-foreground',
  // Primary text is under 4.5:1 on light surfaces, so only the icon is blue.
  primary:
    'border-primary/30 bg-primary/10 text-foreground [&>svg]:text-primary',
  success: 'border-success/30 bg-success/10 text-success-foreground',
  warning: 'border-warning/30 bg-warning/10 text-warning-foreground',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
};

const OUTLINE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-border bg-transparent text-foreground',
  primary:
    'border-primary/50 bg-transparent text-foreground [&>svg]:text-primary',
  success: 'border-success/50 bg-transparent text-success-foreground',
  warning: 'border-warning/50 bg-transparent text-warning-foreground',
  destructive: 'border-destructive/50 bg-transparent text-destructive',
};

const SOLID_CLASSES: Record<'neutral' | 'primary' | 'success', string> = {
  neutral: 'border-transparent bg-foreground text-background',
  primary: 'border-transparent bg-primary text-primary-foreground',
  success: 'border-transparent bg-success text-green-950',
};

const OVERLAY_CLASSES =
  'border-white/15 bg-black/60 text-white backdrop-blur-sm';

function colorClasses(variant: BadgeProps['variant'], tone: BadgeTone): string {
  switch (variant) {
    case 'outline':
      return OUTLINE_CLASSES[tone];
    case 'solid':
      return tone === 'warning' || tone === 'destructive'
        ? SOFT_CLASSES[tone]
        : SOLID_CLASSES[tone];
    case 'overlay':
      return OVERLAY_CLASSES;
    default:
      return SOFT_CLASSES[tone];
  }
}

/**
 * The one small label: verification and report states, mods, rulesets,
 * roles, tags and counts. Pick a tone for meaning, a size for the line it
 * sits in, and `customColor` or `swatch` for a domain palette. It is not a
 * control: it may sit inside a button (a filter count) but never acts alone.
 * A count (a number, or text such as `99+`, even with a screen-reader label
 * after it) takes tabular figures.
 */
export function Badge({
  variant = 'soft',
  tone = 'neutral',
  customColor,
  size = 'md',
  shape = 'pill',
  swatch,
  className,
  style,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      data-slot="kit-badge"
      className={cn(
        'inline-flex w-fit max-w-full shrink-0 items-center justify-center overflow-hidden border font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0',
        SIZE_CLASSES[size],
        SHAPE_CLASSES[shape],
        // Counts line up digit for digit; words keep Inter's narrow hyphen.
        isCountContent(children) && 'tabular-nums',
        customColor ? 'border-current/20' : colorClasses(variant, tone),
        className
      )}
      style={
        customColor
          ? {
              backgroundColor: customColor.background,
              color: customColor.foreground,
              ...style,
            }
          : style
      }
      {...props}
    >
      {swatch ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-xs"
          style={{ backgroundColor: swatch }}
        />
      ) : null}
      {children}
    </span>
  );
}
