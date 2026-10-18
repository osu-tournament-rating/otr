import { describe, expect, it } from 'bun:test';
import {
  AlertCircle,
  Compass,
  Lock,
  ShieldAlert,
  ShieldQuestion,
} from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SectionError from '@/components/error/SectionError';
import { Callout } from '@/components/kit/feedback/Callout';
import { CalloutChip } from '@/components/kit/feedback/CalloutChip';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import {
  ChartPlotSkeleton,
  HeroTabsSkeleton,
  ListToolbarSkeleton,
  LoadMoreSkeleton,
  PanelSkeleton,
  PhoneRowListSkeleton,
  RowListSkeleton,
  RulesetSwitchSkeleton,
  SectionHeaderSkeleton,
  SkeletonBlock,
  SkeletonText,
  StatTileGridSkeleton,
  TableSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { StatusPage } from '@/components/kit/feedback/StatusPage';
import { Panel } from '@/components/kit/layout/Panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { STATE_LAYOUT } from '@/lib/kit/feedback/state-layout';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

const noop = () => {};

/** The class attribute of the first element matching a tag. */
function classOf(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*class="([^"]*)"`));
  if (!match) throw new Error(`No <${tag}> in ${html}`);
  return match[1];
}

/** The opening tag of the element with this data-slot, or of the root. */
function openingTag(html: string, slot?: string): string {
  const match = slot
    ? html.match(new RegExp(`<[^>]* data-slot="${slot}"[^>]*>`))
    : html.match(/^<[^>]*>/);
  if (!match) throw new Error(`No ${slot ?? 'root'} tag in ${html}`);
  return match[0];
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('SectionError', () => {
  it('keeps the regular layout for current callers', () => {
    const html = render(
      <SectionError title="Tournaments could not load" onRetry={noop} />
    );

    expect(html).toStartWith('<div role="alert"');
    expect(classOf(html, 'div')).toBe(STATE_LAYOUT.regular.root);
    expect(html).toContain(
      `<h2 class="${STATE_LAYOUT.regular.title}">Tournaments could not load</h2>`
    );
    expect(html).toContain(
      'This is temporarily unavailable. Try the request again.'
    );
    expect(html).toContain('h-9 px-4 py-2');
    expect(html).toContain('Try again');
  });

  it('shrinks to compact without a heading or a stock sentence', () => {
    const html = render(
      <SectionError
        size="compact"
        title="Rating history could not load"
        onRetry={noop}
      />
    );

    expect(html).toContain('data-size="compact"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<h2');
    expect(html).toContain(
      '<p class="text-sm font-semibold text-balance">Rating history could not load</p>'
    );
    expect(html).not.toContain('temporarily unavailable');
    expect(html).toContain('h-8');
  });

  it('shows a compact description when one is given', () => {
    const html = render(
      <SectionError
        size="compact"
        title="Search failed"
        description="The osu! API is not responding."
        onRetry={noop}
      />
    );

    expect(html).toContain('The osu! API is not responding.');
  });

  it('fits on one line inline', () => {
    const html = render(
      <SectionError
        size="inline"
        title="More tournaments could not load"
        retrying
        onRetry={noop}
        className="justify-center"
      />
    );

    expect(html).toContain('data-size="inline"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('justify-center');
    expect(html).not.toMatch(/<(?:h2|p)[ >]/);
    expect(html).toContain('More tournaments could not load');
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Try again');
  });
});

describe('EmptyState', () => {
  it('uses the section error frame with a neutral icon', () => {
    const empty = render(
      <EmptyState title="No pooled beatmaps" description="None yet." />
    );
    const error = render(<SectionError title="Failed" onRetry={noop} />);

    expect(classOf(empty, 'div')).toBe(classOf(error, 'div'));
    expect(classOf(empty, 'h2')).toBe(classOf(error, 'h2'));
    expect(classOf(empty, 'p')).toBe(classOf(error, 'p'));
    expect(classOf(empty, 'span')).toContain('size-12');
    expect(classOf(empty, 'span')).toContain('bg-muted');
    expect(empty).toContain('lucide-search-x');
    expect(empty).not.toContain('destructive');
    expect(empty).not.toContain('role="alert"');
  });

  it('adds Clear filters as a link or a button', () => {
    const link = render(
      <EmptyState
        title="No beatmaps match"
        clearFilters={{ href: '/beatmaps?q=freedom' }}
      />
    );
    const button = render(
      <EmptyState title="No beatmaps match" clearFilters={{ onClick: noop }} />
    );

    expect(link).toContain('href="/beatmaps?q=freedom"');
    expect(link).toContain('>Clear filters</a>');
    expect(button).toContain('type="button"');
    expect(button).toContain('>Clear filters</button>');
    // The controls family's outline Button, at the regular size's height.
    expect(link).toContain('data-variant="outline"');
    expect(button).toContain('data-variant="outline"');
    expect(button).toContain('h-9');
  });

  it('renders no action row without actions', () => {
    const html = render(<EmptyState title="No reports" />);

    expect(html).not.toContain('mt-5');
    expect(html).not.toContain('<button');
  });

  it('keeps another action beside Clear filters', () => {
    const html = render(
      <EmptyState
        title="No tournaments match"
        clearFilters={{ href: '/tournaments' }}
        action={<Link href="/tournaments/submit">Submit a tournament</Link>}
      />
    );

    expect(html.indexOf('Clear filters')).toBeLessThan(
      html.indexOf('Submit a tournament')
    );
  });

  it('shrinks to compact with a paragraph title and small buttons', () => {
    const html = render(
      <EmptyState
        size="compact"
        title="Not enough data"
        clearFilters={{ onClick: noop }}
        data-testid="chart-empty"
      />
    );

    expect(html).toContain('data-testid="chart-empty"');
    expect(html).toContain('data-size="compact"');
    expect(html).toContain(
      '<p class="text-sm font-semibold text-balance">Not enough data</p>'
    );
    expect(html).toContain('h-8');
  });

  it('takes a title element', () => {
    const html = render(<EmptyState title="No matches" titleAs="h3" />);
    expect(html).toContain('<h3 class="text-lg font-semibold">No matches</h3>');
  });
});

describe('StatusPage', () => {
  it('is an icon, an h1 and a sentence, with no action unless given', () => {
    const html = render(
      <StatusPage
        icon={Lock}
        title="Unauthorized"
        description="You are not authorized to access this page."
        data-testid="unauthorized-container"
      />
    );

    expect(html).toContain('data-testid="unauthorized-container"');
    expect(html).toContain('<h1 class="text-xl font-semibold text-balance">');
    expect(html).toContain('You are not authorized to access this page.');
    expect(html).toContain('bg-muted');
    expect(html).not.toContain('destructive');
    expect(html).not.toContain('mt-5');
    expect(html).not.toContain('href=');
    expect(classOf(html, 'div')).not.toMatch(/\bcontainer\b|mx-auto/);
  });

  it('holds a route error action: a way back, then Try again', () => {
    const html = render(
      <StatusPage
        icon={AlertCircle}
        tone="destructive"
        title="Tournament could not load"
        description="Something went wrong on our side. Try again in a moment."
        role="alert"
        action={
          <>
            <Link href="/tournaments">Tournaments</Link>
            <button type="button">Try again</button>
          </>
        }
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('mt-5');
    expect(html).toContain('href="/tournaments"');
    expect(html.indexOf('Tournaments</a>')).toBeLessThan(
      html.indexOf('Try again</button>')
    );
  });

  it('puts the background behind the content, hidden from assistive tech', () => {
    const html = render(
      <StatusPage
        icon={Compass}
        title="Page not found"
        background={<span>art</span>}
      />
    );

    expect(html).toContain(
      '<div aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10"><span>art</span></div>'
    );
    expect(html).toContain('relative isolate');
  });

  it('turns red for failures and holds details', () => {
    const html = render(
      <StatusPage
        icon={ShieldAlert}
        tone="destructive"
        title="Account suspended"
      >
        <p>Reason: Submissions abuse</p>
      </StatusPage>
    );

    expect(html).toContain('bg-destructive/10');
    expect(html).toContain('text-destructive');
    expect(html).toContain('<p>Reason: Submissions abuse</p>');
    // The detail stays centred with the rest of the page.
    expect(html).not.toContain('text-left');
  });
});

describe('Callout', () => {
  it('colours each tone with its callout tokens and glyph', () => {
    const info = render(<Callout>Ratings update weekly.</Callout>);
    const warning = render(<Callout tone="warning">Check this.</Callout>);
    const danger = render(<Callout tone="danger">No undo.</Callout>);

    expect(info).toContain('bg-callout-info');
    expect(info).toContain('lucide-info');
    expect(warning).toContain('bg-callout-warning');
    expect(warning).toContain('lucide-triangle-alert');
    expect(danger).toContain('bg-callout-danger');
    expect(danger).toContain('lucide-octagon-alert');
    expect(info).not.toContain('role=');
  });

  it('leads with a title and keeps its action out of the tone colour', () => {
    const html = render(
      <Callout
        tone="danger"
        title="Saving is permanent"
        action={<button type="button">Delete account</button>}
      >
        Nothing can undo it.
      </Callout>
    );

    expect(html).toContain('<p class="font-semibold">Saving is permanent</p>');
    expect(html).toMatch(/text-foreground[^"]*"><button/);
  });

  it('takes a custom icon', () => {
    const html = render(
      <Callout icon={ShieldQuestion}>Includes unverified data.</Callout>
    );

    expect(html).toContain('lucide-shield-question');
    expect(html).not.toContain('lucide-info');
  });

  it('spans the page as a banner', () => {
    const html = render(
      <Callout tone="warning" variant="banner" role="status">
        Ratings are recalculating.
      </Callout>
    );

    expect(html).toContain('data-variant="banner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('w-full');
    expect(html).toContain('border-b');
    expect(html).not.toContain('rounded-lg');
  });
});

describe('CalloutChip', () => {
  it('is a rounded badge in the callout colours', () => {
    const html = render(<CalloutChip>Partial data</CalloutChip>);

    expect(html).toStartWith('<span data-slot="callout-chip"');
    expect(html).toContain('rounded-md');
    expect(html).toContain('border-callout-warning-border');
    expect(html).toContain('bg-callout-warning');
    expect(html).toContain('text-callout-warning-foreground');
    expect(html).not.toContain('bg-secondary');
    expect(html).toContain('lucide-triangle-alert');
  });

  it('is plain text, never a button', () => {
    const html = render(<CalloutChip tone="info">Cached</CalloutChip>);

    expect(html).toStartWith('<span data-slot="callout-chip"');
    expect(html).toContain('bg-callout-info');
    expect(html).not.toContain('<button');
  });
});

describe('Skeletons', () => {
  it('announces a loading panel once', () => {
    const html = render(<PanelSkeleton label="Loading reports" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading reports"');
    // The surface comes from Panel, not a copy of its classes.
    expect(classOf(html, 'div')).toContain(
      classOf(render(<Panel />), 'section')
    );
    expect(html).toContain('data-slot="section-header-skeleton"');
  });

  it('hides every other skeleton from assistive tech', () => {
    // Header labels, tab names and the toolbar's landmark stay silent.
    const roots = [
      openingTag(
        render(<TableSkeleton rows={1} columns={[{ label: 'Type' }]} />),
        'table-skeleton'
      ),
      openingTag(
        render(<PhoneRowListSkeleton rows={1} />),
        'phone-row-list-skeleton'
      ),
      openingTag(
        render(<ListToolbarSkeleton search />),
        'list-toolbar-skeleton'
      ),
      openingTag(
        render(<HeroTabsSkeleton labels={['Matches']} />),
        'hero-tabs-skeleton'
      ),
      openingTag(render(<LoadMoreSkeleton />)),
      openingTag(render(<RulesetSwitchSkeleton />)),
      openingTag(render(<SkeletonBlock />)),
      openingTag(render(<SkeletonText />)),
    ];

    for (const tag of roots) {
      expect(tag).toContain('aria-hidden="true"');
    }
  });

  it('draws a real section header when the title is known', () => {
    const html = render(<SectionHeaderSkeleton title="Reports" level={3} />);

    expect(html).toContain('data-slot="section-header"');
    expect(html).toContain('<h3 class="truncate font-semibold">Reports</h3>');
    expect(html).toContain('data-slot="skeleton"');
  });

  it('keeps stat tile labels and bars the values', () => {
    const html = render(
      <StatTileGridSkeleton labels={['Rating', 'Matches']} columns={2} sub />
    );

    expect(html).toContain('data-slot="stat-tile-grid"');
    expect(html).toContain('Rating');
    expect(html).toContain('Matches');
    expect(count(html, 'data-slot="tile"')).toBe(2);
    expect(count(html, 'data-slot="skeleton"')).toBe(4);
  });

  it('draws the DataTable header strip and rows', () => {
    const html = render(
      <TableSkeleton
        rows={3}
        columns={[
          { label: 'Type', width: 'w-24' },
          { label: 'Reason', showFrom: 'lg' },
          { label: 'Submitted', width: 'w-40', align: 'end' },
        ]}
      />
    );

    expect(html).toContain('data-slot="table-skeleton"');
    expect(html).toContain('table-fixed');
    expect(html).toContain('[&amp;_tr]:bg-muted');
    expect(html).toMatch(
      /<th[^>]*class="[^"]*\bh-8\b[^"]*\bw-24\b[^"]*">Type<\/th>/
    );
    expect(count(html, 'hidden lg:table-cell')).toBe(4);
    expect(html).toContain('justify-end');
    expect(count(html, '<tr')).toBe(4);
    expect(count(html, 'flex items-center h-6')).toBe(6);
    expect(count(html, 'data-slot="skeleton"')).toBe(9);
  });

  it('swaps a table for phone rows below tablet width', () => {
    const html = render(
      <TableSkeleton
        rows={2}
        columns={3}
        phoneRows={<PhoneRowListSkeleton rows={2} rank avatar />}
      />
    );

    expect(html).toContain('hidden md:block');
    expect(html).toContain('class="md:hidden"');
    expect(html).toContain('data-slot="phone-row-list-skeleton"');
    expect(count(html, 'data-slot="phone-row"')).toBe(2);
  });

  it('draws the real info button and a meta bar of the loaded width', () => {
    const html = render(
      <SectionHeaderSkeleton
        title="Tier breakdown"
        infoText="Charts NM, HD, HR and DT scores only."
        meta="w-36"
      />
    );

    expect(html).toContain('aria-label="About tier breakdown"');
    expect(html).toMatch(/data-slot="skeleton"[^>]*class="[^"]*\bh-3 w-36\b/);
    expect(html).not.toContain('w-20');

    const untitled = render(<SectionHeaderSkeleton infoText="Help" />);
    expect(untitled).toContain('lucide-info');
    expect(untitled).not.toContain('<button');
  });

  it('draws a toolbar with blocks where its controls go', () => {
    const html = render(
      <ListToolbarSkeleton search sort filters rulesets={6} count />
    );

    expect(html).toContain('role="search"');
    expect(html).toContain('data-slot="list-toolbar-skeleton"');
    expect(count(html, 'h-8 rounded-full')).toBe(6);
    // As wide as the loaded chips, All to mania 7K, so they wrap alike.
    expect(
      [...html.matchAll(/h-8 rounded-full (w-\d+)/g)].map((match) => match[1])
    ).toEqual(['w-15', 'w-18', 'w-19', 'w-20', 'w-27', 'w-27']);
    expect(html).toContain('h-10 w-full');
    expect(html).toContain('size-10');
    expect(html).toContain('h-10 w-28');
    expect(html).toContain('list-toolbar-scope-row');

    const noSearch = render(<ListToolbarSkeleton sort scope="w-64" count />);
    expect(noSearch.match(/list-toolbar-scope-row/g)).toHaveLength(1);
    expect(noSearch).toContain('h-8 w-64');

    // A RulesetSwitch toolbar has no All chip: osu! to mania 7K, each at its
    // own chip's width.
    const noAll = render(
      <ListToolbarSkeleton search rulesets={5} rulesetsAll={false} count />
    );
    expect(
      [...noAll.matchAll(/h-8 rounded-full (w-\d+)/g)].map((match) => match[1])
    ).toEqual(['w-18', 'w-19', 'w-20', 'w-27', 'w-27']);
  });

  it('draws list rows in the RowList', () => {
    const html = render(<RowListSkeleton rows={2} leading="none" />);

    expect(html).toStartWith('<ul data-slot="row-list-skeleton"');
    expect(count(html, '<li')).toBe(2);
    expect(html).not.toContain('rounded-full');
  });

  it('draws what each option asks for', () => {
    const skeletons = (html: string) => count(html, 'data-slot="skeleton"');
    const phoneRow = render(<PhoneRowListSkeleton rows={1} />);

    // Title, description and value, then rank, avatar and a value line.
    expect(skeletons(phoneRow)).toBe(3);
    expect(
      skeletons(
        render(<PhoneRowListSkeleton rows={1} rank avatar valueDescription />)
      )
    ).toBe(6);
    // A badge before the description text.
    expect(
      skeletons(render(<PhoneRowListSkeleton rows={1} description="badge" />))
    ).toBe(4);
    expect(render(<PhoneRowListSkeleton rows={1} leading={32} />)).toContain(
      'data-slot="phone-row-leading"'
    );
    // These differ from the default only in size.
    expect(render(<PhoneRowListSkeleton rows={1} value="button" />)).not.toBe(
      phoneRow
    );
    expect(render(<PhoneRowListSkeleton rows={1} value="badge" />)).not.toBe(
      phoneRow
    );
    expect(
      render(<TableSkeleton rows={1} columns={2} cellHeight="h-9" />)
    ).not.toBe(render(<TableSkeleton rows={1} columns={2} />));

    // Two stats of a label and a value, and a toggle instead of a number.
    expect(
      skeletons(
        render(
          <RowListSkeleton rows={1} leading="none" stats={2} statsAction />
        )
      )
    ).toBe(7);
    // A cover, then a badge and a bar on a second detail line.
    expect(
      skeletons(
        render(<RowListSkeleton rows={1} leading="cover" meta="badge" />)
      )
    ).toBe(6);
    expect(skeletons(render(<RulesetSwitchSkeleton count={3} />))).toBe(3);
    expect(
      classOf(render(<ChartPlotSkeleton className="h-60" />), 'span')
    ).toContain('h-60');
  });

  it('draws a hero tab strip with real labels or bars', () => {
    const labelled = render(
      <HeroTabsSkeleton
        labels={['Tournament', 'Matches']}
        className="border-b"
      />
    );
    expect(labelled).toStartWith('<div data-slot="hero-tabs-skeleton"');
    expect(labelled).toContain('border-b');
    expect(count(labelled, 'h-11')).toBe(2);
    expect(labelled).toContain('>Tournament</span>');
    expect(labelled).not.toContain('data-slot="skeleton"');

    const bars = render(<HeroTabsSkeleton tabs={3} />);
    expect(count(bars, 'h-11')).toBe(3);
    expect(count(bars, 'data-slot="skeleton"')).toBe(3);
  });
});
