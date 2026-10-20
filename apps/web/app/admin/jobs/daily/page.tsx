import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/lib/auth/auth';
import { hasAdminScope } from '@/lib/auth/roles';

import DailyTotalsClient from './DailyTotalsClient';
import {
  DailyTotalsFrame,
  DailyTotalsSkeleton,
  RangeSwitchSkeleton,
} from './DailyTotalsFrame';

export const metadata: Metadata = {
  title: 'Daily totals',
};

export default async function DailyTotalsPage() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session || !hasAdminScope(session.dbUser?.scopes ?? [])) {
    redirect('/unauthorized');
  }

  return (
    <Suspense
      fallback={
        <DailyTotalsFrame actions={<RangeSwitchSkeleton />}>
          <DailyTotalsSkeleton />
        </DailyTotalsFrame>
      }
    >
      <DailyTotalsClient />
    </Suspense>
  );
}
