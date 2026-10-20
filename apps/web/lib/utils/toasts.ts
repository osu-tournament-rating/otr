import { ORPCError } from '@orpc/client';
import { toast } from 'sonner';

/**
 * Whether the server refused the save and said why. That covers every 4xx
 * refusal, such as invalid input, an expired session, a lost admin role, or a
 * page from an older release, plus the maintenance window, which answers 503.
 * Other server errors carry no reason worth showing.
 */
const isRefusal = (error: ORPCError<string, unknown>) => {
  if (error.status < 500) {
    return true;
  }

  const code = (error.data as { code?: unknown } | undefined)?.code;
  return code === 'MAINTENANCE_WINDOW';
};

export function saveToast() {
  toast.success('Saved');
}

export function errorSaveToast(error?: unknown) {
  const message =
    error instanceof ORPCError && isRefusal(error)
      ? error.message
      : 'Failed to save due to an unexpected issue.';

  toast.error(message);
}
