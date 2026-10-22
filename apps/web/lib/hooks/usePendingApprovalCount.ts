'use client';

import { useEffect, useState } from 'react';

import { orpc } from '@/lib/orpc/orpc';

const listeners = new Set<() => void>();

/** Reloads the header's count after an admin approves or denies something. */
export function notifyApprovalChange() {
  for (const listener of [...listeners]) listener();
}

/**
 * Tournament submissions and filter requests waiting for an admin, for the
 * header's Admin menu. Reads 0 without an admin, so a count never outlives a
 * sign-out or carries over to the next account.
 */
export function usePendingApprovalCount(adminUserId: number | null) {
  const [loaded, setLoaded] = useState<{ owner: number; count: number }>();

  useEffect(() => {
    if (!adminUserId) return;

    let active = true;
    let latest = 0;

    const load = () => {
      const request = ++latest;
      orpc.approvals
        .pendingCount({})
        .then((result) => {
          if (active && request === latest) {
            setLoaded({
              owner: adminUserId,
              count: result.submissions + result.filterRequests,
            });
          }
        })
        .catch(() => {});
    };

    load();
    listeners.add(load);

    return () => {
      active = false;
      listeners.delete(load);
    };
  }, [adminUserId]);

  return adminUserId && loaded?.owner === adminUserId ? loaded.count : 0;
}
