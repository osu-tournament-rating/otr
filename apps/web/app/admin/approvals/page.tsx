import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/auth';
import { hasAdminScope } from '@/lib/auth/roles';

import AdminApprovalsClient from './AdminApprovalsClient';
import { AdminApprovalsFrame } from './AdminApprovalsFrame';

export const metadata: Metadata = {
  title: 'Approvals',
};

export default async function AdminApprovalsPage() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session || !hasAdminScope(session.dbUser?.scopes ?? [])) {
    redirect('/unauthorized');
  }

  return (
    <AdminApprovalsFrame data-testid="admin-approvals">
      <AdminApprovalsClient />
    </AdminApprovalsFrame>
  );
}
