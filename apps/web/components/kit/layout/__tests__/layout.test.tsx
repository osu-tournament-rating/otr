import { describe, expect, it } from 'bun:test';
import { Trophy } from 'lucide-react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import {
  HeroTabsList,
  HeroTabsRoot,
  HeroTabsTrigger,
} from '@/components/kit/layout/HeroTabsList';
import { InfoButton } from '@/components/kit/layout/InfoButton';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { Tile } from '@/components/kit/layout/Tile';
import { typeScale } from '@/components/kit/layout/Typography';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ROW_HOVER_TINT, ROW_TITLE_HOVER } from '@/lib/kit/tables/row';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

/** The class attribute of the first element with this tag. */
const classOf = (html: string, tag: string) =>
  new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? '';

describe('Panel', () => {
  it('is a section with the reference surface by default', () => {
    const html = render(<Panel>Body</Panel>);

    expect(html).toStartWith('<section data-slot="panel"');
    expect(html).toContain(
      'overflow-clip rounded-xl border bg-card shadow-sm dark:bg-muted/75 dark:shadow-none'
    );
  });

  it('renders the requested element and merges classes last', () => {
    const html = render(
      <Panel as="article" className="rounded-lg">
        Body
      </Panel>
    );

    expect(html).toStartWith('<article');
    expect(html).toContain('rounded-lg');
    expect(html).not.toContain('rounded-xl');
  });

  it('pads its body by 16px', () => {
    expect(render(<PanelBody />)).toContain('class="p-4"');
  });
});

describe('SectionHeader', () => {
  it('titles the section with an h2 and a muted icon', () => {
    const html = render(<SectionHeader icon={Trophy} title="Leaderboard" />);

    expect(html).toContain(
      '<h2 class="truncate font-semibold">Leaderboard</h2>'
    );
    expect(html).toContain('text-muted-foreground');
    expect(html).not.toContain('text-primary');
  });

  it('takes a heading level and works without an icon', () => {
    const html = render(<SectionHeader title="Recent matches" level={3} />);

    expect(html).toContain('<h3');
    expect(html).not.toContain('<svg');
  });

  it('names its info button after the title', () => {
    const html = render(
      <SectionHeader title="Tier breakdown" infoText="How to read it" />
    );

    expect(html).toContain('aria-label="About tier breakdown"');
  });

  it('puts meta beside the actions when both are given', () => {
    const html = render(
      <SectionHeader
        title="Leaderboard"
        meta="top 25"
        actions={<button type="button">Full range</button>}
      />
    );

    expect(html.indexOf('top 25')).toBeLessThan(html.indexOf('Full range'));
  });

  it('fits a 32px action inside the 48px strip', () => {
    const html = render(
      <SectionHeader
        title="Leaderboard"
        actions={<button type="button">Full range</button>}
      />
    );

    expect(html).toMatch(/class="-my-1 [^"]*"><button/);
  });

  it('sets the meta in tabular figures, with or without actions', () => {
    const alone = render(<SectionHeader title="Scores" meta="1,368 scores" />);
    const withActions = render(
      <SectionHeader
        title="Scores"
        meta="1,368 scores"
        actions={<button type="button">Full range</button>}
      />
    );

    for (const html of [alone, withActions]) {
      expect(html).toMatch(/class="[^"]*\btabular-nums\b[^"]*">1,368 scores/);
    }
  });
});

