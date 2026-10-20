import {
  AdminApprovalsFrame,
  AdminApprovalsSkeleton,
} from './AdminApprovalsFrame';

export default function AdminApprovalsLoading() {
  return (
    <AdminApprovalsFrame>
      <AdminApprovalsSkeleton />
    </AdminApprovalsFrame>
  );
}
