import {
  AdminJobsFrame,
  JobsPanelSkeleton,
  QueuesPanelSkeleton,
} from './AdminJobsFrame';

export default function AdminJobsLoading() {
  return (
    <AdminJobsFrame>
      <QueuesPanelSkeleton />
      <JobsPanelSkeleton />
    </AdminJobsFrame>
  );
}
