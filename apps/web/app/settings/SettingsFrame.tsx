import { KeyRound, Keyboard, Settings, UserX, Users } from 'lucide-react';
import type * as React from 'react';

import { SETTINGS_COPY } from '@/app/settings/settings-copy';
import { AllRulesetsIcon } from '@/components/icons/RulesetIcon';
import { FormGrid } from '@/components/kit/controls/FormPanel';
import { Callout } from '@/components/kit/feedback/Callout';
import {
  PanelSkeleton,
  PhoneRowListSkeleton,
  SectionHeaderSkeleton,
  SkeletonText,
  TableSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';

/** The settings page's frame and header, shared with its loading screen. */
export function SettingsFrame({
  children,
  ...props
}: React.ComponentProps<typeof PageFrame>) {
  return (
    <PageFrame {...props}>
      <PageHeader icon={Settings} title="Settings" />
      {children}
    </PageFrame>
  );
}

/** A field under its FormFieldLabel (a 20px row), then its 36px input. */
function FieldSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="flex min-h-5 items-center">
        <SkeletonText className="block h-3.5 w-16" />
      </span>
      <SkeletonText className="block h-9 w-full" />
    </div>
  );
}

// Each panel prints its static text, so it wraps to the loaded height at
// every width; bars stand in for what depends on the account.

export function DefaultRulesetPanelSkeleton({ label }: { label?: string }) {
  return (
    <PanelSkeleton label={label}>
      <SectionHeaderSkeleton
        icon={AllRulesetsIcon}
        title="Default ruleset"
        meta={false}
      />
      {/* "Your profile", then "Leaderboard and tournaments". */}
      <FormGrid className="p-4">
        <FieldSkeleton />
        <FieldSkeleton />
      </FormGrid>
    </PanelSkeleton>
  );
}

export function FriendsPanelSkeleton({ label }: { label?: string }) {
  return (
    <PanelSkeleton label={label}>
      <SectionHeaderSkeleton icon={Users} title="Friends" meta={false} />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">{SETTINGS_COPY.friends}</p>
          {/* "702 friends synced." */}
          <p>
            <SkeletonText className="w-36" />
          </p>
        </div>
        {/* Sync friends; Delete friends joins it once a list is synced. */}
        <SkeletonText className="block h-9 w-full sm:w-34" />
      </div>
    </PanelSkeleton>
  );
}

export function ApiKeysPanelSkeleton() {
  return (
    <PanelSkeleton>
      <SectionHeaderSkeleton icon={KeyRound} title="API keys" />
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted-foreground">{SETTINGS_COPY.apiKeys}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FieldSkeleton />
          <SkeletonText className="block h-9 w-full sm:w-36" />
        </div>
      </div>
      <TableSkeleton
        className="border-t"
        rows={1}
        cellHeight="h-9"
        columns={[
          { label: 'Key' },
          { label: 'Rate limit', width: 'w-48' },
          { label: 'Created', width: 'w-52', showFrom: 'lg' },
          { label: '', width: 'w-24', align: 'end' },
        ]}
        // A key's name over its preview and rate limit, then Copy and Delete.
        phoneRows={
          <PhoneRowListSkeleton rows={1} value="button" className="border-t" />
        }
      />
      <div className="flex flex-col gap-1 border-t px-4 py-3 text-xs text-muted-foreground">
        <p>{SETTINGS_COPY.apiKeysReminder}</p>
      </div>
    </PanelSkeleton>
  );
}

export function ShortcutsPanelSkeleton() {
  return (
    <PanelSkeleton>
      <SectionHeaderSkeleton
        icon={Keyboard}
        title="Keyboard shortcuts"
        meta={false}
      />
      {/* The switch's 14px label, then the switch. */}
      <div className="flex items-center justify-between gap-4 p-4">
        <SkeletonText className="block h-3.5 w-48" />
        <SkeletonText className="block h-5 w-9 rounded-full" />
      </div>
    </PanelSkeleton>
  );
}

export function DangerZonePanelSkeleton() {
  return (
    <PanelSkeleton>
      <SectionHeaderSkeleton icon={UserX} title="Delete account" meta={false} />
      <div className="p-4">
        {/* One block the size of the loaded callout: the callout is laid
            out, hidden, inside it, so the block wraps as the text does. */}
        <span
          data-slot="skeleton"
          aria-hidden="true"
          className="block animate-pulse rounded-lg bg-accent"
        >
          <Callout
            tone="danger"
            className="invisible"
            action={<span className="block h-8 w-42" />}
          >
            {SETTINGS_COPY.deleteAccount}
          </Callout>
        </span>
      </div>
    </PanelSkeleton>
  );
}
