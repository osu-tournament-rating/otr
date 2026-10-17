# Lists, search and filters

Everything that sits on top of a list: the toolbar strip, search, sort, ruleset chips, the scope switch, the filter panel and its fields, active-filter chips, and the list state in the page address.
The beatmap list is the reference. Components live in their own files under `@/components/kit/lists/`; the URL-state, search, sort, chip-label and calendar helpers, with unit tests, under `@/lib/kit/lists/`.

- [Rules at a glance](#rules-at-a-glance)
- [A list page, end to end](#a-list-page-end-to-end)
- [ListToolbar](#listtoolbar): the strip at the top of a list's panel
- [SearchField](#searchfield): the one search box
- [SortControl](#sortcontrol): key dropdown plus direction button
- [RulesetChips](#rulesetchips): filter a list by rulesets
- [RulesetSwitch](#rulesetswitch): one ruleset at a time
- [ScopeSwitch](#scopeswitch): All / Friends, and view toggles such as Chart / Table
- [ChoiceChip](#choicechip): one toggle chip
- [FilterPanel and FilterButton](#filterpanel-and-filterbutton): the Filters button and its panel
- [Filter fields](#filter-fields): `RangeFilter`, `ChoiceFilter`, `DayRangeFilter`, `SwitchFilter`, `FilterField`
- [DateField and Calendar](#datefield-and-calendar): a UTC day without the browser's date field
- [ActiveFilterChips](#activefilterchips): removable chips for active filters
- [useListState and list params](#useliststate-and-list-params): list state in the address
- [Sort state](#sort-state): `SortState`, shared with table headers

## Rules at a glance

- Every control that changes what a list shows is in the page address: search, sort, page, filters, ruleset, scope, tab. A reload or a shared link shows the same list. Defaults are left out of the address.
- One toolbar: search, sort and Filters on the first row; scope, ruleset chips, view options and the result count on the second; active-filter chips under both. A list without a search is one strip: scope on the left, count, sort and Filters on the right. It sits inside the list's panel, above the rows.
- Two heights, so each row lines up: the first row is 40px (the search field, the sort dropdown, its direction IconButton and the Filters button, all at the `lg` size); the second row and the active-filter row are 32px (the scope switch, ruleset chips, layout toggles, active-filter chips and the ghost `sm` "Clear all"). Outside a toolbar, a SortControl in a SectionHeader or a DataTable's phone sort strip is `size="sm"` (32px).
- Buttons are the controls family's: text buttons are `Button` (`@/components/kit/controls/Button`) and icon-only ones `IconButton` (`@/components/kit/controls/IconButton`), never `@/components/ui/button`. Chips, the scope switch's segments, layout toggles and calendar days are not buttons in that sense and keep their own look.
- Search waits 400ms after the last keystroke (`SEARCH_DEBOUNCE_MS`), Enter searches at once, a spinner shows until results land, and fewer than 2 characters shows "Type at least 2 characters to search." instead of searching.
- Sort is a dropdown plus a direction button, sharing `{ key, direction }` with sortable column headers.
- Filters apply as you change them. The Filters button shows how many are active. "Clear all" resets the filter panel's fields only; search, sort, ruleset, scope and tab stay.
- Rulesets are chips labelled osu!, taiko, catch, mania 4K, mania 7K: any number to filter a list, one at a time (`RulesetSwitch`) on the profile, stats and leaderboard.
- Nothing scrolls sideways on a phone: the toolbar wraps, chips wrap, and labels wrap instead of truncating.
- No browser date fields (`type="date"`); use `DateField`.

## A list page, end to end

The tournament list is the worked example. Define the list's params once, at module level, in a file both the server page and the client toolbar import (simplified from `app/tournaments/list-params.ts`):

```ts
// app/tournaments/list-params.ts
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import {
  arrayParam,
  booleanParam,
  dayRangeParam,
  defineListParams,
  flagsParam,
  pageParam,
  rangeParam,
  searchParam,
  sortParam,
} from '@/lib/kit/lists/params';
import { VERIFICATION_STATUS_ORDER } from '@/lib/kit/status/verification';

export const TOURNAMENT_LIST_PARAMS = defineListParams({
  q: searchParam(),
  page: pageParam(),
  sort: sortParam(['endTime', 'startTime', 'submitted', 'lobbySize'], {
    key: 'endTime',
    direction: 'desc',
  }),
  ruleset: arrayParam(RATED_RULESETS, { role: 'scope' }),
  status: arrayParam(VERIFICATION_STATUS_ORDER),
  reason: flagsParam(TOURNAMENT_REJECTION_REASONS, { key: 'rejectionReason' }),
  rank: rangeParam({ min: 1, max: 1_000_000, integer: true }),
  date: dayRangeParam(),
  verified: booleanParam(),
});

/** The procedure's input for a list state. */
export function toTournamentListRequest(state: TournamentListState) { … }
```

The server page parses it and fetches; the client toolbar reads and writes it:

```tsx
// app/tournaments/page.tsx (server)
const state = parseListState(TOURNAMENT_LIST_PARAMS, await searchParams);
const data = await orpc.tournaments.listPage(toTournamentListRequest(state));

// components/tournaments/list/TournamentListToolbar.tsx ('use client')
const list = useListState(TOURNAMENT_LIST_PARAMS);
const { state, setState } = list;

<ListToolbar
  label="Search and filter tournaments"
  search={
    <SearchField
      label="Search tournaments by name or abbreviation"
      placeholder="Name or abbreviation"
      value={state.q}
      pending={list.isPending}
      onSearch={(q) => setState({ q })}
    />
  }
  sort={
    <SortControl
      label="Sort tournaments by"
      options={SORT_OPTIONS}
      value={state.sort}
      onValueChange={(sort) => setState({ sort })}
    />
  }
  filters={
    <FilterPanel
      title="Filter tournaments"
      activeCount={list.activeFilterCount}
      onClearAll={list.clearFilters}
    >
      <ChoiceFilter label="Status" … />
      <RangeFilter label="Rank restriction" … />
      <DayRangeFilter label="Tournament dates" … />
    </FilterPanel>
  }
  rulesets={
    <RulesetChips
      value={state.ruleset}
      onValueChange={(ruleset) => setState({ ruleset })}
    />
  }
  // From the server page: formatCountOf(data.totalCount, 'tournament', 'tournaments')
  count={count}
  activeFilters={
    <ActiveFilterChips filters={…} onClearAll={list.clearFilters} />
  }
/>;
```

The page with the list must render dynamically (it reads `searchParams`), or the toolbar must sit in `<Suspense>`, because `useListState` uses `useSearchParams`.

## ListToolbar

The strip at the top of a list's panel, laid out like the beatmap list. Pass only the slots the list has; the rows below it are the panel's own.

```tsx
import { ListToolbar } from '@/components/kit/lists/ListToolbar';

<Panel>
  <ListToolbar
    label="Search and filter players"
    search={<SearchField … />}
    filters={<FilterPanel …>…</FilterPanel>}
    scope={<ScopeSwitch … />}
    rulesets={<RulesetSwitch … />}
    count="12,483 players"
    activeFilters={<ActiveFilterChips … />}
  />
  <DataTable …/>
</Panel>;
```

Props that matter:

- `label`: names the toolbar, which is a `search` landmark ("Search and filter tournaments").
- First row: `leading`, `search`, `sort`, `filters`. Without a sort, the Filters button stays beside the search box on phones.
- `leading`: a control that is not a search and not a filter, first on the first row, such as the audit pages' "Show system events" switch (`components/audit/AuditSystemSwitch.tsx`), which widens the list rather than filtering it, or the select-all checkbox of a list with bulk actions. It sits before the search box, or before the scope when there is no search. It is not a place for a second search or for filters; those have their slots.
- Second row: `scope` and `rulesets` on the left, `view` (layout toggles) and `count` on the right. `count` is already formatted with `formatCountOf`, set in tabular figures and announced politely. Layout toggles are a `ToggleGroup` of 32px (`size-8`) icon items with an `aria-label` each; leave tooltips off them, because a `TooltipTrigger`'s `data-state` replaces the item's `on`/`off`.
- `activeFilters`: `ActiveFilterChips`. Its row, and the divider above it, disappear when it renders nothing.
- When nothing matches, render `EmptyState` (`@/components/kit/feedback/EmptyState`) straight under the toolbar in place of the rows, with `clearFilters` when filter-role params are active (`activeFilterCount > 0`). Not a line of muted text.

Where the toolbar puts things (`getListToolbarLayout` in `@/lib/kit/lists/toolbar`, unit-tested), so the count shares a line with other controls wherever one has room:

| The list has                    | Tablet and up                                                      | Phones                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| search, sort, filters, rulesets | search \| sort, Filters; then chips … count                        | search; sort, Filters; chips, with the count beside them when they fit and under them on the right when not                 |
| search, scope, rulesets         | search \| …; then scope, chips … count                             | search; scope … count; chips                                                                                                |
| search and a count, no chips    | search, count \| sort, Filters (the count beside the search box)   | the same, wrapped                                                                                                           |
| no search: scope, sort, count   | one strip: scope … count \| sort, Filters (the admin report queue) | scope … count; sort and Filters. A scope too wide to share its line (four options) sends the count down beside sort instead |
| no search: leading, filters     | one strip: leading … Filters (the audit log)                       | the same line, Filters on the right; Filters wraps under, on the right, only when both don't fit                            |

Loading: `ListToolbarSkeleton` from `@/components/kit/feedback/Skeletons` with the same slots switched on ([feedback.md](feedback.md#skeletons)).

Do:

- Put it first inside the list's Panel, above the rows or table, as the beatmap list does.
- Use it for every list: tournaments, beatmaps, the leaderboard, audit logs, reports, filter results.

Don't:

- Don't build a toolbar by hand, put a Filters button in a card title above the table, or lay filters out as a row of dropdowns.
- Don't let a toolbar scroll sideways or cut off its Filters button on phones.

Gallery anchors: `/admin/design#lists-toolbar`, `/admin/design#lists-toolbar-scope`, `/admin/design#lists-toolbar-no-search`, `/admin/design#lists-toolbar-leading`, `/admin/design#lists-toolbar-view`, `/admin/design#feedback-skeleton-toolbar`

## SearchField

The one search box: a search icon that turns into a spinner while results load, a clear button, and a hint under the box while the term is too short.

```tsx
import { SearchField } from '@/components/kit/lists/SearchField';

<SearchField
  label="Search tournaments by name or abbreviation"
  placeholder="Name or abbreviation"
  value={state.q}
  pending={list.isPending}
  onSearch={(q) => setState({ q })}
/>;
```

Props that matter:

- `value`: the term the list currently shows results for (from the address). The field keeps its own text while you type and follows `value` when it changes from outside, such as the back button.
- `onSearch(term)`: called 400ms after the last keystroke, on Enter, or at once when cleared. `term` is trimmed, and `''` when the text is shorter than `minLength`.
- `label`: the accessible name. Required, since the placeholder is not a label.
- `pending`: `isPending` from `useListState`; the spinner stays until results land.
- `delay`: the debounce, `SEARCH_DEBOUNCE_MS` by default. Lists keep the default; it exists for tests.
- `autoFocus` passes to the input. A list page's search never takes it: focus would skip the page's header and raise a phone's keyboard on load.
- `inputClassName` styles the input; `className` and other props go on the wrapper.
- `minLength` (2) and `maxLength` (200) match `MIN_SEARCH_LENGTH` and `MAX_SEARCH_LENGTH` in `@/lib/kit/lists/search`, which also has the field's rules as plain functions (`normalizeSearchTerm`, `isBelowSearchMinimum`, `getSearchMinimumHint`) for a search box outside a list.

Behaviour: Escape clears the text (inside a dialog, the dialog closes instead), and the clear button (a ghost `IconButton` inside the box, with a "Clear search" tooltip) returns focus to the box. The box is 40px tall, the toolbar's first-row height.

Why 400ms: most people leave 150–300ms between keystrokes, so 400ms waits out a word and sends one query per pause instead of one per letter, and with the server render on top results still land within about a second of the last keystroke. The header search (`components/search/SearchCommandDialog.tsx`) waits the same `SEARCH_DEBOUNCE_MS`.

Don't:

- Don't debounce by hand with your own delay. A search outside a list waits `SEARCH_DEBOUNCE_MS` from `@/lib/kit/lists/search`, as the header search does.
- Don't search without a minimum or a spinner, and don't make a list's search wait for a button. A lookup by exact ID may keep a submit button, but it is then not a list search.
- Don't leave a searchable list without its search box.
- Don't write a placeholder longer than about 30 characters; the box is about 290px wide on a phone and cuts it off ("Search title, artist, difficulty, mapper, or ID" is too long). The `label` carries the full name, as on the beatmap list: `label="Search beatmaps by title, artist, difficulty, mapper or ID"` with `placeholder="Title, artist, mapper or ID"`.

Gallery anchor: `/admin/design#lists-search-field`

## SortControl

A dropdown of sort keys plus a button that flips the direction. It reads and writes the same `SortState` as sortable table headers (`SortableHeader` in the tables family), so the toolbar and the table always agree.

```tsx
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';

// The tournament list's sort keys, with its own labels. A new key keeps the
// current direction, as the tournament list does.
const SORT_OPTIONS: SortOption<
  'endTime' | 'startTime' | 'submitted' | 'lobbySize'
>[] = [
  { value: 'endTime', label: 'End date' },
  { value: 'startTime', label: 'Start date' },
  { value: 'submitted', label: 'Submission date' },
  { value: 'lobbySize', label: 'Lobby size' },
];

<SortControl
  label="Sort tournaments by"
  options={SORT_OPTIONS}
  value={state.sort}
  onValueChange={(sort) => setState({ sort })}
/>;
```

Props that matter:

- `value`, `onValueChange`: `{ key, direction }`.
- `options`: `value`, `label`, and optionally `defaultDirection` (the direction a key starts in when picked; otherwise the current one is kept), `directionLabels` (words for the button's tooltip; otherwise "Ascending order" and "Descending order", as on the beatmap list) and `group` (a divider between groups, like the beatmap list's counts and attributes).
- `label`: names the dropdown ("Sort tournaments by").
- `size`: `lg` (40px, default) in a list toolbar; `sm` (32px trigger and direction button) in a SectionHeader's `actions`, where a 32px control keeps the strip 48px tall, and in a DataTable's `phoneSort` strip ([tables.md](tables.md#sorting-on-phones)).

The direction button is an outline `IconButton` at the control's size, named "Sort order is descending" (or ascending), the beatmap list's wording, with "Descending order" or the option's direction label in its tooltip.

```tsx
<SectionHeader
  icon={Trophy}
  title="Tournaments"
  actions={
    <SortControl
      size="sm"
      label="Sort tournaments by"
      options={SORT_OPTIONS}
      value={sort}
      onValueChange={setSort}
    />
  }
/>
```

Don't:

- Don't bake the direction into each option ("Date, newest first" and "Date, oldest first"); give the option `directionLabels` ("Newest first", "Oldest first") instead, as the tournament matches list does.
- Don't offer only header clicks: a list with a toolbar has a SortControl, and a table without one has `phoneSort`, because phones have no headers to click.
- Don't leave a list unsorted when its rows have an order people care about (leaderboard, reports, audit).

Gallery anchor: `/admin/design#lists-sort-control`

## RulesetChips

Labelled chips that filter a list by any number of rulesets. "All" is selected when none is, and choosing it clears the selection.

```tsx
import { RulesetChips } from '@/components/kit/lists/RulesetChips';

<RulesetChips
  value={state.ruleset}
  onValueChange={(ruleset) => setState({ ruleset })}
/>;
```

- `value`: the chosen rulesets; `[]` means all. Pair it with `arrayParam(RATED_RULESETS, { role: 'scope' })`, so "Clear all" leaves it alone.
- `rulesets`: which chips to offer, defaulting to `RATED_RULESETS` (no `mania (other)`).
- `showAll`: hide the "All" chip.
- `label`: the group's accessible name, "Filter by ruleset" by default.

Gallery anchor: `/admin/design#lists-ruleset-chips`

## RulesetSwitch

The same chips as a single choice, for pages that show one ruleset at a time: the profile, stats and the leaderboard. It is a radio group, so arrow keys move between rulesets.

```tsx
import { RulesetSwitch } from '@/components/kit/lists/RulesetSwitch';

<RulesetSwitch
  value={state.ruleset}
  onValueChange={(ruleset) => setState({ ruleset })}
/>;
```

- Pair it with `enumParam(RATED_RULESETS, { default: Ruleset.Osu, role: 'scope' })`.
- `rulesets` (the five rated ones by default) and `label` (the group's accessible name, "Ruleset" by default) work as on RulesetChips.
- Outside a toolbar, such as the stats page's rating distribution strip, its loading block is `RulesetSwitchSkeleton`; in a toolbar it is ListToolbarSkeleton's `rulesets={5} rulesetsAll={false}` ([feedback.md](feedback.md#skeletons)).

Don't (for both ruleset controls):

- Don't build another ruleset picker: bare round icons, square toggles in a popover, full-width tabs or a dropdown.
- Don't hide ruleset chips inside the filter panel on phones; they wrap.
- Don't write ruleset labels by hand (`.replace('osu!', '')`); the chips use `getRulesetLabel`.

Gallery anchor: `/admin/design#lists-ruleset-switch`

## ScopeSwitch

A segmented control, one choice of two to four: whose rows a list shows, such as All / Friends, or which view of a section is on screen, such as Rating / Volatility or Chart / Table on the profile's rating history. In a list it sits on the toolbar's second row, before the ruleset chips. It is a radio group, so arrow keys move between options; it is 32px tall, and its options take 8px side padding below `sm` (12px from it), so four options fit a 360px phone.

```tsx
import { ScopeSwitch } from '@/components/kit/lists/ScopeSwitch';

<ScopeSwitch
  label="Players to show"
  value={state.friend ? 'friends' : 'all'}
  onValueChange={(scope) => setState({ friend: scope === 'friends' })}
  options={[
    { value: 'all', label: 'All' },
    {
      value: 'friends',
      label: 'Friends',
      disabled: !hasFriends,
      disabledReason: 'Sync friends in settings to enable',
    },
  ]}
/>;
```

- An option with `disabled` and `disabledReason` gets an info button after the switch that says why, readable on tap.
- Keep the scope in the address with `booleanParam({ role: 'scope' })` or `enumParam([...], { role: 'scope' })`.

As a view toggle, put it at the top of the panel it changes, under the SectionHeader or in its `actions`, and name each group by what it picks:

```tsx
const RATING_VIEW_PARAMS = defineListParams({
  metric: enumParam(['rating', 'volatility'] as const, {
    default: 'rating',
    role: 'scope',
  }),
  view: enumParam(['chart', 'table'] as const, {
    default: 'chart',
    role: 'scope',
  }),
});

// The chart's data is all on the client: change the address without a server render.
const { state, setState } = useListState(RATING_VIEW_PARAMS, { shallow: true });

<ScopeSwitch
  label="Rating or volatility"
  value={state.metric}
  onValueChange={(metric) => setState({ metric })}
  options={[
    { value: 'rating', label: 'Rating' },
    { value: 'volatility', label: 'Volatility' },
  ]}
/>;
```

- A view that changes what the page shows lives in the address like any list control, so a reload or a shared link opens the same view. The profile's rating history keeps three there: `metric` and `view` as above, and its "Display decay" chip as `decay: booleanParam({ default: true, role: 'scope' })`, written only when off (`decay=false`). A device preference that only changes the layout, such as the beatmap list's card or table layout, stays in `localStorage` (see [useListState](#useliststate-and-list-params)).
- Use HeroTabs, not a ScopeSwitch, to switch between whole views of an entity under its hero.

Don't:

- Don't use a grey tab bar of links or hero tabs for a scope, and don't explain a disabled option in a hover-only tooltip.
- Don't give it more than four options; a longer choice is a `Select` or chips.

Gallery anchor: `/admin/design#lists-scope-switch` (with the rating history view toggles)

## ChoiceChip

One pill that toggles an option on or off (`aria-pressed`). `RulesetChips` and `ChoiceFilter` are built from it; use it alone only for a chip filter that is not a ruleset, such as a lobby size.

```tsx
import { ChoiceChip } from '@/components/kit/lists/ChoiceChip';
import { formatLobbySize } from '@/lib/kit/format/fields';

const selected = state.lobbySize.includes(4);

<ChoiceChip
  selected={selected}
  onClick={() =>
    setState({
      lobbySize: selected
        ? state.lobbySize.filter((size) => size !== 4)
        : [...state.lobbySize, 4],
    })
  }
>
  {formatLobbySize(4)}
</ChoiceChip>;
```

- A selected chip gets a blue edge, a blue tint and a blue icon; the label stays `foreground`, because primary text is under 4.5:1 on light surfaces.
- `icon`: a 16px icon before the label. An icon that sets its own `text-*` colour keeps it when selected, so a `VerificationStatusGlyph` stays green or red; ruleset and plain lucide icons turn blue.
- `choiceChipClassName` is exported for radio items that need the same look (`RulesetSwitch` uses it).
- It is 32px tall, like the kit's `sm` buttons, but it is a toggle with a selected state, not an action, so it keeps its pill look instead of the kit `Button`'s.

Don't:

- Don't colour a selected chip's label blue; the edge, tint and icon carry the selection.
- Don't use a chip as a badge or a badge as a chip: a `Badge` never acts.

Gallery anchor: `/admin/design#lists-choice-chip`

## FilterPanel and FilterButton

The one filter panel: a labelled "Filters" button with the active count, opening a panel with a header strip (title and "Clear all") and the fields in a two-column grid. Fields apply as they change; there is no Apply button.

```tsx
import { FilterPanel } from '@/components/kit/lists/FilterPanel';

<FilterPanel
  title="Filter beatmaps"
  activeCount={list.activeFilterCount}
  onClearAll={list.clearFilters}
>
  <RangeFilter label="SR" min={0} max={15} step={0.1} … />
  <RangeFilter label="CS" span="half" … />
  <RangeFilter label="AR" span="half" … />
</FilterPanel>;
```

Props that matter:

- `title`: the panel's heading, "Filter tournaments".
- `activeCount`: `activeFilterCount` from `useListState`, the number of filter-role params that are set. Ruleset, scope, search and sort are visible in the toolbar and are not counted.
- `onClearAll`: `clearFilters` from `useListState`. It resets filter-role params only.
- `open`, `onOpenChange`: to control the popover.
- `triggerLabel`: the button's text, "Filters" by default.
- `FilterPanelContent` is the inside on its own, for a filter sidebar or the gallery.
- `FilterButton` (`@/components/kit/lists/FilterButton`) is the trigger: the kit `Button`, outline at `lg` (40px, beside the search field and sort), with a funnel, "Filters" and a solid primary count badge. Its accessible name is "Filters, 2 active". It passes other button props through, so it works as a `PopoverTrigger asChild` child.
- "Clear all" in the panel's header strip is a ghost `sm` Button, disabled while nothing is active.
- Opening the panel focuses the panel itself, named by its title, so a phone does not raise its keyboard for the first number box; Tab moves into the fields, and Escape closes it and returns focus to the button.

Do:

- Keep the panel's fields to filters. Search, sort and ruleset belong in the toolbar.
- Use `span="half"` for short numeric fields that pair up (CS and AR, OD and HP).

Don't:

- Don't build another filter popover: an Apply button, Clear at the bottom, number boxes under the slider, truncated labels or native date inputs.
- Don't let "Clear all" reset search, sort, ruleset, scope or tab.
- Don't use an icon-only Filters button with a corner badge.

Gallery anchors: `/admin/design#lists-filter-button`, `/admin/design#lists-filter-panel`

## Filter fields

Each field is a `role="group"` named by its label. Labels wrap and never truncate. Every field takes `label`, `description` (one short line under the label), `info` (a longer explanation behind an info button), `span` (`full` or `half`) and `className`.

```tsx
import { DayRangeFilter } from '@/components/kit/lists/DayRangeFilter';
import {
  ChoiceFilter,
  FilterField,
  SwitchFilter,
} from '@/components/kit/lists/FilterPanel';
import { RangeFilter } from '@/components/kit/lists/RangeFilter';
import { CountryCombobox } from '@/components/kit/country/CountryCombobox';
import { tournamentRankScale } from '@/lib/filters/tournament-rank';

<RangeFilter
  label="Rank restriction"
  valueLabel="rank"
  description="Use 1 for open-rank tournaments."
  min={1}
  max={1_000_000}
  scale={tournamentRankScale}
  value={state.rank}
  onValueChange={(rank) => setState({ rank })}
/>
<ChoiceFilter
  label="Status"
  options={VERIFICATION_STATUS_ORDER.map((status) => ({
    value: status,
    label: getVerificationStatusName(status),
    icon: <VerificationStatusGlyph status={status} className="size-4" />,
  }))}
  value={state.status}
  onValueChange={(status) => setState({ status })}
/>
<DayRangeFilter label="Tournament dates" value={state.date} onValueChange={(date) => setState({ date })} />
<SwitchFilter label="Verified only" checked={state.verified} onCheckedChange={(verified) => setState({ verified })} />
<FilterField label="Country">
  <CountryCombobox value={state.country} onValueChange={(country) => setState({ country })} countries={countries} />
</FilterField>
```

- `RangeFilter`: the number boxes always sit beside the label, with a two-thumb slider under them. Boxes show the number with separators (`1,000`), accept `1000` or `1,000`, and commit on Enter or blur; Escape reverts a box without closing the panel. A typed number stays exactly what was typed, held inside `min` and `max` and on its side of the other bound (`1,234` stays 1,234 on a slider that stops every 20); only dragging a thumb snaps to the track's stops. The slider commits on release, so a drag is one navigation. A thumb at the end of the track, or an empty box ("Any"), means no limit. `min`, `max` and `integer` must match the page's `rangeParam`: with `integer` a typed fraction rounds to a whole number, because the address would drop it; it defaults to whether the track's stops are all whole numbers (`isWholeNumberScale` in `@/lib/kit/lists/range`, which also holds the boxes' rules as plain functions with tests: `parseRangeBox` reads `1,000` or `1000`, `resolveTypedBound` keeps a typed bound in range). `scale` takes a non-linear track (`tieredScale` from `@/lib/filters/scale`, `tournamentRankScale`); `format` is how screen readers hear a value (a duration, say); `valueLabel` is the noun in "Minimum rank".
- `ChoiceFilter`: chips that each switch one option on or off; nothing selected means no filter. Pair with `arrayParam`, or with `flagsParam` for a bitflag enum such as mods.
- `DayRangeFilter`: "From" and "Through" calendars, both ends inclusive, as `YYYY-MM-DD` UTC days. `min` and `max` limit the days that can be picked, as on DateField. Pair with `dayRangeParam`.
- `SwitchFilter`: an on/off filter. Pair with `booleanParam`.
- `FilterField`: the same label, description and info layout around any other control, such as the leaderboard's `CountryCombobox` ([format.md](format.md#countrycombobox)). `aside` sits at the end of the label row, as RangeFilter's number boxes do.

Don't:

- Don't put a dropdown of checkboxes inside the panel for a handful of options; use `ChoiceFilter`. Keep dropdowns for long lists such as countries.
- Don't label with legacy names ("Team size", "Rank range", "Win rate %"); use the glossary in `@/lib/kit/format/fields`.

Gallery anchor: `/admin/design#lists-filter-panel`

## DateField and Calendar

A UTC day picked from a month calendar, replacing `<input type="date">`, which looks different in every browser and follows the visitor's locale.

```tsx
import { Calendar, DateField } from '@/components/kit/lists/DateField';

<DateField label="From" value={day} onValueChange={setDay} />;
```

- `value`: `YYYY-MM-DD` or `undefined`. The button shows `Jul 20, 2024` (the format family's `formatDate`) or the placeholder ("Any date").
- `min`, `max`: the days that can be picked; the year list runs from 2007 (or `min`) to next year.
- `highlight`: tints the days between two ends, to show a range.
- The calendar opens on the selected day, or today in UTC. Arrow keys move by day and week, Page Up and Page Down by month (with Shift, by year), Home and End to the ends of the week. Month and year dropdowns jump further. "Clear" (a ghost `sm` Button) empties the field.
- The field is an outline `sm` Button (32px, the height of the filter panel's number boxes); the month arrows are `IconButton`s with "Previous month" and "Next month" tooltips. The day cells are grid cells with their own roving focus, not Buttons.
- `Calendar` is the grid on its own.
- The day maths (UTC `YYYY-MM-DD` days, month grids, `todayIsoDay`, `formatLongDay` for a day cell's name) lives in `@/lib/kit/lists/calendar`, with tests.

Gallery anchor: `/admin/design#lists-date-field`

## ActiveFilterChips

The row under the toolbar that names each active filter as a chip you can remove, with "Clear all" at the end. It shows the panel's filters only, and renders nothing when none is active.

```tsx
import { ActiveFilterChips } from '@/components/kit/lists/ActiveFilterChips';
import {
  formatChoiceFilterLabel,
  formatDayRangeFilterLabel,
  formatRangeFilterLabel,
} from '@/lib/kit/lists/filters';

<ActiveFilterChips
  onClearAll={list.clearFilters}
  filters={[
    {
      key: 'sr',
      label: formatRangeFilterLabel('SR', state.sr),
      onRemove: () => setState({ sr: {} }),
    },
    {
      key: 'status',
      label: formatChoiceFilterLabel(
        'Status',
        state.status.map(getVerificationStatusName)
      ),
      onRemove: () => setState({ status: [] }),
    },
    {
      key: 'date',
      label: formatDayRangeFilterLabel('Dates', state.date),
      onRemove: () => setState({ date: {} }),
    },
  ]}
/>;
```

- A filter whose `label` is empty is left out, so pass every filter and let the helpers return `''` for inactive ones.
- Label helpers: `formatRangeFilterLabel` (`SR: 5 – 7`, `Rank restriction: at least 1,000`, `BPM: at most 180`), `formatChoiceFilterLabel` (`Status: Pending, Verified +1`), `formatDayRangeFilterLabel` (`Dates: Jul 20 – Aug 3, 2024`, `Dates: from Jul 20, 2024`). `formatFilterNumber` is the number style they share (separators, up to two decimals: `1,000`, `5.25`), for a RangeFilter's `format` that adds a unit, as the leaderboard's win rate does (`55.5%`).
- Each chip is named "Remove SR: 5 – 7 filter", as the beatmap list's chips are. Long labels wrap inside the chip.
- Chips are at least 32px tall, the height of the ghost `sm` "Clear all" Button after them and of the ruleset chips above.

Don't:

- Don't truncate chip labels, write `SR: 5 – Any`, or show raw dates (`2024-07-20`).

Gallery anchor: `/admin/design#lists-active-filter-chips`

## useListState and list params

The list's state, read from and written to the page address. One spec drives the server page, the client hook, pagination links and "See all" links.

```ts
import {
  clearListFilters,
  countActiveFilters,
  getDefaultListState,
  listStateHref,
  parseListState,
  serializeListState,
} from '@/lib/kit/lists/params';
import { useListState } from '@/lib/kit/lists/use-list-state';
```

Param builders. Each takes an optional `role` and `key` (the URL key, when it differs from the param's name, so old links keep working). `rangeParam` and `dayRangeParam` take `keys`, a `[min, max]` or `[from, to]` pair, as the tournament list's `keys: ['minRankRange', 'maxRankRange']`; `sortParam` takes `key`, `directionKey` and `legacyDescendingKey` and is always `sort`; `pageParam` is always `page`.

| Builder                              | Value                            | Address                                         | Default role |
| ------------------------------------ | -------------------------------- | ----------------------------------------------- | ------------ |
| `searchParam({ minLength })`         | `string`, trimmed                | `q=world+cup`                                   | `search`     |
| `pageParam()`                        | `number`, from 1                 | `page=3`                                        | `page`       |
| `sortParam(keys, default)`           | `SortState`                      | `sort=name&dir=asc`                             | `sort`       |
| `enumParam(options, { default })`    | one option, or `undefined`       | `ruleset=1`                                     | `filter`     |
| `arrayParam(options)`                | options in their fixed order     | `status=0&status=4`                             | `filter`     |
| `arrayParam(options, { allValue })`  | the same, or `undefined`         | `ruleset=all` for `[]`, nothing for `undefined` | `filter`     |
| `flagsParam(flags)`                  | the set flags, in `flags` order  | `mods=24` (one bitmask)                         | `filter`     |
| `booleanParam({ default })`          | `boolean`                        | `verified=true`                                 | `filter`     |
| `numberParam({ min, max, integer })` | `number \| undefined`            | `report=42`                                     | `filter`     |
| `rangeParam({ min, max, integer })`  | `{ min?, max? }`                 | `minSr=5&maxSr=7` for a param named `sr`        | `filter`     |
| `dayRangeParam()`                    | `{ from?, to? }` as `YYYY-MM-DD` | `dateFrom=2024-07-20` for `date`                | `filter`     |

Roles decide how the list treats a param:

- `filter`: counted on the Filters button, shown as an active-filter chip, reset by "Clear all".
- `scope`: a visible switch (ruleset chips, All / Friends, a tab). "Clear all" leaves it alone.
- `search`, `sort`: never cleared with filters.
- `page`: back to page 1 whenever anything else changes (`applyListPatch`).

What the codecs guarantee, and the tests check:

- Defaults are never written, so a fresh list has a bare address; a sort writes only the half that differs (`dir=asc` alone).
- Invalid values read as the default instead of throwing: unknown options, out-of-range numbers, `1e3` or `0x10`, `2024-02-30`, a page of 0.
- Arrays repeat the key, drop duplicates and unknown values, and keep the options' order, so one state has one address.
- With `allValue`, an array has three states: absent reads as `undefined` (the page's own default), `allValue` reads as `[]` (every option), and values win over `allValue`. `[]` writes `allValue` and `undefined` writes nothing. Unknown values alone read as absent.
- Ranges drop bounds outside the domain, treat a bound at the domain's edge as no limit, and swap reversed bounds; day ranges do the same.
- `serializeListState` keeps params the spec does not own (`tab`, tracking params) ahead of its own, and output order follows the spec.
- `defineListParams` throws when two params claim one URL key.
- `sortParam(…, { legacyDescendingKey: 'descending' })` still reads old `descending=true|false` links, and never writes them.
- `flagsParam` holds a bitflag enum (mods, warning flags) as a list of flags, the shape `ChoiceFilter` takes, and writes one bitmask, the number the API takes: `mods=24` for Hidden and Hard Rock. Reading keeps each listed flag whose bits are all set and drops zero, unknown bits, fractions and negatives; an empty list writes nothing. `maskToFlags(mask, flags)` and `flagsToMask(values)` convert at the API's edge. Flags must fit in 31 bits (every osu! mod does).

```ts
const BEATMAP_PARAMS = defineListParams({
  mods: flagsParam([Mods.Hidden, Mods.HardRock, Mods.DoubleTime, Mods.Flashlight]),
});

<ChoiceFilter
  label="Mods"
  options={MOD_OPTIONS}
  value={state.mods} // Mods[]
  onValueChange={(mods) => setState({ mods })}
/>;
// API input: flagsToMask(state.mods)
```

`useListState(params, options)` returns:

- `state`: the address, plus any change still navigating (React's `useOptimistic`), so controls update at once.
- `setState(patch, { history })`: merges and navigates without scrolling; `history: 'replace'` overwrites the current entry instead of adding one. `undefined` in a patch resets that param to its default. `patch` may also be a function of the current state, `(current) => patch`, for a change that depends on it, such as toggling one chip in a list.
- `clearFilters()`, `activeFilterCount`, `isPending` (pass it to `SearchField`), and `hrefFor(patch)` for links within this list, such as pagination.

`options.shallow`: for a list or view whose data is all on the client already (fetched once, or passed down whole), such as the profile's rating history toggles or a table sorted with `sortRows`. Changes write the address with `history.pushState` (or `replaceState` with `history: 'replace'`), which Next.js follows into `useSearchParams`, and the server renders nothing: the change shows at once and nothing refetches. Back, forward, a reload and a shared link still show the same state. When the address changes under it (back and forward, a link, `router.push`), the state follows; when one of its own changes lands after a newer one, the newer stays. `isPending` is always false. A shallow list changes state through `setState`, so wire its controls with callbacks (`onSortChange`, `onPageChange`); a link from `hrefFor` still works but renders on the server like any navigation. The helpers behind it (`writeShallowAddress`, `shallowSearchKey`, `landShallowAddress`, `syncShallowState`) live in `@/lib/kit/lists/shallow`, with tests.

Leave `shallow` off for a list the server filters, sorts or pages: its page must render again for the new state.

A link that opens another list already filtered, such as the header search's "See all", builds the address from that list's spec, so it stays valid when the list's params change:

```ts
listStateHref('/tournaments', TOURNAMENT_LIST_PARAMS, {
  ...getDefaultListState(TOURNAMENT_LIST_PARAMS),
  q: term,
});
// '/tournaments?q=world+cup'
```

Do:

- Keep every list control in the spec, including the ones on lists the client holds whole: the audit filters, the admin report status, a tournament's match sort, the stats page's ruleset and the filter report's ID all survive a reload.
- Keep a device preference, such as the beatmap list's card or table layout, in `localStorage`, not the address.
- Use `formatCountOf` for the toolbar's result count.

Don't:

- Don't hand-roll URL building or parsing; read with `parseListState` and write with `hrefFor` or `listStateHref`.
- Don't keep list state in `useState`; a list the client holds whole uses `{ shallow: true }`.
- Don't create the spec inside a component; it must be a stable module-level value.

Other exports of `@/lib/kit/lists/params`, for tests and edge cases: `applyListPatch` (what `setState` does to a state), `listStatesEqual`, `rangesEqual` and `dayRangesEqual`, `isFilterActive`, `normalizeRange` and `normalizeDayRange` (the codecs' clean-up on its own), `isIsoDay`, and `toSearchParams` (any `searchParams` shape to `URLSearchParams`).

Gallery anchors: `/admin/design#lists-list-state` (the codecs and `flagsParam`), `/admin/design#lists-scope-switch` (a shallow list state; try the back button)

## Sort state

`@/lib/kit/lists/sort` holds the one sort shape, shared by `SortControl`, `sortParam` and sortable table headers.

```ts
import {
  type SortState,
  fromDescending,
  getAriaSort,
  toDescending,
  toggleSort,
} from '@/lib/kit/lists/sort';

const sort: SortState<'rating' | 'name'> = { key: 'rating', direction: 'desc' };
toggleSort(sort, 'rating'); // { key: 'rating', direction: 'asc' }
toggleSort(sort, 'name', 'asc'); // { key: 'name', direction: 'asc' }
toDescending(sort); // { sort: 'rating', descending: true }, for the API
getAriaSort(sort, 'rating'); // 'descending'
```

- Keys can be strings or numeric enum members (`TournamentQuerySortType`).
- `SORT_DIRECTION_LABELS`, `DEFAULT_SORT_DIRECTION` (`desc`), `flipSortDirection`, `isSortDirection` and `sortStatesEqual` cover the rest.

Gallery anchor: `/admin/design#lists-sort-control`
