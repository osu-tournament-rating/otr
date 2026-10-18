# Empty, error, loading and notices

What a page shows when there is nothing to show, when a request fails, while it loads, when the whole page is an outcome (not found, unauthorized, banned), and when the visitor needs to know something first.
Import each component from its own file under `@/components/kit/feedback/`; the section error stays at `@/components/error/SectionError`. The classes they share live in `@/lib/kit/feedback/`, with tests: `STATE_LAYOUT` and `STATE_TONE` (the frame, icon and title sizes that EmptyState, SectionError and StatusPage have in common) and `CALLOUT_TONE_CLASSES` and `CALLOUT_TONE_ICONS` (each callout tone's colours and glyph, for the tones in `CALLOUT_TONES`).

- [Choosing a state](#choosing-a-state): which component for which situation
- [EmptyState](#emptystate): nothing to show, with Clear filters when filters caused it
- [SectionError](#sectionerror): a failed request, at regular, compact and inline size
- [Skeletons](#skeletons): `PanelSkeleton`, `SectionHeaderSkeleton`, `StatTileGridSkeleton`, `TableSkeleton`, `PhoneRowListSkeleton`, `ListToolbarSkeleton`, `RulesetSwitchSkeleton`, `ChartPlotSkeleton`, `RowListSkeleton`, `HeroTabsSkeleton`, `LoadMoreSkeleton`, `SkeletonText`, `SkeletonBlock`
- [StatusPage](#statuspage): 404, unauthorized, banned and error pages
- [Callout](#callout): the one notice box, in info, warning and danger
- [When two notices meet](#when-two-notices-meet): never a stack of callouts
- [CalloutChip](#calloutchip): a short warning inside a panel

## Choosing a state

| Situation                                                  | Use                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A route is rendering                                       | its `loading.tsx`, built from the skeletons                                                                                                                                                                       |
| A panel's data is loading on the client                    | skeleton rows inside the real panel                                                                                                                                                                               |
| A request failed                                           | `SectionError`, sized to its container                                                                                                                                                                            |
| The whole route failed                                     | `RouteError` in the route's `error.tsx`                                                                                                                                                                           |
| The request worked and returned nothing                    | `EmptyState`                                                                                                                                                                                                      |
| The visitor's filters returned nothing                     | `EmptyState` with `clearFilters`                                                                                                                                                                                  |
| The page itself is the outcome (404, unauthorized, banned) | `StatusPage`                                                                                                                                                                                                      |
| The visitor should know something before acting            | `Callout`                                                                                                                                                                                                         |
| A panel's data has a caveat ("Includes unverified")        | `CalloutChip`                                                                                                                                                                                                     |
| A site-wide notice (the weekly maintenance window)         | `Callout variant="banner"`                                                                                                                                                                                        |
| A second notice where one already shows                    | one notice: merge or move it (below)                                                                                                                                                                              |
| The result of an action (saved, deleted, could not save)   | a toast (`toast` from `sonner`), not a callout                                                                                                                                                                    |
| The site has been updated since the tab loaded             | `SiteUpdatedToast`, already in the root layout: a pill centred at the bottom whose Reload icon turns every few seconds (`motion-safe:animate-spin-pause`). It cannot be dismissed and stays until the tab reloads |

Sizes for empty and error states, by container:

- `regular`: the main content of a panel (a list, a table, the whole section). It is at least 288px tall, so a panel keeps its weight.
- `compact`: a chart area, a small panel in a grid, a dialog, a table inside a dialog.
- `inline` (errors only): a "Load more" page, an expanded row, a form field's options. One line, Try again beside it.

Both block sizes go straight into the panel in place of the rows, directly under its SectionHeader or ListToolbar, with no wrapper, border or extra padding: their own padding sets the space.

Copy:

- Empty titles say what is missing: "No beatmaps match" when filtered, "No pooled beatmaps" or "No tournaments yet" otherwise, and "Not enough data" for a chart with too few points. No "available" or "not available": "No mod data", "No match statistics". The description says why or what to try, in one sentence.
- Error titles name the thing: "Tournaments could not load", "More audit events could not load". No "Unable to", "Failed to" or "Please", and no full stop in a title.
- Retry buttons always read "Try again", never "Retry".

## EmptyState

Takes the place of a list, table or chart that has nothing to show, in the section error's frame with a neutral icon, so an empty panel and a failed one line up.

```tsx
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';

// A filterable list's panel starts with its ListToolbar (layout.md).
<Panel>
  <ListToolbar
    label="Search and filter tournaments"
    search={<SearchField … />}
    rulesets={<RulesetChips … />}
    count={formatCountOf(rows.length, 'tournament')}
  />
  {rows.length === 0 ? (
    <EmptyState
      title={isFiltered ? 'No tournaments match' : 'No tournaments yet'}
      description={
        isFiltered
          ? 'Try a different name, ruleset, or fewer filters.'
          : 'No tournament submissions are available right now.'
      }
      clearFilters={isFiltered ? { href: clearFiltersHref } : undefined}
      data-testid="tournament-empty-state"
    />
  ) : (
    <RowList>…</RowList>
  )}
</Panel>;

// A chart with too little data:
<EmptyState size="compact" icon={ChartNoAxesColumn} title="Not enough data" />;
```

Props that matter:

- `title`: what is missing. `description`: one sentence.
- `icon`: neutral, never red; defaults to a crossed-out magnifier (`SearchX`). Pick one that names the thing (`ChartNoAxesColumn` for a chart, `Music` for beatmaps, `ClipboardList` for audit events).
- `clearFilters`: `{ href }` (the list's address without its filter parameters) or `{ onClick }`. Adds an outline "Clear filters" button, the controls family's `Button` at `default` size in the regular state and `sm` in the compact one. Only when the visitor's filters emptied the list.
- `action`: another way forward, such as a "Submit a tournament" link, after Clear filters. Make it a kit `Button` (`@/components/kit/controls/Button`) at the same size as Clear filters.
- `size`: `regular` (default) or `compact`.
- `titleAs`: the title element. Regular is an `h2` and compact a `p`; pass `h3` when the panel's own header is the `h2` and the outline needs it.
- Other props (`data-testid`, `className`) go on the root.

Do:

- Put it inside the panel, in place of the rows, under the panel's SectionHeader or the list's ListToolbar.
- Make "Clear filters" clear filters only. It never resets the search, sort, ruleset or tab (finding 22). Build the `href` from the current state with `clearListFilters(PARAMS, state)` and the list's href helper, as the tournament list and the leaderboard do, or pass `{ onClick: list.clearFilters }` from a client component.

Don't:

- Don't write a bare line of muted text for an empty list ("No results.", "No matches found").
- Don't use a red icon or `role="alert"`; nothing failed.
- Don't use it in a combobox or command menu; `CommandEmpty` text stays there.
- Don't use it for a failed request. A failure that shows "No results" hides the problem; use SectionError.

Gallery anchors: `/admin/design#feedback-empty-state`, `/admin/design#feedback-empty-state-filtered`, `/admin/design#feedback-empty-state-compact`

## SectionError

Takes the place of a section whose data failed to load, with Try again, so a failure never reads as an empty list. It is a default export, used by the tournament list, the reports pages, the audit feeds and `SectionErrorBoundary`.

```tsx
import SectionError from '@/components/error/SectionError';

// A whole section:
<SectionError
  title="Tournaments could not load"
  retrying={isValidating}
  onRetry={() => void mutate()}
/>;

// A chart, a small panel or a dialog:
<SectionError
  size="compact"
  title="Rating history could not load"
  onRetry={retry}
/>;

// A failed "Load more" at the end of the audit log, centred under the rows
// (components/audit/AuditEventFeed.tsx):
<div className="border-t px-4 py-4">
  <SectionError
    size="inline"
    title="More audit events could not load"
    retrying={isValidating}
    onRetry={() => void mutate()}
    className="justify-center"
  />
</div>;
```

Props that matter:

- `title`: "<Thing> could not load".
- `onRetry`, `retrying`: `retrying` disables the button and spins its icon. Pass SWR's `isValidating`, or a transition's pending flag.
- `size`: `regular` (default; an `h2`, a 48px icon and a sentence), `compact` (a 36px icon and a 14px title, no sentence unless you pass one) or `inline` (one line: a 16px red icon, the title, a small Try again).
- `description`: regular falls back to "This is temporarily unavailable. Try the request again."; compact shows only what you pass; inline takes none.
- `className`: on the root. Inline is left-aligned; add `justify-center` under a centred list.

Do:

- Keep the whole failed area as the error: in a panel it replaces the rows, under the SectionHeader.
- Use `inline` for a failure inside content that otherwise loaded, so the loaded rows stay.
- Wrap server-rendered sections in `SectionErrorBoundary` (`components/error/SectionErrorBoundary.tsx`), which renders the regular size inside a Panel, in the failed section's place.

Don't:

- Don't build a Retry row by hand or colour the message `text-destructive`; the icon carries the red.
- Don't show a toast for a failed load; toasts are for actions.

Gallery anchors: `/admin/design#feedback-section-error`, `/admin/design#feedback-empty-state-compact`, `/admin/design#feedback-section-error-inline`

## Skeletons

Building blocks for loading screens, shaped like the kit's panels, section headers, stat tiles, tables, phone rows and lists, so a loading screen matches its page and nothing shifts when the data arrives. Each one renders the real kit component (Panel, SectionHeader, StatTile, DataTable, PhoneRow, RowList) with bars in place of the data, so the gallery's Loading and Loaded states measure the same at 1440 and 390px.

```tsx
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

// app/reports/MyReportsFrame.tsx (with MyReportsTableSkeleton inlined): the
// page and app/reports/loading.tsx share the frame, so the loading screen
// keeps the real header.
export function MyReportsPanelSkeleton() {
  return (
    <PanelSkeleton label="Loading reports">
      <SectionHeaderSkeleton icon={Flag} title="Reports" />
      <TableSkeleton
        columns={MY_REPORTS_SKELETON_COLUMNS}
        cellHeight="h-9"
        phoneRows={
          <PhoneRowListSkeleton
            description="badge"
            value="button"
            align="start"
          />
        }
      />
    </PanelSkeleton>
  );
}
```

The parts:

- `PanelSkeleton`: the Panel surface. Give it children, or none for a header strip and a body block (charts, or any panel that is hard to sketch); then set its height to the loaded panel's, such as `className="h-[23rem]"`. `label` makes it the screen's `role="status"` region.
- `SectionHeaderSkeleton`: renders the real SectionHeader with the static `title`, `icon` and `infoText` (its info button is drawn and works, so the title keeps its width), and bars for the meta (`meta`, on by default, 80px wide; `false` for none) and `actions` (a count of 32px button placeholders). Give `meta` a width class as wide as the loaded meta, such as `meta="w-40"` for "1,368 of 1,368 scores rated", so a loading strip wraps on a phone where the loaded one does. `level` matches the loaded header's. Without a title it draws a bar in the title's place.
- `StatTileGridSkeleton`: the real StatTileGrid and StatTiles with their static `labels`, bars for the values, and `sub` for the line under them. Same `columns` as the loaded grid.
- `TableSkeleton`: a real `DataTable` (fixed layout, hidden from assistive tech) with its tinted header strip and `rows` of bars. `columns` is a count, or the loaded table's columns, in DataTable's terms: `label` (the real header), `width` (a width class; columns without one share the rest), `align: 'end'` for numbers, `showFrom` for a column the loaded table hides below a breakpoint. `cellHeight` is the height of the tallest thing in a loaded cell and so sets the row height: `h-6` (default) for a 24px avatar or badge, as in the beatmap tables; `h-5` plain text; `h-8` a 32px avatar; `h-9` a two-line cell. `phoneRows` works as on DataTable. `className` goes on the table's wrapper.
- `PhoneRowListSkeleton`: the real PhoneRowList and PhoneRows, for `phoneRows`. Match the loaded rows' parts, so each row keeps its height: `rank`; `avatar` (24px, inside the name) or `leading={32}` (a 32px avatar beside the name and its line); `description` (on by default; `"badge"` for a 20px status badge before the text, as the reports' phone rows have); `value` (on by default: the key number; `"button"` for a 32px button such as View, `"badge"` for a 20px badge); `valueDescription`; and the loaded rows' `align`.
- `ListToolbarSkeleton`: the real ListToolbar strip with a block for each control, for a list's loading screen. Turn on the loaded toolbar's slots: `search`, `sort`, `filters` and `count` (booleans), `rulesets` (how many chips: 6 for RulesetChips with every rated ruleset and All, 5 for a RulesetSwitch; each block is as wide as its loaded chip, so they wrap onto as many lines), `rulesetsAll={false}` for a RulesetSwitch, which has no All chip (the leaderboard: `rulesets={5} rulesetsAll={false}`), `view` (how many toggles), and `scope` and `leading` (a width class for their block, such as `scope="w-64"`). Give `scope` a responsive width when the loaded control changes width, such as the admin report queue's `scope="w-74 sm:w-80"` (ScopeSwitch buttons are narrower below `sm`). The blocks land on the rows the loaded toolbar uses, at every width.
- `RulesetSwitchSkeleton`: a RulesetSwitch outside a toolbar, such as the stats page's rating distribution strip: one 32px block per chip (`count`, five by default) at the loaded chip's width. Give it the strip's padding and border with `className`.
- `ChartPlotSkeleton`: a chart's plot area, a full-width block as tall as the loaded plot (`className="h-60"`), under a real SectionHeaderSkeleton inside a PanelSkeleton with children. Use it instead of a childless PanelSkeleton when the header is static, so the real title shows.
- `SkeletonBlock`: a plain block for a control the other parts don't cover, such as a 40px select or a 32px button. Give it the control's height, width and corners. For a line of text use SkeletonText.
- `RowListSkeleton`: the real RowList with bars for the title, `description` and `trailing` number, and a `leading` avatar, `square`, `cover` or `none`. For lists built from RowList, not for tables (their phone rows are PhoneRows, which are shorter). `meta` adds a second muted 20px line under the description, 6px below it (`"badge"` starts it with a 20px badge, as the profile's pooled beatmap metrics). `stats` (a count) draws small stats, a 12px label over a 14px value, that sit under the text on phones and on the right from `sm`, as rows that stack on phones do (the profile's tournament history: `leading="none" stats={2} statsAction`); `statsAction` adds a 32px button after them. A stat whose value is a RatingDelta is 2px taller when loaded (RatingDelta's line is 22px).
- `HeroTabsSkeleton`: a hero tab strip of 44px tabs, with the real `labels` when they are static or `tabs` (a count) of bars when they follow the data. Inside a panel, as an audit history's tabs, pass `className="border-b"` like the loaded HeroTabs; not a plain `h-11` bar.
- `LoadMoreSkeleton`: LoadMore's 57px tinted footer, with a bar for the readout and a block for the button. Put it after the rows when the loaded list shows a LoadMore on first load, such as the profile's "Show more".
- `SkeletonText`: an inline bar that keeps the height of the line it stands in for. Use it inside a real component, such as a PageHeader description whose text is not static: `description={<SkeletonText className="w-72" />}`. Inside a flex container wrap it in a `<span>`, or the line shrinks to the bar's 16px.

A block whose height follows static text that wraps, such as a Callout, can't be matched with a fixed height at every width. Lay the real component out inside one pulsing block and hide it, so the block wraps as the text does; the settings page's danger zone does this (`DangerZonePanelSkeleton` in `app/settings/SettingsFrame.tsx`):

```tsx
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
```

Do:

- Build `loading.tsx` from the same PageFrame, PageHeader or DetailHero and panels as the page, with the real static text (titles, labels, column headers), and change it whenever the page's layout changes.
- Copy the loaded table's column widths, alignment and `showFrom` into `columns`, and check with the browser that a row is the same height loading and loaded.
- On a page with tabs, underline the tab being opened and draw that tab's panels. A `loading.tsx` gets no search params, so a small client piece reads `?tab=` with `useSearchParams`, as `app/matches/[id]/loading-views.tsx` and `app/tournaments/[id]/loading-views.tsx` do.
- Announce once per screen: `label` on one PanelSkeleton, or `role="status"` and `aria-label` on the PageFrame.
- Inside an already-rendered panel (a client fetch, an expanded row), show two or three skeleton rows where the content goes instead of a spinner.

Don't:

- Don't draw a whole panel as one grey block (a bare `Skeleton className="h-[23rem] rounded-xl"`); use PanelSkeleton at that height so the border and header strip show.
- Don't put a spinner and "Loading…" text inside a panel.
- Don't give a skeleton chrome the page doesn't have: a card of its own, blue 24px section icons or Title Case titles.
- Don't keep a page's own copy of the ruleset chip widths or a hand-made plot block; use RulesetSwitchSkeleton (or `rulesetsAll={false}` in a toolbar) and ChartPlotSkeleton, as `app/stats/loading.tsx` does.
- Don't use random widths; server and client must render the same markup.

The site-wide spinner in `app/loading.tsx` stays for routes without a page-shaped skeleton.

Gallery anchors: `/admin/design#feedback-skeleton-panel` (with SectionHeaderSkeleton's info button and meta width), `/admin/design#feedback-skeleton-table` (TableSkeleton and PhoneRowListSkeleton), `/admin/design#feedback-skeleton-toolbar` (RulesetChips and RulesetSwitch lists), `/admin/design#feedback-skeleton-tabs` (HeroTabsSkeleton), `/admin/design#feedback-skeleton-chart` (ChartPlotSkeleton and RulesetSwitchSkeleton), `/admin/design#feedback-skeleton-rows` (with stacked rows and LoadMoreSkeleton), `/admin/design#feedback-skeleton-text` (SkeletonText and SkeletonBlock)

## StatusPage

The one layout for pages that are an outcome rather than content: not found, unauthorized, banned, and route errors. An icon, a short h1, one sentence and, when the page offers a way forward, one action, centred in the content column like the route error screen.

```tsx
import Image from 'next/image';
import { Compass } from 'lucide-react';

import { StatusPage } from '@/components/kit/feedback/StatusPage';

// app/not-found.tsx
export default function NotFound() {
  return (
    <StatusPage
      icon={Compass}
      title="Page not found"
      description="Sorry, we don't have that page!"
      background={
        <Image
          src="/images/error-background.svg"
          alt=""
          fill
          sizes="100vw"
          // The art is empty in the middle. Always show all of it: cropped,
          // the outer shapes end in a hard edge at the column's sides. On
          // phones it sits at the top, so the shapes flank the icon and stay
          // off the text.
          className="object-contain object-top sm:object-center"
        />
      }
    />
  );
}

// app/auth/banned/page.tsx
<StatusPage
  icon={ShieldAlert}
  tone="destructive"
  title={<span data-testid="banned-heading">Account suspended</span>}
  description="Your osu! Tournament Rating account has been temporarily disabled. If you believe this is an error, please contact the administrators."
>
  {reason ? (
    <p className="break-words text-muted-foreground">
      <span className="font-medium text-foreground">Reason:</span>{' '}
      <span data-testid="banned-reason">{reason}</span>
    </p>
  ) : null}
</StatusPage>;
```

Props that matter:

- `icon`, `tone`: `neutral` (default; a muted icon on a grey disc) for not found and unauthorized, `destructive` (red icon) for bans and failures.
- `title`: the page's h1, a few words in sentence case. It takes a node, so a test id can sit on a span inside it.
- `description`: one sentence.
- `action`: one kit `Button` at `default` size, like EmptyState's and Callout's `action`, and only when the page offers a way forward. A route error has Try again, and may put a way back before it (pass both in a fragment: `<Button asChild variant="outline" icon={ArrowLeft}>` on the link, then `<Button icon={RefreshCw}>Try again</Button>`), as `RouteError` does; nothing else gets two. Not found, unauthorized and banned have no action.
- `background`: decorative art behind the content, hidden from assistive tech. The 404's blurred shapes go here; give the image `alt=""`.
- `children`: one detail between the sentence and the action, such as a ban reason. It is centred in 14px text, up to 384px wide.
- Other props (`role`, `data-testid`, `className`) go on the root. Pass `role="alert"` for an error screen.

Do:

- Render it straight from the page; the root layout's `main` already provides the margins.
- In a route's `error.tsx`, render `RouteError` (`components/error/RouteError.tsx`) with `title` ("Beatmap could not load"), Next's `retry`, and an optional `back` (`{ href: '/beatmaps', label: 'Beatmaps' }`); it draws this page in red with `role="alert"`.
- Use the primary button for the one way forward, when the page has one.
- Title the 404 "Page not found" and keep its sentence, "Sorry, we don't have that page!".

Don't:

- Don't use a large blue heading (`text-4xl text-primary`) or a card around the message.
- Don't render another `<main>` inside the layout's.
- Don't use `container mx-auto` or padding of your own; the layout's `main` already frames the page.
- Don't crop the 404 art with `object-cover`; its outer shapes end in a hard edge.

Gallery anchors: `/admin/design#feedback-status-page`, `/admin/design#feedback-status-page-variants`

## Callout

The one notice box. Info for context, warning for something to check before acting, danger for something that cannot be undone. The tone sets the fill, border, text and glyph (info circle, triangle, octagon) from the colour family's `callout-*` tokens.

```tsx
import { Callout } from '@/components/kit/feedback/Callout';

// app/tools/filter/FilteringPageClient.tsx
<Callout tone="warning" title="Host compliance">
  Hosts must comply with the{' '}
  <a href={FILTERING_RULES_URL}>official tournament support filtering rules</a>:
  …
</Callout>;

// app/settings/AccountDeletionClient.tsx, where the Button is a ConfirmDialog's
// trigger. Button is the controls family's: @/components/kit/controls/Button
<Callout
  tone="danger"
  action={
    <Button variant="destructive" size="sm" icon={Trash2}>
      Delete my account
    </Button>
  }
>
  Permanently delete your account and remove your data from o!TR. Your player
  profile will remain public.
</Callout>;

// components/banner/SiteBanner.tsx: the one strip under the site header
<Callout
  tone="warning"
  variant="banner"
  role="status"
  data-testid="maintenance-window-banner"
>
  Ratings are pending recalculation, performance may be degraded
</Callout>;
```

Props that matter:

- `tone`: `info` (default), `warning`, `danger`.
- `title`: a short sentence-case lead, in semibold. Leave it out for a one-line note.
- `children`: one or two sentences. Links inside are underlined in the tone's colour.
- `action`: one kit `Button` at `sm`, or a Button drawn on a link with `asChild`, on the right from `sm` and under the text on phones. It keeps the normal text colour.
- `icon`: replaces the tone's glyph when a closer one exists.
- `variant`: `block` (default; 8px corners, 16px by 12px padding) or `banner` (full width, a bottom border, 12px centred text wrapped in balanced lines, so a phone never shows one word alone on the last line) for the strip under the site header.
- Other props (`role`, `data-testid`) go on the root. It has no role by default; give a banner `role="status"`.

Do:

- Put a page's callout directly under its PageHeader or DetailHero, or at the top of the panel it is about.
- Use info for context, not the link blue: the info tone is a quiet slate.
- Start a destructive action with the kit Button's `destructive` variant (red text and border, no fill); solid red is only in the final confirm dialog (finding 35).

Don't:

- Don't build notices from palette classes (`orange-*`, `amber-*`, `yellow-*`, `blue-*`) or a tinted box of your own; every notice is a Callout.
- Don't stack several callouts; merge them, or move the less important one into the page (see [When two notices meet](#when-two-notices-meet)). The site banner does this: during the weekly maintenance window a signed-out visitor gets one warning strip that ends with "Some features are not available while signed out.", never the info strip stacked over it (`SiteBannerContent` in `components/banner/SiteBanner.tsx`, which the root layout renders once).
- Don't use a callout for an action's result; that is a toast.
- Don't use a callout for "Not in ratings yet" on a detail page; that is `NotInRatings variant="notice"` from the status family.

Gallery anchors: `/admin/design#feedback-callout`, `/admin/design#feedback-callout-action`, `/admin/design#feedback-callout-banner`

## When two notices meet

Owner decision: don't stack callouts; merge them, or move the less important one into the page. Each place shows at most one notice: the site banner under the site header, one Callout under the PageHeader or DetailHero, and one at the top of each panel. When a second notice would land in a place that already has one:

1. **Site-wide and site-wide** (the maintenance window and the signed-out note): one banner. `SiteBannerContent` already merges them into the warning strip, so never render a second `variant="banner"`.
2. **The maintenance window and a page notice**: the banner already says the window is on, so a page never repeats it. When the window blocks something on the page, say what is blocked and when it comes back, in the place of the thing it blocks: a Callout at the top of that panel in place of its form or rows, or the disabled control's own reason (an AdminMenu item's `description`, a ScopeSwitch's `disabledReason`). The page's own notice under its header stays as it is, unless the window blocks the whole page. The registrant filtering tool (owner decision, 16 Oct): during the window it shows only "Filtering is temporarily unavailable" under its PageHeader, in place of "Host compliance" and the form; the compliance rules apply only while the tool is on.
3. **Two notices about the page itself**: merge them into one Callout with the stronger tone (danger over warning over info), the more important point first, both in a sentence or two. If one is about a single section, move it to the top of that panel or FormSection instead.
4. **A notice about a single field**: it is the field's help (`FormFieldLabel` `info`, `FormDescription`) or its error (`FormMessage`), never a Callout.

Gallery anchors: `/admin/design#feedback-callout-merge`, `/admin/design#feedback-callout-banner`

## CalloutChip

A short notice inside a panel, such as "Includes unverified" on a chart: the callout's colours on a small outlined chip (the status family's `Badge` with `shape="rounded"`). It is plain text: its words say it all, so nothing opens from it.

```tsx
import { ShieldQuestion } from 'lucide-react';

import { CalloutChip } from '@/components/kit/feedback/CalloutChip';

<SectionHeader
  icon={ChartNoAxesColumn}
  title="Tournament rank restrictions"
  actions={<CalloutChip icon={ShieldQuestion}>Includes unverified</CalloutChip>}
/>;
```

Props that matter:

- `tone`: `warning` (default), `info`, `danger`.
- `children`: two or three words.
- `icon`: replaces the tone's glyph, such as a shield for unverified data.
- `size`: `md` (24px, default) in a section header, `sm` (20px) beside 12px text.

Do:

- Put it in the SectionHeader's `actions`, or beside the one thing it qualifies.

Don't:

- Don't use it as a label for an entity's attribute (a mod, a ruleset, a role); that is the status family's `Badge`.
- Don't write a sentence in it; use a Callout.
- Don't open a tooltip or popover from it that rewords its own label (owner decision, as for close buttons); if the chip's words aren't enough, the notice is a Callout.

Gallery anchor: `/admin/design#feedback-callout-chip`
