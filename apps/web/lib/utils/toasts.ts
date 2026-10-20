import { ORPCError } from '@orpc/client';
import { toast } from 'sonner';

/**
 * Refusals whose message says what happened and what to do: a page from an
 * older release, and an admin change during the maintenance window.
 */
const EXPLAINED_REFUSALS = new Set(['STALE_BUILD', 'MAINTENANCE_WINDOW']);

const isExplained = (error: ORPCError<string, unknown>) => {
  if (error.code === 'BAD_REQUEST') {
    return true;
  }

  const code = (error.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && EXPLAINED_REFUSALS.has(code);
};

export function saveToast() {
  toast.success('Saved');
}

export function errorSaveToast(error?: unknown) {
  const message =
    error instanceof ORPCError && isExplained(error)
      ? error.message
      : 'Failed to save due to an unexpected issue.';

  toast.error(message);
}
