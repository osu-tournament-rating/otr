import {
  isWithinMaintenanceWindow,
  MAINTENANCE_WINDOW_END_UTC_MINUTES,
} from '@otr/core/maintenance';

/**
 * For queues that call osu!: pauses claiming until the weekly maintenance
 * window ends, so the rating run sees no new data.
 */
export const pauseForMaintenanceWindow =
  (enabled: boolean) =>
  (now: Date): Date | null => {
    if (!enabled || !isWithinMaintenanceWindow(now)) {
      return null;
    }

    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        Math.floor(MAINTENANCE_WINDOW_END_UTC_MINUTES / 60),
        MAINTENANCE_WINDOW_END_UTC_MINUTES % 60
      )
    );
  };
