'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import AccountMenu from '@/components/profile/AccountMenu';
import LoginButton from '@/components/profile/LoginButton';
import MobileAccountMenu from '@/components/profile/MobileAccountMenu';
import SearchCommandDialog from '@/components/search/SearchCommandDialog';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { hasAdminScope } from '@/lib/auth/roles';
import { usePendingApprovalCount } from '@/lib/hooks/usePendingApprovalCount';
import { useReportCount } from '@/lib/hooks/useReportCount';
import { useSession } from '@/lib/hooks/useSession';

import DesktopNav from './DesktopNav';
import MobileNav from './MobileNav';
import MobileNavTrigger from './MobileNavTrigger';
import { getNavEntries } from './navigation';
import SupportButton from './SupportButton';
import ThemeToggle from './ThemeToggle';

/**
 * The site header: the logo and navigation on the left (an Admin menu for
 * admins and a More menu for the docs and the API reference), search, the
 * theme switch, the support heart and the account menu on the right. Below laptop width
 * (1024px), where the admin's seven entries no longer fit, the navigation and
 * the account menu move into one menu with the same structure.
 */
export default function Header() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const user = useSession();
  const userId = user?.userId ?? null;
  const isAdmin = hasAdminScope(user?.scopes);
  // Both read 0 while signed out, and the admin count for non-admins.
  const unseenReports = useReportCount(isAdmin ? userId : null, true);
  const unreadReportUpdates = useReportCount(userId, false);
  const pendingApprovals = usePendingApprovalCount(isAdmin ? userId : null);

  const entries = getNavEntries({
    hasSession: Boolean(user),
    isAdmin,
    unseenReports,
    pendingApprovals,
  });

  const menuNotification =
    isAdmin && unseenReports > 0
      ? 'unseen reports'
      : isAdmin && pendingApprovals > 0
        ? 'approvals waiting'
        : unreadReportUpdates > 0
          ? 'unread report updates'
          : undefined;

  return (
    <header
      data-testid="header"
      className="sticky top-0 z-50 flex h-(--header-height-px) w-full items-center justify-between gap-4 border-b border-b-muted bg-card px-4 shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-3 lg:gap-4">
        <Link
          href="/"
          data-testid="header-logo"
          className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Image
            src="/logos/small.svg"
            alt="o!TR home"
            width={36}
            height={36}
            className="transition-transform motion-safe:hover:scale-105"
          />
        </Link>
        <DesktopNav entries={entries} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <SearchCommandDialog />
        <ThemeToggle />
        <SupportButton />
        <div className="ml-1 hidden lg:block">
          {user ? (
            <AccountMenu
              user={user}
              unreadReportUpdates={unreadReportUpdates}
            />
          ) : (
            <LoginButton size="sm" />
          )}
        </div>

        <Sheet
          modal={false}
          open={isMobileNavOpen}
          onOpenChange={setIsMobileNavOpen}
        >
          <MobileNavTrigger
            isOpen={isMobileNavOpen}
            notification={menuNotification}
          />
          <SheetContent
            overlay={false}
            closeButton={false}
            className="top-(--header-height-px) h-auto max-h-[calc(100dvh-var(--header-height-px))] w-full gap-0 overflow-y-auto border-t border-t-muted border-l-muted bg-card p-4 sm:max-w-xs lg:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex flex-col gap-4">
              <MobileAccountMenu
                user={user}
                unreadReportUpdates={unreadReportUpdates}
              />
              <Separator />
              <MobileNav entries={entries} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
