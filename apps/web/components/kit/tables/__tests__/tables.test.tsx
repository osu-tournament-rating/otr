import { describe, expect, it } from 'bun:test';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import {
  DataTableLinkCell,
  DataTableLinkRow,
} from '@/components/kit/tables/DataTableLinkRow';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { LoadMore } from '@/components/kit/tables/LoadMore';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { PaginationFooter } from '@/components/kit/tables/PaginationFooter';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { SortableHeader } from '@/components/kit/tables/SortableHeader';
import { ViewButton } from '@/components/kit/tables/ViewButton';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatCount } from '@/lib/kit/format/number';
import {
  ROW_HIGHLIGHT,
  ROW_HOVER_TINT,
  ROW_TITLE_HOVER,
} from '@/lib/kit/tables/row';
import type { SortState } from '@/lib/kit/lists/sort';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

const noop = () => {};

describe('DataTable', () => {
  it('hides the table on phones only when it has phone rows', () => {
    const plain = render(<DataTable />);
    expect(plain).not.toContain('hidden md:block');
    expect(plain).not.toContain('data-table-phone');

    const html = render(
      <DataTable phoneRows={<PhoneRowList aria-label="Rows" />} />
    );
    expect(html).toContain('hidden md:block');
    expect(html).toContain('data-slot="data-table-phone" class="md:hidden"');
  });

  it('keeps the table on phones when phone rows are null', () => {
    const html = render(<DataTable phoneRows={null} />);
    expect(html).not.toContain('hidden md:block');
    expect(html).not.toContain('data-table-phone');
  });

  it('puts the phone sort in a strip above the phone rows', () => {
    const html = render(
      <DataTable
        phoneRows={<PhoneRowList aria-label="Rows" />}
        phoneSort={<span data-sort-control />}
      />
    );

    expect(html).toContain(
      '<div data-slot="data-table-phone" class="md:hidden"><div data-slot="data-table-phone-sort"'
    );
    expect(html).toContain('Sort by');
    expect(html).toContain('<span data-sort-control="true"></span>');
    // The strip comes before the rows.
    expect(html.indexOf('data-sort-control')).toBeLessThan(
      html.indexOf('data-slot="phone-row-list"')
    );
  });

  it('has no phone sort strip without phone rows or a sort', () => {
    expect(
      render(<DataTable phoneSort={<span data-sort-control />} />)
    ).not.toContain('data-table-phone-sort');
    expect(
      render(<DataTable phoneRows={<PhoneRowList aria-label="Rows" />} />)
    ).not.toContain('data-table-phone-sort');
  });

  it('sticks the header under the site header or in its scroll box', () => {
    expect(render(<DataTable stickyHeader />)).toContain(
      'md:[&amp;_th]:sticky'
    );
    expect(render(<DataTable stickyHeader="page" />)).toContain(
      'md:[&amp;_th]:top-(--header-height-px)'
    );
    const scrollArea = render(<DataTable stickyHeader="scroll-area" />);
    expect(scrollArea).toContain('[&amp;_th]:top-0');
    expect(scrollArea).not.toContain('md:[&amp;_th]:sticky');
  });

  it('sets headers in 12px muted labels, right-aligned over numbers', () => {
    const html = render(
      <table>
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead>Player</DataTableHead>
            <DataTableHead numeric>Matches</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
      </table>
    );
    const [player, matches] = [
      ...html.matchAll(/<th [^>]*class="([^"]*)"/g),
    ].map((match) => match[1].split(' '));

    for (const header of [player, matches]) {
      expect(header).toEqual(
        expect.arrayContaining(['text-xs', 'text-muted-foreground'])
      );
    }
    expect(player).not.toContain('text-right');
    expect(matches).toContain('text-right');
  });

  it('adds an info button beside a header label', () => {
    const html = render(
      <table>
        <thead>
          <tr>
            <DataTableHead info="Share of verified matches won.">
              Win rate
            </DataTableHead>
          </tr>
        </thead>
      </table>
    );

    expect(html).toContain('aria-label="About win rate"');
  });

  it('right-aligns numbers with tabular figures', () => {
    const html = render(
      <table>
        <tbody>
          <tr>
            <DataTableCell numeric>{formatCount(1204)}</DataTableCell>
          </tr>
        </tbody>
      </table>
    );

    expect(html).toContain('text-right tabular-nums');
    expect(html).toContain('1,204');
  });

  it('shows a muted em dash for a missing value', () => {
    const cell = (children: React.ReactNode, empty?: boolean) =>
      render(
        <table>
          <tbody>
            <tr>
              <DataTableCell empty={empty}>{children}</DataTableCell>
            </tr>
          </tbody>
        </table>
      );

    for (const missing of [null, undefined, '', formatCount(null)]) {
      expect(cell(missing)).toContain('data-slot="missing-value"');
    }
    expect(cell(0)).not.toContain('missing-value');
    expect(cell(null, false)).not.toContain('missing-value');
  });

  it('gives a plain row no hover tint', () => {
    const row = (highlight: boolean) =>
      render(
        <table>
          <tbody>
            <DataTableRow highlight={highlight}>
              <td>Yasui</td>
            </DataTableRow>
          </tbody>
        </table>
      );

    expect(row(false)).not.toContain('hover:');
    // The player's own row is tinted, still without a hover.
    expect(row(true)).toContain(ROW_HIGHLIGHT);
    expect(row(true)).not.toContain('hover:');
  });
});

