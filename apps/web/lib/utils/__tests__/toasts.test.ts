import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  spyOn,
} from 'bun:test';
import { ORPCError } from '@orpc/client';
import { toast } from 'sonner';

import { ensureAdminSession } from '@/app/server/oRPC/procedures/shared/adminGuard';
import { assertCurrentBuild } from '@/app/server/oRPC/procedures/shared/currentBuild';
import { assertOutsideMaintenanceWindow } from '@/app/server/oRPC/procedures/shared/maintenanceWindow';
import { isolateMaintenanceWindowEnv } from '@/lib/maintenance-window.test-utils';

import { errorSaveToast } from '../toasts';

const GENERIC_MESSAGE = 'Failed to save due to an unexpected issue.';

const refusal = async (refuse: () => unknown) => {
  try {
    await refuse();
  } catch (error) {
    return error as ORPCError<string, unknown>;
  }

  throw new Error('Expected a refusal');
};

describe('errorSaveToast', () => {
  isolateMaintenanceWindowEnv();

  let toastError: ReturnType<typeof spyOn<typeof toast, 'error'>>;

  beforeEach(() => {
    toastError = spyOn(toast, 'error').mockImplementation(() => 0);
  });

  afterEach(() => {
    toastError.mockRestore();
    setSystemTime();
  });

  it('shows why the server refused invalid input', () => {
    errorSaveToast(
      new ORPCError('BAD_REQUEST', { message: 'Name cannot be empty' })
    );

    expect(toastError).toHaveBeenCalledWith('Name cannot be empty');
  });

  // The refusals the server explains, with what to do next (#1111)
  it.each([
    [
      'an admin who lost the admin role',
      () => ensureAdminSession({ dbUser: { id: 2, scopes: [] } }),
    ],
    [
      'a page from an older release',
      () => assertCurrentBuild('older-build', 'current-build'),
    ],
    [
      'an admin change during the maintenance window',
      () => {
        setSystemTime(new Date('2026-06-02T12:00:00.000Z'));
        return assertOutsideMaintenanceWindow(new Headers(), {
          subject: 'Admin changes',
        });
      },
    ],
  ])('shows why the server refused %s', async (_, refuse) => {
    const error = await refusal(refuse);

    errorSaveToast(error);

    expect(toastError).toHaveBeenCalledWith(error.message);
    expect(error.message).not.toBe(GENERIC_MESSAGE);
  });

  it('shows a generic message for an unexpected failure', () => {
    errorSaveToast(
      new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'An unexpected error occurred',
      })
    );
    errorSaveToast(new TypeError('Failed to fetch'));

    expect(toastError.mock.calls).toEqual([
      [GENERIC_MESSAGE],
      [GENERIC_MESSAGE],
    ]);
  });
});
