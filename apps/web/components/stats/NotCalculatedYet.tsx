import { EmptyState } from '@/components/kit/feedback/EmptyState';
import type { KitIcon } from '@/lib/kit/layout/icon';

/**
 * A stored statistic the data worker has not computed yet, such as after a
 * deploy that adds one, or on a copy no data worker runs against.
 */
export function NotCalculatedYet({ icon }: { icon: KitIcon }) {
  return (
    <EmptyState
      size="compact"
      icon={icon}
      title="Not calculated yet"
      description="These statistics are recalculated every day."
    />
  );
}
