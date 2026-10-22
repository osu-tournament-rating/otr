import {
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileCode,
  FileText,
  Filter,
  Flag,
  ListChecks,
  ShieldCheck,
  Trophy,
  Upload,
} from 'lucide-react';

import type { KitIcon } from '@/lib/kit/layout/icon';

/** One link inside a header dropdown, or in its group on the mobile menu. */
export type NavMenuLink = {
  title: string;
  href: string;
  icon: KitIcon;
  /** Opens in a new tab, for sites outside o!TR. */
  external?: boolean;
  /** The unseen count shown after the label, such as Admin › Reports. */
  count?: number;
  /** What the count means, for screen readers ("unseen"). */
  countLabel?: string;
  testId?: string;
};

export type NavEntry =
  | { kind: 'link'; title: string; href: string; testId: string }
  | {
      kind: 'menu';
      title: string;
      testId: string;
      links: NavMenuLink[];
      /** Shows the notification dot on the trigger; the text is read aloud. */
      notification?: string;
    };

export type NavContext = {
  hasSession: boolean;
  isAdmin: boolean;
  /** Pending reports the admin has not seen yet. */
  unseenReports: number;
  /** Tournament submissions and filter requests waiting for an admin. */
  pendingApprovals?: number;
};

export const DOCS_URL = 'https://docs.otr.stagec.net';
export const SUPPORT_URL = 'https://buymeacoffee.com/stagecodes';

/**
 * The header's navigation, shared by the desktop bar and the mobile menu so
 * both have the same structure. Links that need a session are left out for
 * signed-out visitors, and the Admin menu exists only for admins.
 */
export function getNavEntries({
  hasSession,
  isAdmin,
  unseenReports,
  pendingApprovals = 0,
}: NavContext): NavEntry[] {
  const entries: NavEntry[] = [
    {
      kind: 'link',
      title: 'Leaderboard',
      href: '/leaderboard',
      testId: 'nav-leaderboard',
    },
    {
      kind: 'menu',
      title: 'Tournaments',
      testId: 'nav-tournaments',
      links: [
        { title: 'Browse', href: '/tournaments', icon: Trophy },
        ...(hasSession
          ? [{ title: 'Submit', href: '/tournaments/submit', icon: Upload }]
          : []),
      ],
    },
    {
      kind: 'link',
      title: 'Beatmaps',
      href: '/beatmaps',
      testId: 'nav-beatmaps',
    },
    { kind: 'link', title: 'Stats', href: '/stats', testId: 'nav-stats' },
    {
      kind: 'menu',
      title: 'Tools',
      testId: 'nav-tools',
      links: [
        ...(hasSession
          ? [
              {
                title: 'Registrant filtering',
                href: '/tools/filter',
                icon: Filter,
              },
            ]
          : []),
        {
          title: 'Filter reports',
          href: '/tools/filter-reports',
          icon: FileText,
        },
        {
          title: 'Audit logs',
          href: '/tools/audit-logs',
          icon: ClipboardList,
        },
      ],
    },
  ];

  if (isAdmin) {
    entries.push({
      kind: 'menu',
      title: 'Admin',
      testId: 'nav-admin',
      notification:
        unseenReports > 0
          ? 'Unseen reports'
          : pendingApprovals > 0
            ? 'Approvals waiting'
            : undefined,
      links: [
        {
          title: 'Admin',
          href: '/admin',
          icon: ShieldCheck,
          testId: 'nav-admin-home',
        },
        {
          title: 'Reports',
          href: '/admin/reports',
          icon: Flag,
          count: unseenReports,
          countLabel: 'unseen',
          testId: 'nav-admin-reports',
        },
        {
          title: 'Approvals',
          href: '/admin/approvals',
          icon: ClipboardCheck,
          count: pendingApprovals,
          countLabel: 'waiting',
          testId: 'nav-admin-approvals',
        },
        {
          title: 'Jobs',
          href: '/admin/jobs',
          icon: ListChecks,
          testId: 'nav-admin-jobs',
        },
      ],
    });
  }

  entries.push({
    kind: 'menu',
    title: 'More',
    testId: 'nav-more',
    links: [
      { title: 'Docs', href: DOCS_URL, icon: BookOpen, external: true },
      { title: 'API reference', href: '/spec', icon: FileCode },
    ],
  });

  return entries;
}

/** True when `pathname` is `href` or a page under it (`/tournaments/12`). */
export function isUnderPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A top-level link is current on its own page and every page under it. */
export function isNavLinkActive(pathname: string, href: string): boolean {
  return isUnderPath(pathname, href);
}

/**
 * A dropdown link is current only on its own page, so Browse and Submit are
 * never both current; the menu's trigger is current anywhere under one of
 * its links.
 */
export function isMenuLinkActive(pathname: string, link: NavMenuLink): boolean {
  return !link.external && pathname === link.href;
}

export function isMenuActive(
  pathname: string,
  entry: Extract<NavEntry, { kind: 'menu' }>
): boolean {
  return entry.links.some(
    (link) => !link.external && isUnderPath(pathname, link.href)
  );
}