describe('DataTableLinkRow', () => {
  it('tints on hover and holds one overlay link in its link cell', () => {
    const html = render(
      <table>
        <tbody>
          <DataTableLinkRow>
            <DataTableLinkCell
              href="/beatmaps/4012345"
              label="View ORESAMA - Hotohashiru [Extra]"
            >
              <span data-row-title>Hotohashiru</span>
            </DataTableLinkCell>
            <DataTableCell numeric>330</DataTableCell>
          </DataTableLinkRow>
        </tbody>
      </table>
    );

    expect(html).toContain(ROW_HOVER_TINT);
    expect(html).toContain(ROW_TITLE_HOVER.replaceAll('&', '&amp;'));
    expect(html).toContain('cursor-pointer');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/beatmaps/4012345"');
    expect(html).toContain('aria-label="View ORESAMA - Hotohashiru [Extra]"');
    expect(html).toContain('data-row-link=""');
    expect(html).toContain('absolute inset-0 z-10');
  });
});

describe('SortableHeader', () => {
  const sort: SortState<'rating' | 'name'> = {
    key: 'rating',
    direction: 'desc',
  };

  it('marks the sorted column and offers the flipped sort', () => {
    const html = render(
      <table>
        <thead>
          <tr>
            <SortableHeader
              sortKey="rating"
              sort={sort}
              getSortHref={(next) =>
                `/leaderboard?sort=${next.key}&dir=${next.direction}`
              }
              numeric
            >
              Rating
            </SortableHeader>
          </tr>
        </thead>
      </table>
    );

    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('href="/leaderboard?sort=rating&amp;dir=asc"');
    expect(html).toContain('text-foreground');
    // The arrow leads on a right-aligned column.
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('Rating'));
  });

  it('starts another column at its default direction', () => {
    const html = render(
      <table>
        <thead>
          <tr>
            <SortableHeader
              sortKey="name"
              sort={sort}
              getSortHref={(next) => `?sort=${next.key}&dir=${next.direction}`}
              defaultDirection="asc"
            >
              Player
            </SortableHeader>
          </tr>
        </thead>
      </table>
    );

    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('href="?sort=name&amp;dir=asc"');
    expect(html.indexOf('Player')).toBeLessThan(html.indexOf('<svg'));
  });

  it('renders a button for a list sorted in state', () => {
    const html = render(
      <table>
        <thead>
          <tr>
            <SortableHeader sortKey="rating" sort={sort} onSortChange={noop}>
              Rating
            </SortableHeader>
          </tr>
        </thead>
      </table>
    );

    expect(html).toContain('<button type="button"');
    expect(html).not.toContain('<a ');
  });
});

