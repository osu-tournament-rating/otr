import { userActivityDaily } from '@otr/core/db/schema';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// Players already recorded today by this process, so a session lookup writes
// at most once a day per player. Cleared when the UTC day changes.
let recordedDay = '';
const recordedPlayers = new Set<number>();

/**
 * Marks a signed-in player as active on the current UTC day, for the monthly
 * active users panel in Grafana. A failed write is logged and retried on the
 * player's next session lookup; it never fails the lookup itself.
 */
export const recordUserActivity = async (playerId: number) => {
  const day = new Date().toISOString().slice(0, 10);

  if (day !== recordedDay) {
    recordedDay = day;
    recordedPlayers.clear();
  }

  if (recordedPlayers.has(playerId)) {
    return;
  }

  recordedPlayers.add(playerId);

  try {
    await db
      .insert(userActivityDaily)
      .values({ day, playerId })
      .onConflictDoNothing();
  } catch (error) {
    recordedPlayers.delete(playerId);
    logger.error('Failed to record user activity', { error });
  }
};
