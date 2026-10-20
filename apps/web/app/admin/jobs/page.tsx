import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/lib/auth/auth';
import { hasAdminScope } from '@/lib/auth/roles';

import AdminJobsClient from './AdminJobsClient';
import {
  AdminJobsFrame,
  JobsPanelSkeleton,
  QueuesPanelSkeleton,
} from './AdminJobsFrame';

export const metadata: Metadata = {
  title: 'Jobs',
};

export default async function AdminJobsPage() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session || !hasAdminScope(session.dbUser?.scopes ?? [])) {
    redirect('/unauthorized');
  }

  return (
    <AdminJobsFrame data-testid="admin-jobs">
      <Suspense
        fallback={
          <>
            <QueuesPanelSkeleton />
            <JobsPanelSkeleton />
          </>
        }
      >
        <AdminJobsClient />
      </Suspense>
    </AdminJobsFrame>
  );
}
