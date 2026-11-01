import { Slottable } from '@radix-ui/react-slot';
import { LoaderCircle } from 'lucide-react';
import type * as React from 'react';

import { Button as BaseButton } from '@/components/ui/button';
import type { KitIcon } from '@/lib/kit/layout/icon';
import { cn } from '@/lib/utils';

/**
 * - `default`: the one primary action of a form, dialog or page.
 * - `outline`: secondary actions, such as Cancel, Back or a page's second button.
 * - `ghost`: quiet actions inside a panel, such as Clear all or a Load more
 *   inside an opened row. A list's own footer is LoadMore (outline).
 * - `destructive`: an action that deletes or overwrites data. Red text and
 *   border, never filled; it opens a ConfirmDialog.
 * - `destructive-confirm`: the solid red button that carries out a
 *   destructive action, only as the final confirm in a dialog. It fills
 *   with `destructive` behind white text, at 60% in dark mode, as stock
 *   shadcn does.
 * - `overlay`: the dark pill on cover art, white in both themes.
 */
export type ButtonVariant =
  | 'default'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'destructive-confirm'
  | 'overlay';

/**
 * - `sm` (32px): inside panels and heroes: section headers, rows, hero
 *   actions, menus and popovers.
 * - `default` (36px): form and dialog actions, page header actions.
 * - `lg` (40px): list toolbars, beside the 40px search field and sort select.
 */
export type ButtonSize = 'sm' | 'default' | 'lg';

/** The beatmap hero's dark pill. Art sits under a dark matte in both themes. */
export const ON_ART_CONTROL_CLASSES =
  'rounded-full border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-sm hover:bg-black/70 hover:text-white focus-visible:border-white/60 focus-visible:ring-white/40 data-[state=open]:bg-black/70';

const BASE_VARIANT = {
  default: 'default',
  outline: 'outline',
  ghost: 'ghost',
  destructive: 'outline',
  'destructive-confirm': 'destructive',
  overlay: 'outline',
} as const satisfies Record<ButtonVariant, string>;

// Added on top of the shadcn variant: the fill while a menu or popover it
// opens is open, and the looks shadcn does not have. Its hover fills and the
// solid red behind white text come from the shadcn variants themselves.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: '',
  outline: 'data-[state=open]:bg-accent',
  ghost: 'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
  destructive:
    'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive focus-visible:ring-destructive/20 data-[state=open]:bg-destructive/10 dark:border-destructive/50 dark:hover:bg-destructive/20 dark:focus-visible:ring-destructive/40',
  'destructive-confirm': '',
  overlay: ON_ART_CONTROL_CLASSES,
};

export type ButtonProps = Omit<React.ComponentProps<'button'>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading lucide icon. While `pending`, a spinner takes its place. */
  icon?: KitIcon;
  /** Shows a spinner and disables the button while its action runs. */
  pending?: boolean;
  /** Draws the button on its child, such as a `Link`. `icon` still leads. */
  asChild?: boolean;
  /**
   * Lets a long label wrap onto more lines instead of running out of its
   * container on a phone: the button keeps its size's height as a minimum
   * and grows with the label, which aligns left.
   */
  wrap?: boolean;
  children?: React.ReactNode;
};

// The size's height becomes a minimum, so one line still looks the same.
const WRAP_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-8',
  default: 'min-h-9',
  lg: 'min-h-10',
};

/**
 * The site's text button: three sizes, one primary per view, and red only
 * for destructive actions, filled only in the final confirm. Icon-only
 * controls use IconButton.
 */
export function Button({
  variant = 'default',
  size = 'default',
  icon: Icon,
  pending = false,
  asChild = false,
  wrap = false,
  disabled,
  type,
  className,
  children,
  ...props
}: ButtonProps) {
  const leading = pending ? (
    <LoaderCircle className="animate-spin" aria-hidden />
  ) : Icon ? (
    <Icon aria-hidden />
  ) : null;

  return (
    <BaseButton
      data-variant={variant}
      variant={BASE_VARIANT[variant]}
      size={size}
      asChild={asChild}
      // A plain button never submits a form by accident; pass type="submit".
      type={asChild ? type : (type ?? 'button')}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        VARIANT_CLASSES[variant],
        wrap &&
          cn(
            'h-auto max-w-full py-1.5 text-left whitespace-normal',
            WRAP_CLASSES[size]
          ),
        className
      )}
      {...props}
    >
      {leading}
      <Slottable>{children}</Slottable>
    </BaseButton>
  );
}
