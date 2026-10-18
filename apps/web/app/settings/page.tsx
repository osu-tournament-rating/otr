import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import AccountDeletionClient from '@/app/settings/AccountDeletionClient';
import ApiKeySettingsClient from '@/app/settings/ApiKeySettingsClient';
import DefaultRulesetClient from '@/app/settings/DefaultRulesetClient';
import FriendsSyncClient from '@/app/settings/FriendsSyncClient';
import ThemeHotkeyClient from '@/app/settings/ThemeHotkeyClient';
import {
  FriendsPanelSkeleton,
  SettingsFrame,
  ShortcutsPanelSkeleton,
} from '@/app/settings/SettingsFrame';
import { auth } from '@/lib/auth/auth';
import { orpc } from '@/lib/orpc/orpc';
import { getFriendCount } from '@/lib/db/player-friends';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
};

export default async function SettingsPage() {
  const headersList = await headers();
  const appSession = await auth.api.getSession({ headers: headersList });

  if (!appSession) {
    redirect('/unauthorized');
  }

  const [keys, settings] = await Promise.all([
    orpc.apiClients.getKeys(),
    orpc.users.getSettings(),
  ]);

  const playerId = appSession.dbPlayer?.id;
  const friendCount = playerId ? await getFriendCount(playerId) : 0;

  return (
    <SettingsFrame>
      <DefaultRulesetClient settings={settings} />
      <Suspense fallback={<FriendsPanelSkeleton />}>
        <FriendsSyncClient friendCount={friendCount} />
      </Suspense>
      <ApiKeySettingsClient
        initialKeys={keys}
        rateLimit={{ maxRequests: 60, timeWindowMs: 60_000 }}
      />
      <Suspense fallback={<ShortcutsPanelSkeleton />}>
        <ThemeHotkeyClient />
      </Suspense>
      <AccountDeletionClient />
    </SettingsFrame>
  );
}
