import { ListRestart, ShieldCheck, UserSearch } from 'lucide-react';

import {
  PanelSkeleton,
  SectionHeaderSkeleton,
  SkeletonText,
} from '@/components/kit/feedback/Skeletons';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';

/**
 * A field under its FormFieldLabel, whose row is 20px tall. The ID fields'
 * eight-row textareas use 16px text below `md` and 14px from it.
 */
function FieldSkeleton({ inputClassName }: { inputClassName: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="flex min-h-5 items-center">
        <SkeletonText className="block h-3.5 w-20" />
      </span>
      <SkeletonText className={`block w-full ${inputClassName}`} />
    </div>
  );
}

const TEXTAREA_HEIGHT = 'h-[13.125rem] md:h-[11.125rem]';

/**
 * The admin home while it loads. The section descriptions are the page's
 * own static text, so each panel wraps to the loaded height at every width.
 */
export default function AdminLoading() {
  return (
    <PageFrame>
      <PageHeader icon={ShieldCheck} title="Admin" />
      <PanelSkeleton label="Loading admin tools">
        <SectionHeaderSkeleton
          icon={UserSearch}
          title="User lookup"
          meta={false}
        />
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Search for users by username or osu! ID to review ban status and API
            access.
          </p>
          <FieldSkeleton inputClassName="h-10" />
        </div>
      </PanelSkeleton>
      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={ListRestart}
          title="Mass enqueue"
          meta={false}
        />
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Mass enqueue beatmaps, matches, and players for refetch. Enter IDs
            separated by commas, spaces, or newlines. Only IDs that exist in the
            database will be enqueued.
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FieldSkeleton inputClassName={TEXTAREA_HEIGHT} />
            <FieldSkeleton inputClassName={TEXTAREA_HEIGHT} />
            <FieldSkeleton inputClassName={TEXTAREA_HEIGHT} />
          </div>
          {/* Priority: its 14px label, then the 16px row of radio buttons. */}
          <div className="flex flex-col gap-2">
            <SkeletonText className="block h-3.5 w-14" />
            <SkeletonText className="block h-4 w-56" />
          </div>
        </div>
        <div className="flex justify-end border-t bg-muted/30 px-4 py-3">
          <SkeletonText className="block h-9 w-full sm:w-36" />
        </div>
      </PanelSkeleton>
    </PageFrame>
  );
}
