import { describe, expect, it } from 'bun:test';

import {
  getNavEntries,
  isMenuActive,
  isMenuLinkActive,
  isNavLinkActive,
  type NavEntry,
} from '@/components/header/navigation';
import { getSeeAllHref } from '@/components/search/see-all';

type MenuEntry = Extract<NavEntry, { kind: 'menu' }>;

const titles = (entries: NavEntry[]) => entries.map((entry) => entry.title);

const menu = (entries: NavEntry[], title: string): MenuEntry => {
  const entry = entries.find(
    (candidate): candidate is MenuEntry =>
      candidate.kind === 'menu' && candidate.title === title
  );
  if (!entry) throw new Error(`No ${title} menu`);
  return entry;
};

const linkTitles = (entry: MenuEntry) => entry.links.map((link) => link.title);

describe('getNavEntries', () => {
  it('gives signed-out visitors the public entries and More, no Admin', () => {
    const entries = getNavEntries({
      hasSession: false,
      isAdmin: false,
      unseenReports: 0,
    });

    expect(titles(entries)).toEqual([
      'Leaderboard',
      'Tournaments',
      'Beatmaps',
      'Stats',
      'Tools',
      'More',
    ]);
    expect(linkTitles(menu(entries, 'Tournaments'))).toEqual(['Browse']);
    expect(linkTitles(menu(entries, 'Tools'))).toEqual([
      'Filter reports',
      'Audit logs',
    ]);
    expect(linkTitles(menu(entries, 'More'))).toEqual([
      'Docs',
      'API reference',
    ]);
  });

  it('adds the session-only links for signed-in visitors', () => {
    const entries = getNavEntries({
      hasSession: true,
      isAdmin: false,
      unseenReports: 0,
    });

    expect(linkTitles(menu(entries, 'Tournaments'))).toEqual([
      'Browse',
      'Submit',
    ]);
    expect(linkTitles(menu(entries, 'Tools'))).toEqual([
      'Registrant filtering',
      'Filter reports',
      'Audit logs',
    ]);
    expect(titles(entries)).not.toContain('Admin');
  });

  it('adds the Admin menu before More for admins', () => {
    const entries = getNavEntries({
      hasSession: true,
      isAdmin: true,
      unseenReports: 0,
    });
    const admin = menu(entries, 'Admin');

    expect(titles(entries).slice(-2)).toEqual(['Admin', 'More']);
    expect(admin.links.map((link) => [link.title, link.href])).toEqual([
      ['Admin', '/admin'],
      ['Reports', '/admin/reports'],
      ['Approvals', '/admin/approvals'],
      ['Jobs', '/admin/jobs'],
    ]);
    expect(admin.notification).toBeUndefined();
  });

  it('puts unseen reports on the Admin trigger and the Reports item', () => {
    const admin = menu(
      getNavEntries({ hasSession: true, isAdmin: true, unseenReports: 3 }),
      'Admin'
    );

    expect(admin.notification).toBe('Unseen reports');
    expect(admin.links.find((link) => link.title === 'Reports')?.count).toBe(3);
  });

  it('puts waiting approvals on the Admin trigger and the Approvals item', () => {
    const admin = menu(
      getNavEntries({
        hasSession: true,
        isAdmin: true,
        unseenReports: 0,
        pendingApprovals: 2,
      }),
      'Admin'
    );

    expect(admin.notification).toBe('Approvals waiting');
    expect(admin.links.find((link) => link.title === 'Approvals')?.count).toBe(
      2
    );
  });

  it('writes every label in sentence case', () => {
    const entries = getNavEntries({
      hasSession: true,
      isAdmin: true,
      unseenReports: 0,
    });
    const labels = entries.flatMap((entry) =>
      entry.kind === 'menu'
        ? [entry.title, ...linkTitles(entry)]
        : [entry.title]
    );

    for (const label of labels) {
      const [, ...rest] = label.split(' ');
      // Only "API" may stay capitalised after the first word.
      expect(rest.filter((word) => /^[A-Z][a-z]/.test(word))).toEqual([]);
    }
  });
});

describe('active state', () => {
  it('marks a top-level link on its page and the pages under it', () => {
    expect(isNavLinkActive('/leaderboard', '/leaderboard')).toBe(true);
    expect(isNavLinkActive('/beatmaps/665721', '/beatmaps')).toBe(true);
    expect(isNavLinkActive('/beatmapsets', '/beatmaps')).toBe(false);
  });

  it('marks a dropdown link only on its own page', () => {
    const tournaments = menu(
      getNavEntries({ hasSession: true, isAdmin: false, unseenReports: 0 }),
      'Tournaments'
    );
    const [browse, submit] = tournaments.links;

    expect(isMenuLinkActive('/tournaments/submit', submit)).toBe(true);
    expect(isMenuLinkActive('/tournaments/submit', browse)).toBe(false);
    expect(isMenuActive('/tournaments/2693', tournaments)).toBe(true);
  });

  it('keeps Registrant filtering apart from Filter reports', () => {
    const tools = menu(
      getNavEntries({ hasSession: true, isAdmin: false, unseenReports: 0 }),
      'Tools'
    );
    const [filtering, reports] = tools.links;

    expect(isMenuLinkActive('/tools/filter-reports', filtering)).toBe(false);
    expect(isMenuLinkActive('/tools/filter-reports', reports)).toBe(true);
  });

  it('marks the Admin menu anywhere under /admin', () => {
    const admin = menu(
      getNavEntries({ hasSession: true, isAdmin: true, unseenReports: 0 }),
      'Admin'
    );

    expect(isMenuActive('/admin/reports', admin)).toBe(true);
    expect(isMenuActive('/admin/design', admin)).toBe(true);
    expect(isMenuActive('/reports', admin)).toBe(false);
  });

  it('never marks an outside link', () => {
    const more = menu(
      getNavEntries({ hasSession: false, isAdmin: false, unseenReports: 0 }),
      'More'
    );

    expect(isMenuActive('/', more)).toBe(false);
    expect(isMenuActive('/spec', more)).toBe(true);
  });
});

describe('getSeeAllHref', () => {
  it('opens each list with the term as its search', () => {
    expect(getSeeAllHref('beatmaps', 'KAC 2012')).toBe('/beatmaps?q=KAC+2012');
    expect(getSeeAllHref('players', 'Stage')).toBe('/leaderboard?q=Stage');
  });

  // The search found every ruleset's tournaments, so the list must not open
  // on the visitor's browsing ruleset.
  it('opens the tournament list on every ruleset', () => {
    expect(getSeeAllHref('tournaments', 'world cup')).toBe(
      '/tournaments?q=world+cup&ruleset=all'
    );
  });

  it('drops a term too short to search', () => {
    expect(getSeeAllHref('beatmaps', 'a')).toBe('/beatmaps');
    expect(getSeeAllHref('tournaments', 'a')).toBe('/tournaments?ruleset=all');
  });
});
