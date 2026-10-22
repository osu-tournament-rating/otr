# Layout and surfaces

How a page is put together: the frame, the page header or detail hero, panels with their section headers, and what goes inside a panel (rows and tiles).
Every value here comes from the beatmap pages, which are the reference. Import each component from its own file under `@/components/kit/layout/`. Icon props across the kit take a `KitIcon` (`@/lib/kit/layout/icon`): any lucide icon, or an SVG component with the same `className` and `aria-hidden` props, such as `CircleDashedX`.

- [PageFrame](#pageframe): the root of every page, loading and error screen
- [PageHeader](#pageheader): the top of a list or tool page
- [DetailHero and HeroMetaItem](#detailhero-and-herometaitem): the top of a detail page
- [HeroTabs](#herotabs): link tabs under a hero, or at the top of a page's one panel
- [HeroTabsRoot, HeroTabsList, HeroTabsTrigger, HeroTabsContent](#herotabsroot-herotabslist-herotabstrigger-herotabscontent): in-page tabs under a hero
- [Panel and PanelBody](#panel-and-panelbody): the one surface
- [SectionHeader](#sectionheader): the strip at the top of a panel
- [InfoButton](#infobutton): the one help button
- [TermTooltip](#termtooltip): the dotted-underline label of the tournament match cost
- [Tile](#tile): the small bordered box inside a panel
- [StatTile and StatTileGrid](#stattile-and-stattilegrid): one number with its label
- [RowList and RowListItem](#rowlist-and-rowlistitem): divided rows inside a panel
- [Type scale](#type-scale): `typeScale`, `PageTitle`, `SectionTitle`, `RowTitle`, `Eyebrow`

## Page anatomy

A list or tool page is a PageFrame holding a PageHeader and then panels. A detail page is a PageFrame holding a DetailHero (with its tabs) and then panels. A panel starts with a SectionHeader and then holds rows, tiles, a table or a chart. The exception is the panel of a searchable or filterable list (tournaments, beatmaps, the leaderboard, audit logs, reports): it starts with its [ListToolbar](lists.md#listtoolbar), as the beatmap list does, and has no SectionHeader; the toolbar's count stands in for the header's meta. A short fixed list inside a detail page, such as teammates, keeps its SectionHeader. That is the whole nesting: never a panel or card inside a panel, never a box around a table inside a panel.

```tsx
import { ListToolbar } from '@/components/kit/lists/ListToolbar';

<PageFrame>
  <PageHeader icon={Trophy} title="Tournaments" description="…" />
  <Panel>
    <ListToolbar
      label="Search and filter tournaments"
      search={<SearchField … />}
      filters={<FilterPanel …>…</FilterPanel>}
      count="1,204 tournaments"
    />
    <RowList>…</RowList>
  </Panel>
</PageFrame>;
```

Spacing: panels sit 16px apart at every width (PageFrame and grids inside it use `gap-4`). Panels have 12px corners and 16px padding; tiles and inputs 8px corners; dialogs 12px corners and 24px padding.

## PageFrame

The root element of every `page.tsx`, `loading.tsx` and `error.tsx`. It spans the content column and keeps its children 16px apart.

```tsx
import { PageFrame } from '@/components/kit/layout/PageFrame';

export default function Page() {
  return (
    <PageFrame>
      <PageHeader … />
      <Panel>…</Panel>
    </PageFrame>
  );
}
```

- The 16px side margin on phones, the 20px margin from `sm`, the 24px top offset on phones, the 40px top offset on desktop and the 40px under the last panel all come from the root layout's `main` (`px-4 pt-6 pb-10 sm:px-5 sm:pt-10` in `apps/web/app/layout.tsx`), so a page never adds its own padding or container.
- Side-by-side panels go in a grid inside the frame: `<div className="grid gap-4 lg:grid-cols-3">`.

Do:

- Use PageFrame in the loading and error screen of the same route, so the skeleton lines up with the page.
- Keep the gap at 16px on every width.

Don't:

- Don't use `container`, `mx-auto`, `px-4 sm:px-0` or `py-6 sm:py-0` on a page root. `container` caps the width at tablet sizes, and with the layout's own margin a page's `px-4` doubles the phone gutter to 32px.
- Don't use `gap-2`, `gap-10` or `space-y-*` between panels; PageFrame's 16px is the only gap.

Gallery anchor: `/admin/design#layout-page-frame`

## PageHeader

The top of every list or tool page: a muted icon, the page's h1 (30px bold), one line of description, actions on the right and a divider underneath. Detail pages use DetailHero instead.

```tsx
import { PageHeader } from '@/components/kit/layout/PageHeader';

<PageHeader
  icon={Trophy}
  title="Tournaments"
  description="Browse tournament submissions and their review status. Only verified data is included in ratings."
  actions={
    <Button asChild icon={Upload}>
      <Link href="/tournaments/submit">Submit</Link>
    </Button>
  }
/>;
```

Props:

- `icon`: the page's lucide icon, the one its header menu item or home card uses (Trophy for tournaments, Medal for the leaderboard, Upload for submission, ClipboardList for audit logs). It renders muted at 28px; blue is for things you can act on.
- `title`: the page's only h1.
- `description`: one sentence.
- `actions`: page-level buttons, or a view toggle that changes every panel on the page ([ScopeSwitch](lists.md#scopeswitch)). They stack full width on phones and sit on the right from `sm`.
- `back`: `{ href, label }` for a page that belongs to one entity, such as its audit history. It replaces breadcrumbs.

Do:

- Put it first in a PageFrame. It adds 8px under its divider so the first panel sits 24px below it.
- Keep the description to one line on desktop.

Don't:

- Don't hand-build a header, or centre a blue title above a form.
- Don't colour the icon; PageHeader keeps it muted.
- Don't use breadcrumbs; use `back`, as the audit history pages do.

Gallery anchors: `/admin/design#layout-page-header`, `/admin/design#layout-page-header-back`

## DetailHero and HeroMetaItem

The top of every detail page (beatmap, tournament, match, player). The entity's name is the page's h1, its status and metadata sit in one row under it, the one admin cluster is at the top right, and its view tabs attach along the bottom. With `art` it is the beatmap hero; without, the same layout on a plain panel.

```tsx
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { IconButton } from '@/components/kit/controls/IconButton';
import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';

<DetailHero
  title={tournament.name}
  titleSuffix={tournament.abbreviation}
  status={
    <VerificationStatusBadge
      status={tournament.verificationStatus}
      tooltip="tap"
    />
  }
  meta={
    <>
      <HeroMetaItem icon={Users}>1v1</HeroMetaItem>
      <HeroMetaItem icon={Target}>Open rank</HeroMetaItem>
      <HeroMetaItem icon={CalendarDays}>Dec 4 – 18, 2021</HeroMetaItem>
    </>
  }
  adminActions={
    isAdmin ? <AdminMenu actions={…} /> : null
  }
  actions={
    <IconButton
      variant="outline"
      icon={ExternalLink}
      label="View on osu!"
    />
  }
  tabs={<HeroTabs aria-label="Tournament views" value={tab} items={…} />}
/>;
```

Props:

- `art`: cover art that fills its box (a `fill` image, or an element with `absolute inset-0`, such as `<BeatmapCover className="absolute inset-0" … />`). The hero then draws a strip at least 192px (224px from `sm`) tall with a dark matte, and everything on it is white in both themes. A long name grows the strip instead of being clipped, and with `adminActions` the Admin pill's corner row stays clear (the name starts 64px from the top, 72px from `sm`), so a name never runs under the pill on a phone. Leave it out when there is no art; never show a placeholder image.
- `title`, `titleSuffix`: the name (h1, 30px bold) and muted text after it, such as a difficulty name or an abbreviation.
- `leading`: an avatar or logo before the title, for players.
- `status`: the verification status (`VerificationStatusBadge`), first in the row under the title. On art, pass the badge's `variant="overlay"`.
- `meta`: HeroMetaItems (16px icon and short text) after the status.
- `adminActions`: the single admin cluster, top right: one [AdminMenu](controls.md#adminmenu), not a row of icons. Pass it `onArt` on a hero with art.
- `actions`: public actions, bottom right, in one order on every hero: report, audit history, then open on osu! (the tournament and match heroes; a non-admin's read-only "Admin notes" button sits after report). The beatmap hero's art puts its audit history link above the Preview button and its osu! link in the essentials row. Icon-only ones are [IconButton](controls.md#iconbutton)s. Audit pages are public, so the audit history link goes here for everyone, never in the admin menu. On art the actions get a 112px column beside the title on phones (128px from `sm`), so a labelled action and an IconButton don't fit side by side there: stack them in `<div className="flex flex-col items-end gap-2">`, as the beatmap hero does with its audit history link and Preview button.

On phones, a plain hero moves `actions` and `adminActions` into one row above the name, so a long name keeps the full width. On art they stay pinned to the corners, and every control there uses the dark pill, white in both themes, like the beatmap hero: `<AdminMenu onArt …/>`, `<Button variant="overlay">` and `<IconButton variant="overlay">` from the controls kit (the classes are `ON_ART_CONTROL_CLASSES` in `@/components/kit/controls/Button`). A status badge on art takes `variant="overlay"`, and an InfoButton takes `onArt`.

- `children`: extra full-width rows under the title block, divided from each other, such as the beatmap's essentials row and difficulty picker.
- `tabs`: HeroTabs or HeroTabsList.

Do:

- Format dates and numbers before passing them in (fixed `en-US`, UTC).
- Give every icon-only action an `aria-label` and a tooltip.

Don't:

- Don't build a hero from a padded card of your own or put the status in a separate row above the title.
- Don't scatter admin icons in different colours across the hero; put one [AdminMenu](controls.md#adminmenu) in `adminActions`.
- Don't hand-write the dark pill classes on art controls; use the controls kit's `overlay` variants.
- Don't make the title larger than 30px; it follows the type scale, beatmap titles included.

Gallery anchors: `/admin/design#layout-detail-hero-art`, `/admin/design#layout-detail-hero-art-status`, `/admin/design#layout-detail-hero-art-long`, `/admin/design#layout-detail-hero-tabs`, `/admin/design#layout-detail-hero-player`

## HeroTabs

Link tabs that switch between views of one entity: attached under its DetailHero, or, on a page with a PageHeader such as an entity's audit history, at the top of the page's one panel. The view lives in the address, so it survives a reload and can be shared.

```tsx
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import { parseHeroTab } from '@/lib/kit/layout/hero-tabs';

const TABS = ['matches', 'beatmaps', 'ratings', 'stats'] as const;
const tab = parseHeroTab((await searchParams).tab, TABS, 'matches');

<HeroTabs
  aria-label="Tournament views"
  value={tab}
  items={[
    {
      value: 'matches',
      label: 'Matches',
      count: '124',
      href: `/tournaments/${id}?tab=matches`,
      testId: 'tab-matches',
    },
    {
      value: 'beatmaps',
      label: 'Beatmaps',
      href: `/tournaments/${id}?tab=beatmaps`,
      testId: 'tab-beatmaps',
    },
  ]}
/>;
```

Props:

- `aria-label`: names the set of views. Required.
- `value`: the current tab; that link gets `aria-current="page"` and the blue underline.
- `items`: `value`, `label`, `href`, optional `icon`, `count` (already formatted, such as `1,000+`; shown muted in tabular figures), `compactLabel` and `testId`.
- `compactLabel`: a shorter label shown below `sm`, such as "Tournament" for "This tournament". Screen readers always hear `label`.
- `countsFrom`: `sm` or `md` shows the counts only from that width up; below it each count stays in its tab's accessible name. With `compactLabel`, `countsFrom="sm"` fits four tabs with counts on a 360px phone.

`parseHeroTab(raw, tabs, fallback)` reads `?tab=` and falls back for a missing or unknown value.

`HeroTabs.tsx` also exports the parts the tab strips share: `HeroTabLabel` (label, compact label and count) and the classes `heroTabListClassName`, `heroTabClassName` and `heroTabCountsFromClassName`, which HeroTabsList and HeroTabsSkeleton use. A page never needs them.

At the top of a panel, under a PageHeader, give the strip a divider and let the panel's toolbar and rows follow:

```tsx
<PageHeader icon={History} title={tournament.name} back={{ href: `/tournaments/${id}`, label: 'View tournament' }} />
<Panel>
  <HeroTabs
    aria-label="Audit history views"
    value={tab}
    countsFrom="sm"
    className="border-b"
    items={[
      { value: 'self', label: 'This tournament', compactLabel: 'Tournament', href: hrefFor({ tab: 'self' }) },
      { value: 'matches', label: 'Matches', count: formatCount(matchCount), href: hrefFor({ tab: 'matches' }) },
      …
    ]}
  />
  <ListToolbar … />
  …
</Panel>
```

Do:

- Use it only to switch views of one entity: the one in the hero, or the one the page is about.

Don't:

- Don't put a grey segmented tab bar under a hero.
- Don't give tabs icons. No page's tabs have them (tournament, match, audit history), so every strip reads the same.
- Don't use hero tabs to pick a ruleset (that is the ruleset control) or to scope a list such as All / Friends (that belongs in the list toolbar).
- Don't hide labels or counts with your own `max-sm:hidden` spans inside `label`; use `compactLabel` and `countsFrom`, which keep the full label and count for screen readers.

Loading: `HeroTabsSkeleton` ([feedback.md](feedback.md#skeletons)).

Gallery anchors: `/admin/design#layout-detail-hero-tabs`, `/admin/design#layout-hero-tabs-panel`

## HeroTabsRoot, HeroTabsList, HeroTabsTrigger, HeroTabsContent

The same tabs for views held in component state, built on Radix Tabs for keyboard support. Prefer HeroTabs when the view should survive a reload.

```tsx
import {
  HeroTabsContent,
  HeroTabsList,
  HeroTabsRoot,
  HeroTabsTrigger,
} from '@/components/kit/layout/HeroTabsList';

<HeroTabsRoot value={view} onValueChange={setView}>
  <DetailHero
    title={match.name}
    tabs={
      <HeroTabsList aria-label="Match views">
        <HeroTabsTrigger value="games" count="9">
          Games
        </HeroTabsTrigger>
        <HeroTabsTrigger value="stats">Stats</HeroTabsTrigger>
      </HeroTabsList>
    }
  />
  <HeroTabsContent value="games">…panels…</HeroTabsContent>
  <HeroTabsContent value="stats">…panels…</HeroTabsContent>
</HeroTabsRoot>;
```

- HeroTabsRoot wraps the hero and the views, with the 16px panel gap. Use `defaultValue` for uncontrolled tabs, or `value` with `onValueChange`.
- HeroTabsTrigger takes `value`, an optional `icon`, a `count` (already formatted) and a `compactLabel`, like a HeroTabs item; HeroTabsList takes `countsFrom`.
- HeroTabsContent stacks its panels 16px apart.
- None of these files has `'use client'`, so a server page can pass lucide icons; controlling the value needs a client parent.

Gallery anchor: `/admin/design#layout-hero-tabs-in-page`

## Panel and PanelBody

The one surface every section sits on: 12px corners, a hairline border, `bg-card` with a shadow in light mode and a flat lighter panel in dark mode.

```tsx
import { Panel, PanelBody } from '@/components/kit/layout/Panel';

<Panel>
  <SectionHeader icon={Gauge} title="Overview" />
  <PanelBody>…</PanelBody>
</Panel>;
```

Props:

- `as`: `section` (default), `header`, `div` or `article`.
- PanelBody: the content area with the standard 16px padding. Rows, tables and charts that run edge to edge skip it.

Do:

- Start a panel with a SectionHeader, then rows, tiles, a table or a chart.
- Start a list's panel with its ListToolbar instead, above the rows or table, as the beatmap list does. Don't add a SectionHeader above the toolbar.

Don't:

- Don't build a section surface of your own, such as a padded, shadowed card; it reads darker than a panel in dark mode.
- Don't put a card, a padded box or a bordered table frame inside a panel.
- Don't pad a panel 24px or 48px. The home page's feature cards are the one stated exception.

Gallery anchor: `/admin/design#layout-panel`

## SectionHeader

The strip at the top of a panel: an optional small muted icon, a 16px semibold title, an optional info button, and meta or actions on the right, over a divider.

```tsx
import { SectionHeader } from '@/components/kit/layout/SectionHeader';

<SectionHeader
  icon={Medal}
  title="Tier breakdown"
  infoText="Shows tiers with 5+ scores"
  meta="1,368 of 1,368 scores rated"
/>;
```

Props:

- `icon`: always muted. It is optional in the API, but every section header on the site has one, so give yours one too.
- `title`: sentence case. Renders as h2; pass `level={3}` (or 4) when the panel sits under another heading.
- `infoText`: how to read the section, shown through InfoButton, named "About {title}" with the title lower-cased mid-sentence ("About tier breakdown"). Every derived info button name goes through `aboutLabel` (`@/lib/kit/layout/about-label`), which keeps a leading short form or osu! term as it is ("About API keys"); hand-written names read the same way.
- `meta`: short muted text such as a count, with separators. It is set in tabular figures.
- `actions`: small controls for the whole section, after the meta. A `sm` (32px) button fits inside the 48px strip, so a header with actions is as tall as one without and side-by-side panels keep their dividers level.

Do:

- Keep it the only header style inside panels.
- Leave it out of a list's panel; that panel starts with its ListToolbar, whose count does the meta's job.

Don't:

- Don't colour section icons blue, and don't use 24px icons or 18px titles.
- Don't put the title in Title Case.

Loading: `SectionHeaderSkeleton` ([feedback.md](feedback.md#skeletons)) draws the real strip with its static title.

Gallery anchor: `/admin/design#layout-section-header`

## InfoButton

The one help affordance: a muted circled "i" beside the thing it explains. It opens on hover, on keyboard focus and on tap, so it works on phones.

```tsx
import { InfoButton } from '@/components/kit/layout/InfoButton';

<span className="flex items-center gap-1.5">
  Rank restriction
  <InfoButton label="About rank restriction">
    Best global rank allowed, 1 if open
  </InfoButton>
</span>;
```

Props:

- `label`: the accessible name, such as "About rank restriction". Required.
- `children`: the explanation: one short fragment with no full stop.
- `size`: `md` (16px glyph) beside 14px and 16px text, `sm` (14px) beside 12px labels.
- `onArt`: on a DetailHero's art, white at 80% and full white on hover, with a white focus ring, like the other controls there.
- `side`, `align`: where the bubble opens.

Do:

- Use it for every inline explanation: form labels, stat labels, table headers, chart cards.
- Leave the hit area alone: the glyph is 16px (14px at `sm`) in a 20px button, and an invisible ring widens the target to 28px without moving the layout.
- Keep the default arrow cursor on anything whose only job is a tooltip: InfoButton, TapTooltip triggers, tier icons, flags. The pointer (hand) is for links and buttons that do something.
- Write the one fact the screen lacks, as a fragment the owner would write: "Shows mods with 5+ scores", "Only games this player played in", "Averages per game", "Lobby prefix such as OWC2024", "Best global rank allowed, 1 if open". Lead with the fact, often a verb such as Shows, Includes or Also accepts.
- Use the site's words: "verified games", "used", "5+", "1%+", "1.75x".

Don't:

- Don't use a circled question mark (lucide's `CircleHelp`).
- Don't explain anything in a hover-only tooltip or a `title` attribute.
- Don't write sentences: no full stop, no second clause, no hedge ("may", "can result").
- Don't name what the chart or table already shows, such as its mod rows or its grouping.
- Don't add an info button whose only fact is visible, such as a select whose options read 1v1 to 8v8; leave the label alone.
- Don't add `cursor-pointer` or `cursor-help` to a tooltip trigger, even one that pins its content on click; the hand promises a link.
- Don't colour the glyph blue.
- Don't put it inside another button or link, such as a sortable column header; it is a button itself, so place it beside that control.

Gallery anchor: `/admin/design#layout-info-button`

## TermTooltip

A label with a subtle dotted underline that opens how its figure is calculated, on hover, keyboard focus and tap, like InfoButton. Only the tournament match cost uses it, by owner decision: its column header in the top performers table and the label under each phone row's value.

```tsx
import { TermTooltip } from '@/components/kit/layout/TermTooltip';

<DataTableHead numeric>
  <TermTooltip hint="Average of all matches plus up to 50% depending on number of matches played">
    Match cost
  </TermTooltip>
</DataTableHead>;
```

Props:

- `children`: the label. It is the button's text, so it names the button.
- `hint`: the explanation, one short fragment.
- `side`, `align`: where the bubble opens. `side` defaults to `top`.

Do:

- Use the same label and hint everywhere the figure appears on a page, such as a table header and its phone rows.

Don't:

- Don't use it in place of an InfoButton without an owner decision; every other explanation is an InfoButton.
- Don't put it inside a link or another button, such as a sortable column header.

Gallery anchor: `/admin/design#layout-term-tooltip`

## Tile

The small bordered box inside a panel, for one record or attribute: 8px corners, a faint tint and a border.

```tsx
import { Tile } from '@/components/kit/layout/Tile';

<Tile>
  <Eyebrow className="block">Most used in</Eyebrow>
  <Link href={…}>Break The Meta Cup</Link>
</Tile>;

<DialogTrigger asChild>
  <Tile asChild interactive>
    <button type="button">…</button>
  </Tile>
</DialogTrigger>;
```

Props:

- `asChild`: draw the tile chrome on the child element, such as a button.
- `interactive`: hover tint, pointer and focus ring, for a tile that opens something. Its content stacks from the top, so a button tile beside a taller tile keeps its label level with the neighbour's. Add `className="relative"` and a muted `ChevronRight` (`absolute top-2.5 right-3 size-3.5`) so it reads as openable, like the beatmap "Pooled in" tile.

Do:

- Put tiles in a grid inside a panel, `gap-2`.
- Give an Eyebrow that sits straight inside a Tile `className="block"`. Inline, it takes the body's 24px line and starts 6px lower than a neighbouring tile's label.
- Use StatTile when the tile is a label and a number.

Don't:

- Don't use a grey shadowed stat card or a borderless grey box; a number with its label is a StatTile.
- Don't put a tile on the page by itself, outside a panel.

Gallery anchor: `/admin/design#layout-tile`

## StatTile and StatTileGrid

One number with its label, such as a rating, a rank, a count or a win rate. StatTileGrid is the `dl` that lays them out, two columns on phones.

```tsx
import TierIcon from '@/components/icons/TierIcon';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';

<StatTileGrid columns={3}>
  <StatTile
    label="Rating"
    value="2,215"
    adornment={
      <TierIcon tier="Grandmaster" subTier={2} tooltip width={22} height={22} />
    }
    sub="Peak 2,302"
  />
  <StatTile icon={Swords} label="Matches" value="1,204" />
</StatTileGrid>;
```

Props:

- `label`: sentence case, 12px muted, truncated. `icon` puts a small muted icon before it. A short form players know from osu!, such as CS, AR, OD or HP, shows as plain text, and screen readers hear the full name instead: `label={<><span aria-hidden="true">CS</span><span className="sr-only">Circle size</span></>}` (the beatmap attributes' names are in `lib/beatmaps/presentation.ts`). A plain word such as "Keys" needs neither.
- `value`: already formatted (separators on counts, never on years or IDs). It renders 20px bold (18px semibold inline) with `leading-none`, so the value line is as tall as the text, like the beatmap tiles, and in tabular figures, so digits line up from tile to tile. Tabular figures also widen Inter's hyphen; a hyphenated word as a value (rare) takes `<span className="proportional-nums">`.
- `adornment`: sits 4px left of the value and overhangs its 20px line, so a 20–24px icon does not push the value or sub line out of step with the next tile. The profile's tier icon goes here; there is no separate tier tile. Pass TierIcon's `tooltip` there: it wraps the icon in a TapTooltip, so the tier's name opens on tap, hover and keyboard focus. Leave it off when the tile writes the tier's name in `sub`, as the match stat tiles do.
- `sub`: one muted line under the value.
- `infoText`: adds a small InfoButton after the label, named "About {label}" (lower-cased: "About win rate"). With a node as the label, name it with `infoLabel` ("About circle size").
- `layout="inline"`: the value on the label's line, with `children` (such as a gauge) underneath. For attribute grids like CS, AR, OD and HP.
- StatTileGrid `columns`: 2, 3 or 4 from `sm`.

Do:

- Always use StatTile inside StatTileGrid (it renders `dt` and `dd`).

Don't:

- Don't make a stat tile a button; use Tile with `asChild interactive`, as the beatmap's "Pooled in" tile does (`components/beatmap/BeatmapPoolsDialog.tsx`).
- Don't underline a label or open its full name in a tooltip or popover (owner decision, as for "Elite GM" on the home page): the visitor reads osu!'s own short forms on sight, and an underline reads as a link.

Loading: `StatTileGridSkeleton` with the same static labels and `columns` ([feedback.md](feedback.md#skeletons)).

Gallery anchors: `/admin/design#layout-stat-tile`, `/admin/design#layout-stat-tile-inline`

## RowList and RowListItem

A list inside a panel: divided rows that run edge to edge, with no box around each item. Use it for players, tournaments, matches and events.

```tsx
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { EntityLink } from '@/components/kit/tables/EntityLink';

<RowList>
  {teammates.map((player) => (
    <RowListItem
      key={player.id}
      leading={<OsuAvatar … />}
      title={
        <EntityLink href={`/players/${player.id}`}>{player.username}</EntityLink>
      }
      description={player.country}
      trailing={<span className="font-semibold">{player.rating}</span>}
    />
  ))}
</RowList>;
```

Props:

- `leading`, `title` (16px medium, truncates), `description` (14px muted), `trailing` (right-aligned): the standard layout. Pass only `children` for a custom row; it keeps the 16px by 12px padding.
- `href`: makes the whole row one link (not prefetched, like the beatmap lists) with the shared row cues from `@/lib/kit/tables/row`: `ROW_HOVER_TINT`, and `ROW_TITLE_HOVER`, which turns the title blue while the row is hovered. Every whole-row link (DataTableLinkRow, PhoneRow, RowListItem) uses these two, so they read the same. Only for lists whose rows already open as a whole (beatmap list, tournament list, pooled beatmaps, search results). The row must then hold no other link or button, so `title` is plain text; with only `children`, mark the name `data-row-title` yourself.
- `linkLabel`: the row link's accessible name, such as "View Break The Meta Cup". Always set it with `href`, or a screen reader reads every word in the row. It replaces everything inside the row for a screen reader, the status icon and a "Not in ratings yet" line included, so put in it whatever the row must say aloud besides the name, in the order the row shows it, as the tournament list does (`getTournamentRowLabel` in `components/tournaments/TournamentListRow.tsx`): "View verified tournament Break The Meta Cup BTMC, osu!, 1v1, 10,000+, Dec 4 – 18, 2021, 2 admin notes".
- `children`: with `title`, extra content under the description; without, the whole custom row.

Do:

- Link the entity's name with [EntityLink](tables.md#entitylink), so every name in a row reads and hovers the same. One link per destination: an avatar in `leading` stays unlinked; to make it open the entity too, pass it as EntityLink's `leading` instead.
- Keep the hover tint only on rows that are clickable as a whole, and take it from `ROW_HOVER_TINT` rather than writing `hover:bg-muted/40` by hand.

Don't:

- Don't add new whole-row links or row dialogs.
- Don't render each item as a card inside the panel.

Loading: `RowListSkeleton` ([feedback.md](feedback.md#skeletons)), with `stats` for rows that stack on phones.

Gallery anchor: `/admin/design#layout-row-list`

## Type scale

Five sizes, all sentence case. Use the `typeScale` classes or the small components instead of picking sizes by hand.

```tsx
import {
  Eyebrow,
  PageTitle,
  RowTitle,
  SectionTitle,
  typeScale,
} from '@/components/kit/layout/Typography';

<p className={typeScale.bodyMuted}>osu! · 1v1 · Open rank</p>;
<Eyebrow>Mod distribution</Eyebrow>;
```

| Key               | Classes                                                | Use                                                   |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `pageTitle`       | `text-2xl font-bold tracking-tight sm:text-3xl`        | the page's h1 (PageHeader and DetailHero render it)   |
| `pageDescription` | `text-sm leading-6 text-muted-foreground sm:text-base` | the line under a page title                           |
| `sectionTitle`    | `text-base font-semibold`                              | panel and section headings (SectionHeader renders it) |
| `rowTitle`        | `text-base font-medium`                                | the name on a row or entity tile                      |
| `body`            | `text-sm`                                              | running text, table cells                             |
| `bodyMuted`       | `text-sm text-muted-foreground`                        | descriptions and row details                          |
| `label`           | `text-xs font-medium text-muted-foreground`            | field, column, tile and group labels (`Eyebrow`)      |
| `meta`            | `text-xs text-muted-foreground`                        | counts and notes beside a heading                     |

- `PageTitle` is the h1 for the rare page without PageHeader or DetailHero.
- `SectionTitle` takes `level` (2 by default).
- `RowTitle` takes `as` (`p` by default).
- `Eyebrow` is the 12px muted label.

Do:

- Write every heading, label, button and status name in sentence case.
- Keep 12px (`text-xs`) as the smallest size.

Don't:

- Don't use `uppercase`, `tracking-wide`, Title Case headings ("Tournament Statistics", "Peak Day") or sizes below `text-xs`.
- Don't make a row title larger than its section title.

Gallery anchor: `/admin/design#layout-typography`
