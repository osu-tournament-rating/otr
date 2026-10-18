import { CurrentUserSchema, type CurrentUser } from '@/lib/orpc/schema/user';

export type SessionUser = CurrentUser;

export const mapAppSessionToUser = (session: unknown): SessionUser | null => {
  if (
    !session ||
    typeof session !== 'object' ||
    !('dbPlayer' in session) ||
    !(session as { dbPlayer: unknown }).dbPlayer
  ) {
    return null;
  }

  const { dbPlayer, dbUser } = session as {
    dbPlayer: {
      id: number;
      osuId: number | bigint;
      username: string;
      country: string;
    };
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  };

  const parsed = CurrentUserSchema.safeParse({
    userId: dbUser?.id ?? null,
    scopes: dbUser?.scopes ?? [],
    player: {
      id: dbPlayer.id,
      osuId: Number(dbPlayer.osuId),
      username: dbPlayer.username,
      country: dbPlayer.country,
    },
  });

  if (!parsed.success) {
    console.error('[session] Failed to map session', parsed.error);
    return null;
  }

  return parsed.data;
};
