import { eq, inArray } from 'drizzle-orm';

import { auth_users, userActivityDaily, users } from '@otr/core/db/schema';
import { db } from '@/lib/db';

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
    console.error('Failed to record user activity', error);
  }
};

/**
 * Saves now as the user's last login, which admins see beside notes and
 * submissions. Called for each new session, so once per sign-in. A failed
 * write is logged; it never fails the sign-in.
 */
export const recordLastLogin = async (authUserId: string) => {
  try {
    await db
      .update(users)
      .set({ lastLogin: new Date().toISOString() })
      .where(
        inArray(
          users.playerId,
          db
            .select({ playerId: auth_users.playerId })
            .from(auth_users)
            .where(eq(auth_users.id, authUserId))
        )
      );
  } catch (error) {
    console.error('Failed to record last login', error);
  }
};