describe('EntityLink', () => {
  it('puts the avatar inside the link and names the link by the name', () => {
    const html = render(
      <EntityLink
        href="/players/1"
        leading={<span role="img" aria-label="mrekk's avatar" />}
      >
        mrekk
      </EntityLink>
    );

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/players/1"');
    expect(html).toContain('<span aria-hidden="true" class="flex shrink-0">');
    expect(html).toContain('<span class="min-w-0 truncate">mrekk</span>');
    expect(html).toContain('hover:text-link');
  });

  it('wraps a long name instead of truncating it when asked', () => {
    const html = render(
      <EntityLink href="/tournaments/1" wrap>
        osu! World Cup 2025
      </EntityLink>
    );

    // whitespace-normal: it wraps even inside a parent that truncates.
    expect(html).toContain(
      '<span class="min-w-0 break-words whitespace-normal">osu! World Cup 2025</span>'
    );
    expect(html).not.toContain('truncate');
  });

  it('sits in a sentence as a plain-weight underlined link', () => {
    const html = render(
      <p>
        apricot verified{' '}
        <EntityLink href="/tournaments/1" variant="inline">
          Corsace Open 2025
        </EntityLink>
      </p>
    );

    expect(html).toContain('data-variant="inline"');
    expect(html).toContain('font-normal');
    expect(html).toContain('underline');
    expect(html).toContain('hover:text-link');
    expect(html).toContain('hover:decoration-link');
    // Inline: no flex box, no truncation, and the sentence's own colour.
    expect(html).not.toContain('inline-flex');
    expect(html).not.toContain('truncate');
    expect(html).not.toContain('text-foreground');
    expect(html).toContain('>Corsace Open 2025</a>');
  });

  it('keeps an inline avatar inside the sentence line', () => {
    const html = render(
      <EntityLink
        href="/players/1"
        variant="inline"
        leading={<span role="img" aria-label="apricot's avatar" />}
      >
        apricot
      </EntityLink>
    );

    // One line box tall, at its top, with the avatar centred in it: a 20px
    // avatar in a 20px line adds no height (align-middle added 1.17px).
    expect(html).toContain(
      '<span aria-hidden="true" class="mr-1.5 inline-flex h-lh items-center align-top">'
    );
    expect(html).not.toContain('align-middle');
  });

  it('adds no height to a line of its own', () => {
    const html = render(<EntityLink href="/matches/1">Match 1</EntityLink>);

    // align-top, not align-middle, so a cell's second line stays 20px.
    expect(html).toMatch(
      /<a [^>]*class="[^"]*\binline-flex\b[^"]*\balign-top\b/
    );
    expect(html).not.toContain('align-middle');
  });
});

