import { describe, expect, it } from 'bun:test';

import { pauseForMaintenanceWindow } from '../maintenance';

describe('pauseForMaintenanceWindow', () => {
  it('pauses until the window ends on Tuesday at 12:15 UTC', () => {
    expect(
      pauseForMaintenanceWindow(true)(new Date('2026-10-13T11:50:00Z'))
    ).toEqual(new Date('2026-10-13T12:15:00Z'));
  });

  it('does not pause outside the window, or when the window is off', () => {
    expect(
      pauseForMaintenanceWindow(true)(new Date('2026-10-13T12:15:00Z'))
    ).toBeNull();
    expect(
      pauseForMaintenanceWindow(false)(new Date('2026-10-13T11:50:00Z'))
    ).toBeNull();
  });
});
