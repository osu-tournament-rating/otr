import { describe, expect, it } from 'bun:test';

import { BUILD_ID } from '@/lib/build-id';

import { withCurrentBuildGuard } from '../../base';
import { assertCurrentBuild, STALE_BUILD_MESSAGE } from '../currentBuild';

const STALE = {
  code: 'PRECONDITION_FAILED',
  status: 412,
  message: STALE_BUILD_MESSAGE,
  data: { code: 'STALE_BUILD' },
};

describe('assertCurrentBuild', () => {
  it('allows a page built from this release', () => {
    expect(() => assertCurrentBuild('abc', 'abc')).not.toThrow();
  });

  it('refuses a page built from another release', () => {
    expect(() => assertCurrentBuild('old', 'abc')).toThrow(
      expect.objectContaining(STALE)
    );
  });

  it('refuses a page too old to send its build', () => {
    expect(() => assertCurrentBuild(null, 'abc')).toThrow(
      expect.objectContaining(STALE)
    );
  });

  it('allows calls from outside /rpc, which have no build', () => {
    expect(() => assertCurrentBuild(undefined, 'abc')).not.toThrow();
  });
});

describe('withCurrentBuildGuard', () => {
  const runGuard = (
    clientBuild: string | null | undefined,
    next: () => Promise<unknown>
  ) =>
    withCurrentBuildGuard(
      { context: { headers: new Headers(), clientBuild }, next } as never,
      undefined,
      (() => {}) as never
    );

  it('rejects a write from another release without running the procedure', async () => {
    let ran = false;

    await expect(
      runGuard('another-release', async () => {
        ran = true;
      })
    ).rejects.toMatchObject(STALE);
    expect(ran).toBe(false);
  });

  it('runs the procedure for a page of this release', async () => {
    let ran = false;

    await runGuard(BUILD_ID, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