describe('ViewButton', () => {
  it('is a labelled outline button that opens a dialog', () => {
    const html = render(<ViewButton subject="report 1204" onClick={noop} />);

    expect(html).toContain('>View</button>');
    expect(html).toContain('aria-label="View report 1204"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('type="button"');
    expect(html).toContain('data-variant="outline"');
    expect(html).toContain('h-8');
    expect(html).toContain('data-slot="view-button"');
  });

  it('keeps its data-slot as a dialog trigger', () => {
    const html = render(
      <Dialog>
        <DialogTrigger asChild>
          <ViewButton subject="report 1204" />
        </DialogTrigger>
      </Dialog>
    );

    expect(html).toContain('data-slot="view-button"');
    expect(html).not.toContain('data-slot="dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
  });
});

describe('PhoneRow', () => {
  it('lines rows up on shared columns', () => {
    const html = render(
      <PhoneRowList as="ol" aria-label="Leaderboard">
        <PhoneRow
          rank="#1"
          title="mrekk"
          description="58 tournaments"
          valueAdornment={<span>tier</span>}
          value="3,121"
        />
      </PhoneRowList>
    );

    expect(html).toStartWith('<ol data-slot="phone-row-list"');
    expect(html).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
    expect(html).toContain('grid-cols-subgrid');
    expect(html).toContain('#1');
    // The adornment sits 4px left of the value.
    expect(html).toContain(
      'flex items-center justify-end gap-1 text-sm font-semibold tabular-nums"><span>tier</span>3,121'
    );
  });

  it('shows a muted em dash for a missing value', () => {
    const html = render(<PhoneRow title="Taiko Classic 2025" value={null} />);
    expect(html).toContain('data-slot="missing-value"');
  });

  it('makes the whole row one tinted link only when given href', () => {
    const plain = render(<PhoneRow title="mrekk" />);
    expect(plain).not.toContain('<a ');
    expect(plain).not.toContain(ROW_HOVER_TINT);
    expect(plain).not.toContain('phone-row-leading');

    const linked = render(
      <PhoneRow
        href="/tournaments/1"
        linkLabel="View Corsace Open 2025"
        title="Corsace Open 2025"
      />
    );
    expect(linked.match(/<a /g)).toHaveLength(1);
    expect(linked).toContain('aria-label="View Corsace Open 2025"');
    expect(linked).toContain(ROW_HOVER_TINT);
    expect(linked).toContain(ROW_TITLE_HOVER.replaceAll('&', '&amp;'));
  });

  it('links a leading avatar for pointers only', () => {
    const html = render(
      <PhoneRow
        leading={<span data-avatar />}
        leadingHref="/players/1"
        title={<EntityLink href="/players/1">mrekk</EntityLink>}
      />
    );

    // The avatar's link is hidden and out of the tab order; the name's link
    // is the row's one link for keyboards and screen readers.
    expect(html).toMatch(
      /<span data-slot="phone-row-leading" aria-hidden="true" class="flex shrink-0"><a [^>]*tabindex="-1"[^>]*href="\/players\/1"/
    );
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it('ignores leadingHref on a row that links as a whole', () => {
    const html = render(
      <PhoneRow
        href="/tournaments/1"
        linkLabel="View Corsace Open 2025"
        leading={<span data-cover />}
        leadingHref="/tournaments/1"
        title="Corsace Open 2025"
      />
    );

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('data-slot="phone-row-leading"');
  });

  it('sets the rank and value on the first line with align="start"', () => {
    const centred = render(
      <PhoneRow leading={<span data-avatar />} title="mrekk" value="3,121" />
    );
    expect(centred).toContain('items-center px-4 py-2.5');
    expect(centred).toContain('flex gap-3 items-center');

    const top = render(
      <PhoneRow
        align="start"
        leading={<span data-avatar />}
        title="mrekk"
        value="3,121"
      />
    );
    expect(top).toContain('grid-cols-subgrid items-start px-4 py-2.5');
    expect(top).toContain('flex gap-3 items-start');
  });
});

describe('PaginationFooter', () => {
  it('renders nothing for a single page', () => {
    expect(
      render(
        <PaginationFooter
          page={1}
          pageSize={50}
          totalCount={50}
          getPageHref={String}
        />
      )
    ).toBe('');
  });

  it('shows the readout and page links', () => {
    const html = render(
      <PaginationFooter
        page={84}
        pageSize={50}
        totalCount={8412}
        getPageHref={(page) => `/tournaments?page=${page}`}
        label="Tournament pages"
      />
    );

    expect(html).toContain('4,151–4,200 of 8,412');
    expect(html).toContain('aria-label="Tournament pages"');
    expect(html).toContain('href="/tournaments?page=83"');
    expect(html).toContain('href="/tournaments?page=169"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('84 / 169');
  });

  it('disables Previous on the first page without a link', () => {
    const html = render(
      <PaginationFooter
        page={1}
        pageSize={50}
        totalCount={8412}
        getPageHref={(page) => `?page=${page}`}
      />
    );

    expect(html).toContain('role="link" aria-disabled="true"');
    expect(html).not.toContain('href="?page=0"');
    expect(html).toContain('href="?page=2"');
  });

  it('draws pages as kit buttons and narrow arrows as icon buttons', () => {
    const html = render(
      <PaginationFooter
        page={2}
        pageSize={50}
        totalCount={8412}
        getPageHref={(page) => `?page=${page}`}
      />
    );

    // Page links are ghost kit Buttons, the current one outline.
    expect(html).toMatch(/<a [^>]*data-variant="ghost"[^>]*href="\?page=3"/);
    expect(html).toMatch(
      /<a [^>]*data-variant="outline"[^>]*aria-current="page"/
    );
    // Each arrow is also an IconButton for the narrow footer, with a tooltip
    // instead of a native title.
    expect(html.match(/data-slot="icon-button"/g)).toHaveLength(2);
    expect(html).toMatch(
      /<a [^>]*data-slot="icon-button"[^>]*aria-label="Next page"[^>]*href="\?page=3"/
    );
    expect(html).not.toContain('title=');
  });

  it('uses buttons for a list paged in state', () => {
    const html = render(
      <PaginationFooter
        page={169}
        pageSize={50}
        totalCount={8412}
        onPageChange={noop}
      />
    );

    expect(html).not.toContain('<a ');
    expect(html).toContain('disabled=""');
    expect(html).toContain('8,401–8,412 of 8,412');
  });
});

describe('LoadMore', () => {
  it('counts what is showing and offers more', () => {
    const html = render(
      <LoadMore onLoadMore={noop} hasMore shownCount={50} totalCount={1214} />
    );

    expect(html).toContain('Showing 50 of 1,214');
    expect(html).toContain('Load more');
  });

  it('spins and disables while loading', () => {
    const html = render(<LoadMore onLoadMore={noop} hasMore loading />);
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Load more');
  });

  it('gives way to an end note', () => {
    const html = render(
      <LoadMore onLoadMore={noop} hasMore={false} shownCount={214} />
    );
    expect(html).toContain('Showing all 214');
    expect(html).not.toContain('Load more');
  });

  it('takes its own button text', () => {
    const html = render(
      <LoadMore
        onLoadMore={noop}
        hasMore
        loading
        shownCount={10}
        totalCount={46}
        label="Show more"
      />
    );
    expect(html).toContain('Show more');
    expect(html).not.toContain('Load more');
    expect(html).toContain('Showing 10 of 46');
  });

  it('renders nothing when the first batch already holds everything', () => {
    expect(
      render(
        <LoadMore
          onLoadMore={noop}
          hasMore={false}
          shownCount={8}
          totalCount={8}
          pageSize={10}
        />
      )
    ).toBe('');
    expect(
      render(
        <LoadMore
          onLoadMore={noop}
          hasMore={false}
          shownCount={10}
          pageSize={10}
        />
      )
    ).toBe('');
  });

  it('keeps the end note once a second batch has loaded', () => {
    const html = render(
      <LoadMore
        onLoadMore={noop}
        hasMore={false}
        shownCount={14}
        totalCount={14}
        pageSize={10}
      />
    );
    expect(html).toContain('Showing all 14');
  });

  it('keeps the button while more remain, even inside the first batch', () => {
    const html = render(
      <LoadMore onLoadMore={noop} hasMore shownCount={10} pageSize={10} />
    );
    expect(html).toContain('Load more');
  });
});

describe('MissingValue', () => {
  it('shows a dash and reads a label', () => {
    const html = render(<MissingValue label="No peak rating yet" />);
    expect(html).toContain('<span aria-hidden="true">—</span>');
    expect(html).toContain('<span class="sr-only">No peak rating yet</span>');
    expect(html).toContain('text-muted-foreground');
  });
});
