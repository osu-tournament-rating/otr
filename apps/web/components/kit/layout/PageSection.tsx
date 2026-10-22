import { useId } from 'react';
import type * as React from 'react';

import { typeScale } from '@/components/kit/layout/Typography';
import type { KitIcon } from '@/lib/kit/layout/icon';
import { cn } from '@/lib/utils';

/**
 * A group of panels on a long page whose panels share something the page
 * can change, such as the stats page's panels for one ruleset: a divider, a
 * heading with a muted icon, the control on the right, and the panels under
 * it, 16px apart. Panels inside take `level={3}` on their SectionHeader.
 * Most pages need none; panels sit straight in the PageFrame.
 */
export function PageSection({
  icon: Icon,
  title,
  actions,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  /** Muted, like a SectionHeader's. */
  icon?: KitIcon;
  /** Sentence case; the section's h2. */
  title: string;
  /** The control the panels below follow, such as a RulesetSwitch. */
  actions?: React.ReactNode;
}) {
  const id = useId();

  return (
    <section
      data-slot="page-section"
      aria-labelledby={id}
      className={cn('flex flex-col gap-4', className)}
      {...props}
    >
      <div className="mt-4 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
          <h2 id={id} className={typeScale.sectionTitle}>
            {title}
          </h2>
        </div>
        {actions ? <div className="min-w-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