describe('Tile', () => {
  it('stacks an interactive tile from the top, where a bare button centres', () => {
    const html = render(
      <Tile asChild interactive>
        <button type="button">Pooled in</button>
      </Tile>
    );

    expect(html).toStartWith('<button');
    expect(html).toMatch(/class="[^"]*\bflex\b[^"]*\bflex-col\b/);
  });

  it('leaves a plain tile as a block', () => {
    expect(render(<Tile>Most used in</Tile>)).not.toContain('flex-col');
  });
});

describe('InfoButton', () => {
  it('is a labelled button around a hidden icon', () => {
    const html = render(
      <InfoButton label="About percentile">Explanation</InfoButton>
    );

    expect(html).toContain(
      '<button type="button" aria-label="About percentile"'
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('text-muted-foreground');
  });

  it('turns white on art', () => {
    const html = render(
      <InfoButton label="About star rating" onArt>
        Explanation
      </InfoButton>
    );

    expect(html).toContain('text-white/80 hover:text-white');
    expect(html).not.toContain('text-muted-foreground');
  });
});

describe('PageHeader', () => {
  it('renders the page h1, description, actions and back link', () => {
    const html = render(
      <PageHeader
        icon={Trophy}
        title="Tournaments"
        description="Browse tournaments."
        actions={<button type="button">Submit</button>}
        back={{ href: '/tournaments/1', label: 'Tournament' }}
      />
    );

    expect(html).toStartWith('<header');
    expect(html).toContain(
      `<h1 class="${typeScale.pageTitle} min-w-0 break-words">`
    );
    expect(html).toContain('href="/tournaments/1"');
    expect(html).toContain('Browse tournaments.');
    expect(html).toContain('Submit');
  });
});

describe('DetailHero', () => {
  it('is a plain panel without art', () => {
    const html = render(
      <DetailHero
        title="Break The Meta Cup"
        status={<span>Verified</span>}
        meta={<HeroMetaItem icon={Trophy}>1v1</HeroMetaItem>}
      />
    );

    expect(html).toStartWith('<header data-slot="detail-hero"');
    // The surface comes from Panel, not a copy of its classes.
    expect(classOf(html, 'header')).toContain(
      classOf(render(<Panel />), 'section')
    );
    expect(html).toContain('Break The Meta Cup</h1>');
    expect(html).not.toContain('bg-black/60');
    expect(html.indexOf('Verified')).toBeLessThan(html.indexOf('1v1'));
  });

  it('lays the title over a matte when there is art', () => {
    const html = render(
      <DetailHero
        title="HAELEQUIN"
        art={<span data-art />}
        adminActions={<button type="button">Admin</button>}
      />
    );

    expect(html).toContain('data-art');
    expect(html).toContain('bg-black/60');
    expect(html).toContain('text-white');
    expect(html).toContain('Admin');
  });

  it('keeps a long title clear of the Admin pill on art', () => {
    const withAdmin = render(
      <DetailHero
        title="A tournament name long enough to wrap onto three lines"
        art={<span data-art />}
        adminActions={<button type="button">Admin</button>}
      />
    );
    // The strip grows with its content instead of clipping it, and the
    // pill's corner row stays empty.
    expect(withAdmin).toContain('min-h-48');
    expect(withAdmin).toContain('sm:min-h-56');
    expect(withAdmin).toContain('pt-16 sm:pt-[4.5rem]');

    const withoutAdmin = render(
      <DetailHero title="HAELEQUIN" art={<span data-art />} />
    );
    expect(withoutAdmin).not.toContain('pt-16');
  });
});

describe('HeroTabs', () => {
  it('marks the current tab and keeps test ids', () => {
    const html = render(
      <HeroTabs
        aria-label="Tournament views"
        value="beatmaps"
        items={[
          { value: 'matches', label: 'Matches', href: '?tab=matches' },
          {
            value: 'beatmaps',
            label: 'Beatmaps',
            href: '?tab=beatmaps',
            count: '62',
            testId: 'tab-beatmaps',
          },
        ]}
      />
    );

    expect(html).toContain('aria-label="Tournament views"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="tab-beatmaps" aria-current="page"/);
    expect(html).toMatch(/class="[^"]*\btabular-nums\b[^"]*">62</);
    expect(html).not.toContain('sr-only');
  });

  it('shows a compact label on phones and keeps the full one for screen readers', () => {
    const html = render(
      <HeroTabs
        aria-label="Audit history views"
        value="self"
        items={[
          {
            value: 'self',
            label: 'This tournament',
            compactLabel: 'Tournament',
            href: '?tab=self',
          },
        ]}
      />
    );

    expect(html).toContain(
      '<span aria-hidden="true" class="sm:hidden">Tournament</span><span class="max-sm:sr-only">This tournament</span>'
    );
  });

  it('hides counts below sm but keeps them in the name', () => {
    const html = render(
      <HeroTabs
        aria-label="Audit history views"
        value="matches"
        countsFrom="sm"
        items={[
          {
            value: 'matches',
            label: 'Matches',
            count: '1,000+',
            href: '?tab=matches',
          },
        ]}
      />
    );

    expect(html).toContain('max-sm:[&amp;_[data-slot=hero-tab-count]]:sr-only');
    expect(html).toContain('data-slot="hero-tab-count"');
    expect(html).toContain('1,000+');
  });
});

describe('HeroTabsList', () => {
  it('takes the same compact labels and count breakpoint', () => {
    const html = render(
      <HeroTabsRoot defaultValue="games">
        <HeroTabsList aria-label="Match views" countsFrom="md">
          <HeroTabsTrigger value="games" count="9" compactLabel="Games">
            All games
          </HeroTabsTrigger>
        </HeroTabsList>
      </HeroTabsRoot>
    );

    expect(html).toContain('max-md:[&amp;_[data-slot=hero-tab-count]]:sr-only');
    expect(html).toContain(
      '<span aria-hidden="true" class="sm:hidden">Games</span>'
    );
    expect(html).toContain('All games');
  });
});

describe('StatTile', () => {
  it('renders a term and a definition inside a grid', () => {
    const html = render(
      <StatTileGrid columns={4}>
        <StatTile
          label="Rating"
          value="2,214.8"
          adornment={<span data-tier />}
          sub="Grandmaster II"
        />
      </StatTileGrid>
    );

    expect(html).toStartWith('<dl');
    expect(html).toContain('sm:grid-cols-4');
    expect(html).toMatch(/<dt[^>]*>.*Rating.*<\/dt>/);
    expect(html.indexOf('data-tier')).toBeLessThan(html.indexOf('2,214.8'));
    expect(html).toContain('Grandmaster II');
  });

  it('takes a node as its label, such as a short form with its full name', () => {
    const html = render(
      <StatTile
        layout="inline"
        label={
          <>
            <span aria-hidden="true">CS</span>
            <span className="sr-only">Circle size</span>
          </>
        }
        value="4.0"
        infoText="How big the circles are."
        infoLabel="About circle size"
      />
    );

    // Plain text on screen, nothing to tap: the full name is for screen
    // readers only.
    expect(html).toContain(
      '<span class="truncate"><span aria-hidden="true">CS</span><span class="sr-only">Circle size</span></span>'
    );
    expect(html).toContain('aria-label="About circle size"');
  });

  it('names the info button after a text label', () => {
    const html = render(
      <StatTile label="Win rate" value="62%" infoText="Matches won." />
    );
    expect(html).toContain('<span class="truncate">Win rate</span>');
    expect(html).toContain('aria-label="About win rate"');
  });

  it('keeps the value at leading-none in tabular figures in both layouts', () => {
    // tailwind-merge drops a leading class that comes before a size class.
    const stacked = render(<StatTile label="Rating" value="2,214.8" />);
    const inline = render(<StatTile layout="inline" label="AR" value="8.0" />);

    expect(stacked).toMatch(/class="[^"]*\btext-xl\b[^"]*\bleading-none\b/);
    expect(inline).toMatch(/class="[^"]*\btext-lg\b[^"]*\bleading-none\b/);
    expect(stacked).toMatch(/class="[^"]*\btabular-nums\b[^"]*\btext-xl\b/);
    expect(inline).toMatch(/class="[^"]*\btabular-nums\b[^"]*\btext-lg\b/);
  });
});

describe('RowListItem', () => {
  it('renders a padded row with the standard slots', () => {
    const html = render(
      <RowList>
        <RowListItem
          title="distantmemory"
          description="United States"
          trailing="2,214.8"
        />
      </RowList>
    );

    expect(html).toStartWith('<ul data-slot="row-list"');
    expect(classOf(html, 'ul').split(' ')).toContain('divide-y');
    expect(classOf(html, 'li').split(' ')).toEqual(
      expect.arrayContaining(['px-4', 'py-3', 'flex'])
    );
    for (const slot of ['distantmemory', 'United States', '2,214.8']) {
      expect(html).toContain(slot);
    }
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('hover:bg');
  });

  it('becomes one tinted, named link when given href', () => {
    const html = render(
      <RowListItem
        href="/tournaments/1"
        linkLabel="View Break The Meta Cup"
        title="BTMC"
        description="osu! · 1v1"
      />
    );

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/tournaments/1"');
    expect(html).toContain('aria-label="View Break The Meta Cup"');
    expect(html).toContain(ROW_HOVER_TINT);
    expect(html).toContain(ROW_TITLE_HOVER.replaceAll('&', '&amp;'));
    expect(html).toMatch(/data-row-title="true">BTMC</);
  });

  it('marks no row title when the row is not a link', () => {
    const html = render(<RowListItem title="distantmemory" />);

    expect(html).not.toContain('data-row-title');
  });
});
