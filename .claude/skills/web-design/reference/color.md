# Colour and charts

The colour tokens the library adds, the domain palettes (mods, tiers, grades, star rating, verification, teams), and the shared chart parts: one tick rule, axis formatters, Recharts axis props, one tooltip and one legend.
Tokens live in `apps/web/app/globals.css`; every value is mirrored, with its light and dark hex, in `@/lib/kit/color/` and unit-tested for contrast. Chart helpers are in `@/lib/kit/charts/`, chart components in `@/components/kit/charts/`.

- [Rules at a glance](#rules-at-a-glance)
- [Theme tokens](#theme-tokens): every token, its class, light and dark values
- [Theme text](#theme-text): text, muted text, red text, and muted text in tooltips
- [Brand blue](#brand-blue): `primary`, `primary-solid` and `link`
- [Accent rule](#accent-rule): what blue is for
- [Categorical palette](#categorical-palette): `CATEGORICAL_PALETTE`, `seriesColor`
- [Verification colours](#verification-colours): `getStatusHueColor`, `getRatingsGroupColor`
- [Callout tones](#callout-tones): `bg-callout-*`, `CALLOUT_COLORS`
- [Match teams and surfaces](#match-teams-and-surfaces): `MATCH_TEAM_COLORS`, `bg-game-frame`, `bg-score-card`
- [Tier colours](#tier-colours): `TIER_PALETTE`, `TIER_TEXT_CLASS`
- [Grade colours](#grade-colours): `GRADE_PALETTE`, `getGradeColor`
- [Mod colours](#mod-colours): `MOD_PALETTE`, `getModPaletteColor`
- [Mod badges](#mod-badges): `ModIconset`, `MOD_TYPE_COLORS`
- [Star rating colours](#star-rating-colours): `getStarRatingMarkColor`
- [Contrast helpers](#contrast-helpers): `contrastRatio`, `colorDistance`
- [Tick rule](#tick-rule): `getNiceTicks`, `getCategoryTicks`, `getTimeTicks`
- [Axis formatters](#axis-formatters): `formatCountTick`, `formatYearTick` and friends
- [Recharts axis props](#recharts-axis-props): `chartAxisProps`, `chartValueAxisProps`, `niceAxisProps`, and the row bar parts
- [CountBarChart](#countbarchart): a count per category, in columns or rows
- [StackedBarChart](#stackedbarchart): several series stacked per category, as counts or shares
- [ChartTooltipContent](#charttooltipcontent): the one chart tooltip
- [ChartLegend and SeriesMarker](#chartlegend-and-seriesmarker): the key for two or more series
- [Chart card](#chart-card): Panel, SectionHeader and a chart

## Rules at a glance

- Text is coloured only with semantic tokens: `text-foreground`, `text-muted-foreground`, the `*-foreground` status tokens, `text-callout-*-foreground`, `text-match-*-foreground` and `text-tier-*`. Never a palette class such as `text-orange-500`, never a hex value in a component.
- A domain palette (mods, tiers, grades, star rating, verification, teams) is reached through its helper in `@/lib/kit/color/`, which returns `var(--…)`. Never copy a palette value into a component.
- Marks and icons clear 3:1 against the card, text 4.5:1, in both themes. The tests in `apps/web/lib/kit/color/__tests__/` enforce it for every token; a new token goes into `globals.css` and the matching module together, or the tests fail.
- Colour never carries meaning alone: a status has its glyph, a series has its legend or label, a mod has its name.
- Neutral series take the categorical palette in order. Status colours only ever mean status.
- Every chart sits in a Panel with a SectionHeader, inside `ChartContainer`, with the shared tick rule, axis props, formatters and `ChartTooltipContent`.

## Theme tokens

Every token below has a light value in `:root` and a dark value in `.dark`; the modules named in the table hold the per-entry values. "Mark" means 3:1 against the card, "text" 4.5:1. The class column is the Tailwind colour name (`bg-…`, `text-…`, `border-…`, `fill-…`); tokens without a class are used through their helper.

| Token                                  | Class                        | Light       | Dark        | Use                                      |
| -------------------------------------- | ---------------------------- | ----------- | ----------- | ---------------------------------------- |
| `--foreground`                         | `foreground`                 | `#000000`   | `#ffffff`   | Text                                     |
| `--muted-foreground`                   | `muted-foreground`           | `#6c6c6c`   | `#9b9b9b`   | Muted text: labels, captions, headers    |
| `--accent-muted-foreground`            | `accent-muted-foreground`    | `#636363`   | `#aeaeae`   | Muted text on `bg-accent` (tooltips)     |
| `--destructive-foreground`             | `destructive-foreground`     | red-800     | red-400     | Red text                                 |
| `--series-1` … `--series-8`            | `series-1` … `series-8`      | below       | below       | Categorical chart marks                  |
| `--series-other`                       | `series-other`               | `#7a7a7a`   | `#929292`   | The "Other" series or bucket             |
| `--verification-verified`              | `verification-verified`      | `#25984d`   | `#47c86e`   | Verified icon and chart fill             |
| `--verification-neutral`               | `verification-neutral`       | `#7a7a7a`   | `#929292`   | Pending icon, "Not in ratings yet" fill  |
| `--verification-rejected`              | `verification-rejected`      | `#d73431`   | `#f66d67`   | Rejected icon and chart fill             |
| `--callout-info`                       | `callout-info`               | `#f0f6fc`   | `#1b2026`   | Info callout fill                        |
| `--callout-info-border`                | `callout-info-border`        | `#c9daeb`   | `#344458`   | Info callout border                      |
| `--callout-info-foreground`            | `callout-info-foreground`    | `#314968`   | `#bcd3f2`   | Info callout text and icon               |
| `--callout-warning`                    | `callout-warning`            | `#fff6e1`   | `#2b1f0d`   | Warning callout fill                     |
| `--callout-warning-border`             | `callout-warning-border`     | `#ebc573`   | `#724d0b`   | Warning callout border                   |
| `--callout-warning-foreground`         | `callout-warning-foreground` | `#864900`   | `#f8cf68`   | Warning callout text and icon            |
| `--callout-danger`                     | `callout-danger`             | `#fff1f1`   | `#301717`   | Danger callout fill                      |
| `--callout-danger-border`              | `callout-danger-border`      | `#f9bcb9`   | `#893130`   | Danger callout border                    |
| `--callout-danger-foreground`          | `callout-danger-foreground`  | `#b7191c`   | `#ff9e9b`   | Danger callout text and icon             |
| `--match-red`                          | `match-red`                  | `#e34948`   | `#e66767`   | Red team edge, tint, swatch, chart line  |
| `--match-red-foreground`               | `match-red-foreground`       | `#cc3135`   | `#f17070`   | Red team text                            |
| `--match-blue`                         | `match-blue`                 | `#4589f2`   | `#4e93fc`   | Blue team edge, tint, swatch, chart line |
| `--match-blue-foreground`              | `match-blue-foreground`      | `#276bd1`   | `#579dff`   | Blue team text                           |
| `--match-no-team`                      | `match-no-team`              | `#747474`   | `#9e9e9e`   | Scores with no team                      |
| `--game-frame`                         | `game-frame`                 | `#f4f4f4`   | `#141414`   | Recessed frame around a game's scores    |
| `--score-card`                         | `score-card`                 | `#ffffff`   | `#242424`   | Score card inside the game frame         |
| `--notification`                       | `notification`               | `#4589f2`   | `#4e93fc`   | The one notification dot                 |
| `--support`                            | `support`                    | `#f6339a`   | `#f6339a`   | The header's support heart on hover      |
| `--tier-<tier>`                        | `tier-<tier>`                | `tiers.ts`  | `tiers.ts`  | Tier names (text) and tier chart marks   |
| `--score-grade-ss` … `--score-grade-d` | none                         | `grades.ts` | `grades.ts` | Grade chart marks                        |
| `--mod-nm` … `--mod-key`               | none                         | `mods.ts`   | `mods.ts`   | Mod marks and solid mod pills            |

The brand blue (`primary`, `primary-solid`, `link`) has its own table under [Brand blue](#brand-blue). The shadcn base tokens (`background`, `card`, `popover`, `muted`, `accent`, `secondary`, `border`, `input`, `ring`, `success`, `warning`, `destructive`, `destructive-solid`) keep their values. The four text tokens at the top of the table are mirrored in `@/lib/kit/color/tokens` and tested like the library's own (see [Theme text](#theme-text)). There are no other palettes: the old long mod names, `--text-<tier>`, `--grade-*`, `--rank-range-*`, `--team-*`, `--color-status-*` and `--chart-*` are gone, so a colour that is not in this table or the brand blue's is not a token.

A light subtree inside a dark page (`.theme-light`, the gallery only) gets the light values of every token above, and of `success` and `warning`.

Gallery anchor: `/admin/design#color`

## Theme text

Three text colours, each 4.5:1 or better on panels, tiles and popovers in both themes, plus one for muted text on the tooltip surface. Use their classes; the values live in `globals.css` and are mirrored in `@/lib/kit/color/tokens` (`FOREGROUND_COLOR`, `MUTED_TEXT_COLOR`, `DESTRUCTIVE_TEXT_COLOR`, `ACCENT_MUTED_TEXT_COLOR`).

| Text            | Class                         | Light                                | Dark                     | Hardest surface             |
| --------------- | ----------------------------- | ------------------------------------ | ------------------------ | --------------------------- |
| Text            | `text-foreground`             | black                                | white                    | every surface, 11:1 or more |
| Muted text      | `text-muted-foreground`       | `oklch(0.53 0 0)`, 4.7:1 on popovers | `oklch(0.69 0 0)`, 5.9:1 | muted and popover           |
| Red text        | `text-destructive-foreground` | red-800, 7.4:1                       | red-400, 5.6:1           | muted and popover           |
| Muted (tooltip) | applied by the tooltip        | `oklch(0.5 0 0)`, 4.7:1 on accent    | `oklch(0.75 0 0)`, 5.1:1 | accent                      |

Tooltips (the shadcn `TooltipContent` and TapTooltip's popover) sit on `bg-accent`, where plain muted text is under 4.5:1 in both themes. Both apply `ACCENT_SURFACE_CLASSES` from `@/lib/kit/color/tokens`: the accent fill, its text colour, and `--muted-foreground` rescoped to `--accent-muted-foreground`. So `text-muted-foreground` inside a tooltip is legible with no extra class.

Do:

- Use `text-muted-foreground` for secondary lines inside tooltips; the surface takes care of it.
- Spread `ACCENT_SURFACE_CLASSES` onto any new surface drawn in the tooltip's grey (a pinned tooltip, a static tooltip preview).

Don't:

- Don't put red text on `bg-accent`: red-400 is 3.9:1 there in dark mode. Keep red in tooltips to the icon, or use a popover surface.
- Don't put `text-muted-foreground` on a hand-made `bg-accent` box without `ACCENT_SURFACE_CLASSES`.

Gallery anchor: `/admin/design#color-text`

## Brand blue

Three tokens carry the brand blue, because one blue can't be both a fill behind white text and readable text in both themes.

| Token             | Class                                 | Light     | Dark                     | Use for                                              |
| ----------------- | ------------------------------------- | --------- | ------------------------ | ---------------------------------------------------- |
| `--primary`       | `text-primary`, `border-primary`, ... | `#3a71e2` | `#4e93fc` (the original) | Icons, borders, the focus ring, selected tints       |
| `--primary-solid` | `bg-primary-solid`                    | `#3a71e2` | `#3a71e2`                | Fills behind white text: buttons, solid badges, days |
| `--link`          | `text-link`                           | `#356ad4` | `#4e93fc` (the original) | Blue text: links on hover, row titles on hover       |

- White text on `primary-solid` measures 4.5:1 in both themes. In light mode `#3a71e2` is the passing blue closest to the original `#4e93fc`, which only reached 3:1 with white text.
- `link` reaches 4.5:1 on the background, cards and grey panels in both themes. Light mode needs it a step darker than `primary` for that; dark mode keeps the original blue.
- `primary` is a mark colour: 3:1 or better on every surface, in both themes.
- The values are mirrored in `@/lib/kit/color/tokens` as `PRIMARY_COLOR`, `PRIMARY_SOLID_COLOR` and `LINK_COLOR` (with `NOTIFICATION_COLOR` for the dot), and tested with the other tokens (`TOKEN_GROUPS`, flattened as `ALL_TOKENS`).

Do:

- Put white text (`text-primary-foreground`) only on `bg-primary-solid`. The shadcn and kit buttons and the solid badge already do.
- Colour blue text with `text-link`, including hover states on names and row titles.

Don't:

- Don't put white text on `bg-primary`: in dark mode it is the original blue, 3:1 with white.
- Don't colour text `text-primary`; it is under 4.5:1 on light cards. `primary` is for icons, borders, rings and selected tints; blue text is `text-link`.

Gallery anchor: `/admin/design#color-accent-rule` (with the three brand tokens)

## Accent rule

Blue (`primary`) means "you can act on this" or "this is selected". Nothing decorative is blue.

- Blue: primary buttons, a selected chip, tab or toggle, the focus ring, links on hover (`hover:text-link`, or `hover:underline` on dense rows), and the notification dot.
- Not blue: section and page icons (`text-muted-foreground`), names at rest (they are `text-foreground` links that turn blue on hover), headings, trophies and other decorative icons, and info callouts (they use the slate `callout-info` tone).
- One notification dot colour: `bg-notification`, through `NotificationDot` from `@/components/kit/status/NotificationDot`.
- Blue that is not interactive is data, never decoration: a single chart series (`--series-1`, the brand blue stepped to clear 3:1 on light cards), the blue team (`match-blue`) and the notification dot. Of these only the blue team's score is ever text.

Do:

- Use `text-muted-foreground` on every SectionHeader and PageHeader icon.
- Make a name a link with `transition-colors hover:text-link` and the standard focus ring.

Don't:

- Don't colour section or page icons `text-primary`.
- Don't colour every name in a sentence as a link; only real links turn blue, and only on hover (EntityLink's `inline` variant, as the audit log uses).
- Don't use a second dot colour; every "something new" dot is `NotificationDot`.
- Don't use blue for an info notice; the info callout is slate.

Gallery anchor: `/admin/design#color-accent-rule`

## Categorical palette

Eight hues in a fixed order for neutral series: rank restriction buckets, teams (red and blue), rulesets, teammates and opponents, any "series 1, 2, 3". The order keeps neighbours apart for protanopia and deuteranopia (Machado 2009 simulation, adjacent OKLab ΔE ≥ 8) and for full colour vision (ΔE ≥ 15), in both themes; the tests check it.

```tsx
import {
  CATEGORICAL_PALETTE,
  CATEGORICAL_OTHER,
  seriesColor,
} from '@/lib/kit/color/categorical';

<Bar dataKey="osu" fill={seriesColor(0)} />;
```

| Slot | Name    | Light     | Dark      |
| ---- | ------- | --------- | --------- |
| 1    | Blue    | `#4589f2` | `#4e93fc` |
| 2    | Orange  | `#e6632f` | `#d95926` |
| 3    | Aqua    | `#049e6d` | `#199e70` |
| 4    | Yellow  | `#bd7f03` | `#c98500` |
| 5    | Magenta | `#d36992` | `#d55181` |
| 6    | Green   | `#008300` | `#008300` |
| 7    | Violet  | `#4a3aa7` | `#9085e9` |
| 8    | Red     | `#e34948` | `#e66767` |

- `seriesColor(index)`: `var(--series-N)` for a 0-based index; past the eighth slot it returns the "Other" grey, never a repeat.
- `CATEGORICAL_PALETTE`: the slots, each a `ThemeColor` (`token`, `css`, `light`, `dark` and its contrast `role`, from `@/lib/kit/color/theme-color`) with its `slot` and `name`. `CATEGORICAL_OTHER` is the grey for an "Other" bucket.
- Assign by a stable index (the series' place in a fixed list), not by rank, so a filter that removes a series never repaints the others.
- A single series is slot 1 and needs no legend. Two or more get a `ChartLegend`.
- In scatter plots and small multiples any two colours can touch, so use at most three slots there and fold the rest into "Other".
- Rank restriction buckets keep their symbol and dash pattern from `lib/beatmaps/rankRange.ts` as the second channel.

Do:

- Rank restriction buckets take slots 1 to 5 in bucket order (Open, <1k, 1k+, 10k+, 100k+).
- Teammates and opponents take slots 1 and 2.

Don't:

- Don't give neutral data a judgement colour, such as red for opponents; teammates and opponents are `seriesColor(0)` and `seriesColor(1)`, as the profile's teammates and opponents charts have them.
- Don't invent series colours (a hex such as `#3b82f6`, or a token of your own for one chart).
- Don't reuse a status colour for a series, or a series colour for a status.

Gallery anchor: `/admin/design#color-categorical-palette`

## Verification colours

Green, neutral and red for status icons and chart fills, keyed by the status hue from `@/lib/kit/status/verification` (see the status reference). Icons keep the outcome hue (Pre-verified green, Pre-rejected red); charts group Pending, Pre-verified and Pre-rejected into one neutral "Not in ratings yet" bar.

```tsx
import { RATINGS_GROUPS } from '@/lib/kit/status/verification';
import {
  getRatingsGroupColor,
  getStatusHueColor,
  getVerificationStatusColor,
} from '@/lib/kit/color/verification';

{
  RATINGS_GROUPS.map((group) => (
    <Cell key={group.key} fill={getStatusHueColor(group.hue)} />
  ));
}
```

- `getStatusHueColor(hue)`: `success`, `neutral` or `destructive` to its `var(--verification-…)`.
- `getRatingsGroupColor(status)`: the chart fill for a status (neutral for the three undecided states).
- `getVerificationStatusColor(status)`: the icon colour for a status. `VerificationStatusIcon` already uses the `text-verification-*` classes; reach for this only in SVG or chart code.
- `VERIFICATION_COLORS`: the three `ThemeColor` entries.

Don't:

- Don't give the undecided states a yellow "awaiting" colour or Pending a bar of its own; the stats page's verification chart shows the three groups (`RATINGS_GROUPS`, each bar filled with `getStatusHueColor(group.hue)`).
- Don't use `success`/`destructive` fills or `green-400`/`yellow-400` for verification in charts.

Gallery anchor: `/admin/design#color-verification`

## Callout tones

Fill, border and text-plus-icon for the info, warning and danger callouts. The callout component (feedback family) uses them; use the tokens directly only when building a new tone-carrying surface.

```tsx
<div className="rounded-lg border border-callout-warning-border bg-callout-warning px-3 py-2 text-sm text-callout-warning-foreground">
  …
</div>
```

- `CALLOUT_COLORS[tone]` in `@/lib/kit/color/tokens` has `fill`, `border` and `foreground` for `info`, `warning` and `danger`.
- The foreground clears 4.5:1 on its fill, and so do `text-foreground` and `text-muted-foreground`, so a link or muted line inside a callout stays legible.
- Info is a quiet slate, not the link blue.

Don't:

- Don't build notices from palette classes (`border-orange-500/50 bg-orange-500/15`, `bg-blue-50/50`, `bg-amber-50/30`); use the Callout or these tokens.

Gallery anchor: `/admin/design#color-callout-tones`

## Match teams and surfaces

One red and blue pair for match teams everywhere (the categorical red and blue), a text step of each for team-coloured numbers and the result line, a theme-aware grey for scores with no team, and the two match page surfaces: a recessed game frame with lighter score cards, each card tinted with its team.

```tsx
import { Team } from '@otr/core/osu';
import {
  MATCH_TEAM_COLORS,
  getTeamColor,
  getTeamTextColor,
  getTeamTintClass,
} from '@/lib/kit/color/teams';

<div className="rounded-xl border bg-game-frame p-3">
  <div className="relative flex overflow-clip rounded-lg border bg-score-card">
    <span className={cn('absolute inset-0', getTeamTintClass(score.team))} aria-hidden />
    <span className="relative w-1.5 opacity-70" style={{ backgroundColor: getTeamColor(score.team) }} aria-hidden />
    …
    <span style={{ color: getTeamTextColor(score.team) }}>{formatCount(score.score)}</span>
  </div>
</div>
<p className="text-match-red-foreground">Team Red wins by 34,509</p>
```

- `getTeamColor(team)`: the mark colour (`--match-red`, `--match-blue`, `--match-no-team`) for the edge, swatches and chart lines.
- `getTeamTextColor(team)`: the text step; `var(--foreground)` for no team.
- `getTeamTintClass(team)` / `MATCH_TEAM_TINT_CLASS`: the card tint, `bg-match-red/6` and so on. `MATCH_TEAM_TINT` (6%) is the strength the tests check.
- Classes: `bg-match-red`, `text-match-red-foreground`, `bg-game-frame`, `bg-score-card`. `MATCH_SURFACES` holds the two surfaces' values for tests.
- Foreground, muted and team text clear 4.5:1 on the game frame, the score card and the tinted score card, in both themes.

Do:

- Keep the score card's team tint, coloured edge and result line (owner decision, 15 Oct), as the match page's score cards have them.
- Use the standard `border` on both surfaces.

Don't:

- Don't hard-code the surfaces (`bg-white dark:bg-neutral-800`, `border-neutral-300`, `bg-secondary`); use `bg-game-frame` and `bg-score-card`.
- Don't tint more than `MATCH_TEAM_TINT` (6%): at 10% muted text on the light card drops under 4.5:1.
- Don't use other reds and blues for the same teams (`bg-red-500/10 text-red-600`, `text-red-600 dark:text-red-400`); every team mark and text comes from these helpers.
- Don't use a fixed grey such as `#333` for no team; `--match-no-team` follows the theme.

Gallery anchor: `/admin/design#color-match`

## Tier colours

Tier names as text, stepped per theme to clear 4.5:1 (light gold and emerald were 1.9:1). The same colours mark tier rows in charts.

```tsx
import { TIER_PALETTE, TIER_TEXT_CLASS, getTierColor } from '@/lib/kit/color/tiers';
import { formatTierName } from '@/lib/kit/format/tier';

<span className={TIER_TEXT_CLASS[tier]}>{formatTierName(tier, subTier)}</span>
<BoxPlotTrack color={getTierColor(tier)} … />
```

- `TIER_TEXT_CLASS[tier]`: the `text-tier-…` class, spelled out so Tailwind finds it.
- `getTierColor(tier)` / `TIER_PALETTE[tier].css`: the colour for a fill or SVG. This is not the `getTierColor` in `lib/utils/tierData.ts`, which returns the tier ladder's glow classes (`gradient`); alias one of them when a file needs both.
- The tier ladder's glows are decoration and stay in `lib/utils/tierData.ts`.
- Diamond and Master are hard to tell apart as neighbouring marks, such as touching bars in the rating distribution: OKLab ΔE 5.8 in light and 5.4 in dark (3.6 to 5.4 for protan and deutan readers), against the 15 (and 8) the categorical palette keeps between neighbours. Both are violets of the same lightness 14° apart. Until the owner settles new values, a chart that colours by tier also names the tier in its legend and tooltip, as the rating distribution does.
- The tiers use every categorical hue (dark Elite Grandmaster is slot 1's blue), so a line over tier-coloured bars takes the text colour, `var(--foreground)`, as the rating distribution's cumulative line does; a dashed rule in the same colour (its "You" mark) is told apart by its dash and its label.

Don't:

- Don't keep a page's own tier colour table or text classes; tier names and marks both come from this module, as in the beatmap tier breakdown and the rating distribution.

Gallery anchor: `/admin/design#color-tiers`

## Grade colours

Marks for grade charts and swatches. SS, S and A keep the osu! badge hues (stepped darker on light cards); B to D are a grey ramp that recedes toward the card in both themes.

```tsx
import { GRADE_PALETTE, getGradeColor } from '@/lib/kit/color/grades';

<Bar fill={getGradeColor(ScoreGrade.A)} />;
```

- `getGradeColor(scoreGrade)`: folds SSH into SS and SH into S, as the badges do.
- `GRADE_PALETTE[key]`: `SS`, `S`, `A`, `B`, `C`, `D`.

Don't:

- Don't use osu!'s badge colours as they are: on a light card its S and A measure 2.4:1 and 1.6:1. `getGradeColor` has the stepped ones; `getGradeKey(scoreGrade)` gives the palette key.

Gallery anchor: `/admin/design#color-grades`

## Mod colours

The mod colours the site has always used, each hue kept and only the lightness moved as far as contrast needs, so the light theme's are darker. No Mod keeps its blue under its own token. Touch Device, which once shared Sudden Death's orange, is a greyer orange. Every mod clears 3:1 on both cards and takes black text as a solid pill. Rare combinations get the "Other" grey.

```tsx
import { MOD_FILL_FOREGROUND, getModPaletteColor } from '@/lib/kit/color/mods';

<span
  className="inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold"
  style={{
    backgroundColor: getModPaletteColor(mods),
    color: MOD_FILL_FOREGROUND,
  }}
>
  {getBeatmapModLabel(mods)}
</span>;
```

- `getModPaletteColor(mods)`: applies the display rules first (NF and SO dropped, NC shown as DT), then returns `var(--mod-…)` or the "Other" grey.
- `getModPaletteEntry(mods)`: the entry with its `label`, `light` and `dark`, or undefined.
- `MOD_PALETTE`: labelled as the beatmap pages label them (`getBeatmapModLabel`): NM, HD, HR, DT, HT, EZ, FL, HDHR, EZHD, EZDT, HDFL, HDDT, SD, TD, RX (relax and autoplay), MR, RD and KEY (mania keys).
- `MOD_FILL_FOREGROUND`: black, the text colour on every solid mod fill.
- Mod labels and lists come from the format family (`formatMods`, `getBeatmapModLabel`).

Don't:

- Don't keep a mod colour table of your own; every mod chart and the beatmap list's top mods use this palette.
- Don't swap a mod to a new hue to fix contrast or a clash. Players know these colours; move the lightness, or the chroma for a rare mod, as `mods.ts` does.

Gallery anchor: `/admin/design#color-mods`

## Mod badges

`ModIconset` draws osu-web's lazer mod badges, mirrored one to one: osu-web's badge shape filled with the mod type's colour, and the mod's glyph on top in a near-black shade of it. They are an experiment, so they are the one place mod colours follow osu-web's types (blue automation, purple conversion, red difficulty increase, lime difficulty reduction, pink fun, yellow system) rather than `MOD_PALETTE`, and the same in both themes. In the light theme most badge fills fall under 3:1 against the card; the glyphs clear 3:1 on every fill.

```tsx
import ModIconset from '@/components/icons/ModIconset';

<ModIconset mods={headerMods.mods} freemod={headerMods.freemod} iconClassName="h-5 sm:h-6" />
<ModIconset mods={getScoreDisplayMods(score.mods, headerMods.mods)} className="h-4" />
```

- `mods`: the stored bitflags, every one drawn in lazer's acronym, NF, Target Practice and key co-op included; NC and PF stand for the DT and SD they imply (`getModBadgeAcronyms`). Key co-op draws as Dual Stages, osu!lazer's name for it, since its legacy acronym CO is lazer's Cover. No mods draws nothing; there is no No Mod badge.
- `lazerMods`: a lazer game's or score's lazer mods, drawn instead of the flags in play order, lazer-only mods included (`getModBadgeEntries`). A custom speed joins the badge's name ("Double Time 1.2x", `getModEntryName`) and is written after the badge in 12px semibold; `FittingModIconset` keeps it in the name only, so every badge keeps one slot. Pass `null` or leave it out for stable data.
- Every badge is an image named for its mod for assistive tech, with no tooltip: players read osu!'s acronyms on sight, as the owner decided for "Elite GM". Names come from `getModName` in `@/lib/utils/mod-badges`: osu!'s official names from osu-web's mod list ("Spun Out", "Hard Rock", "Seven Keys") and "Free Mods" for FM. Mod names are proper names, so they keep osu!'s Title Case; don't sentence-case them. `FittingModIconset`'s "+N" chip is the one mod tooltip: it lists the badges that did not fit.
- Badges and the "+N" chip stay still on hover and focus: no lift or bounce, since nothing else on the page moves that way.
- `freemod`: adds a freemod badge first. osu-web has none, so it is an acronym badge in `FREEMOD_COLOR`, osu-web's green-1: the type colours' 70% lightness step in a hue no mod type uses, so it doesn't read as a System mod.
- Badges sit side by side, 2px apart, and never overlap or shrink. Size them by height, no taller than the text line beside them: a game header's are 20px, 24px from tablet up; a score's 16px, 20px from tablet up.
- `FittingModIconset` (`@/components/icons/FittingModIconset`) is the row for tight spaces, such as a score card's: give it a height and a width (`h-4 flex-1 basis-0`). It measures its width, shows the badges that fit and folds the rest into a grey "+N" chip whose tooltip (tap, hover or focus) lists them with their names. It never wraps, so the grade and score beside it keep their spot; the fit logic is `countModBadgeSlots` and `fitModBadges` in `@/lib/utils/mod-badges`.
- A game card's header shows `resolveGameDisplayMods` (the lobby's mods, or what every freemod score shares), and each score shows only what the header doesn't, from `getScoreDisplayMods` in `@/lib/utils/mods`. A score that matches its header shows no badges. Lazer mods follow the same rules: the header's come with `resolveGameDisplayMods`, and a score's from `getScoreDisplayLazerMods`, which keeps a mod the header shows with different settings.
- The glyphs, the badge shape and their osu-web commit are in `public/icons/mods/`; each mod's name, type and glyph, and each type's colour, are in `@/lib/utils/mod-badges`. A mod osu-web has no glyph for shows its acronym.

Don't:

- Don't colour a mod chart, swatch or pill with `MOD_TYPE_COLORS`; those keep `MOD_PALETTE`.
- Don't redraw a mod icon by hand. Copy osu-web's glyph and add the mod to `MOD_BADGES`.

Gallery anchor: `/admin/design#color-mod-badges`

## Star rating colours

osu!'s difficulty spectrum. As a solid pill it keeps its exact colour with a black or white label (always 4.5:1); as an icon, text tint or chart mark on a card it is stepped darker in light mode and lighter in dark mode to clear 3:1.

```tsx
import {
  getStarRatingColor,
  getStarRatingForegroundColor,
  getStarRatingMarkColor,
} from '@/lib/kit/color/star-rating';

<span style={{ backgroundColor: getStarRatingColor(sr), color: getStarRatingForegroundColor(sr) }}>…</span>
<Star style={{ color: getStarRatingMarkColor(sr) }} />
```

- `getStarRatingMarkColor(sr)` returns `light-dark(<light>, <dark>)`, which follows the theme's `color-scheme`. Use it in `style`, not in an SVG presentation attribute.
- `getStarRatingMarkColors(sr)`: `{ light, dark }` hex, for code that knows its theme.

Don't:

- Don't put the solid pill colour (`getStarRatingColor`) on an icon or text on a card; some steps drop under 3:1 there. Use `getStarRatingMarkColor`.

Gallery anchor: `/admin/design#color-star-rating`

## Contrast helpers

Pure colour maths in `@/lib/kit/color/contrast` and `@/lib/kit/color/cvd`, for tests and for checking a new colour before it lands.

```ts
import { CONTRAST_MARK, contrastRatio } from '@/lib/kit/color/contrast';
import { SURFACES } from '@/lib/kit/color/surfaces';

contrastRatio('#4589f2', SURFACES.light.card) >= CONTRAST_MARK;
```

- `parseColor` reads hex, `rgb()`, `hsl()` and `oklch()`; `contrastRatio(fg, bg)` is WCAG 2 (a translucent foreground is painted over the background first); `formatContrast` rounds down. `CONTRAST_TEXT` (4.5) and `CONTRAST_MARK` (3) are the two thresholds. The steps behind them are exported too: `composite`, `relativeLuminance`, `toHex`, `rgbToOklab` and `oklabToRgb`.
- `colorDistance(a, b, vision)`: OKLab ΔE ×100 for `normal`, `protan` or `deutan` readers; `worstAdjacentDistance` checks a palette's neighbours against `CVD_SEPARATION_TARGET` (8) and `NORMAL_SEPARATION_FLOOR` (15).
- `SURFACES`: the light card (`--card`) and the dark panel (`--muted` at 75% over `--background`), plus each theme's muted, popover and accent (tooltip) surfaces. `TEXT_COLORS`: each theme's foreground and muted text, as hex. A test resolves both from `globals.css`.

Adding a colour token: add it to both blocks in `globals.css` (and to `@theme inline` if it needs a class), add the `themeColor(...)` entry to its module and to `TOKEN_GROUPS` in `@/lib/kit/color/tokens`, run `bun test apps/web/lib/kit/color`, and check the gallery.

## Tick rule

One tick rule site-wide: steps of 1, 2, 2.5 or 5 times a power of ten (the beatmap pages' steps), the densest that fits, at most six ticks. A horizontal axis (time, histogram buckets, box plot scales) drops to four on phones, where its labels would collide; a vertical value axis keeps six, as the beatmap charts do.

```ts
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getCategoryTicks,
  getNiceTicks,
  getTimeTicks,
} from '@/lib/kit/charts/ticks';

const y = getNiceTicks(0, maxCount, { integer: true });
// { min: 0, max: 1500, step: 500, ticks: [0, 500, 1000, 1500] }
const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
const x = getTimeTicks(firstTimestamp, lastTimestamp, maxTicks);
const years = getCategoryTicks([2015, 2016, /* … */ 2026], maxTicks);
// [2016, 2018, 2020, 2022, 2024, 2026]
```

- `getNiceTicks(min, max, options)`: covers the data with round ticks. Non-negative data never gets a negative tick; bar charts pass `0` as `min`.
  - `integer`: whole steps only, for counts.
  - `within`: keep the domain on the data and put ticks only inside it, for category axes, histogram buckets and `dataMin`–`dataMax` axes.
  - `maxTicks`: 6 by default; on a horizontal axis pass `NARROW_MAX_TICKS` below `sm` (`useIsNarrowChart` from `@/lib/hooks/useMediaQuery`).
  - A flat series (`min === max`) is padded, so the axis never collapses. With `within`, its one tick is the value itself (one year of data ticks `2024`, never a padded `2023` or `2025`); the domain keeps its padding so a numeric axis still centres the point.
- `getCategoryTicks(values, maxTicks)`: ticks for a category axis of evenly spaced whole numbers in ascending order (years, rating bucket starts): every value when they all fit, otherwise the rule's round values that are in the data, so every tick names a bar.
- `getTimeTicks(minTime, maxTime, maxTicks)`: ticks on UTC calendar boundaries (days, then 1, 2, 3 or 6 months counted from January, then years), with the `unit` to format them.
- `getNiceAxis` and friends in `lib/beatmaps/chart-axis.ts` follow the same rule; the beatmap box plots and scales keep using them.

Don't:

- Don't write a local tick rule. One that scales by powers of 5 produces steps such as 13 and 125, and a time axis that spaces ticks evenly between arbitrary timestamps lands them on no calendar day.
- Don't hard-code ticks or round a maximum by hand.
- Don't leave a value axis to Recharts' automatic ticks, which give steps such as 150. Pass `niceAxisProps(getNiceTicks(…))`, as the beatmap Misses chart does.

Gallery anchor: `/admin/design#color-chart-ticks`

## Axis formatters

Recharts `tickFormatter`s and tooltip value formats. Counts and quantities get thousands separators; years and IDs never do. They wrap the format family's `formatCount`, `formatNumber`, `formatYear` and `formatId`, so a chart prints what the table beside it prints.

```ts
import {
  formatCompactTick,
  formatCountTick,
  formatIdTick,
  formatNumberTick,
  formatPercentTick,
  formatTimeTick,
  formatYearTick,
} from '@/lib/kit/charts/format';
```

| Formatter           | Output                       | For                                   |
| ------------------- | ---------------------------- | ------------------------------------- |
| `formatCountTick`   | `12,345`                     | Counts: tournaments, players, scores  |
| `formatNumberTick`  | `1,250`, `0.25`              | Ratings and other quantities          |
| `formatCompactTick` | `950`, `250k`, `1.25M`       | Score axes                            |
| `formatPercentTick` | `95%`, `97.5%`               | Values already in percent             |
| `formatYearTick`    | `2024`                       | Year axes and labels                  |
| `formatIdTick`      | `1234567`                    | IDs                                   |
| `formatTimeTick`    | `Jul 20`, `Jul 2024`, `2024` | Time axes, with `getTimeTicks().unit` |

Don't:

- Don't format ticks with `toLocaleString()` (the visitor's locale), date-fns `format()` (local time) or a bare `String(value)` on a count axis.

## Recharts axis props

Shared props so every axis looks the same: 12px muted Inter labels, no tick marks or axis line, dashed horizontal gridlines.

```tsx
import {
  CHART_BAR_RADIUS,
  CHART_CURSOR,
  CHART_LINE_WIDTH,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';

<BarChart data={data} margin={CHART_MARGIN}>
  <CartesianGrid {...chartGridProps} />
  <XAxis {...chartAxisProps} dataKey="year" tickFormatter={formatYearTick} />
  <YAxis
    {...chartValueAxisProps}
    {...niceAxisProps(getNiceTicks(0, max, { integer: true }))}
    tickFormatter={formatCountTick}
  />
  <ChartTooltip
    cursor={CHART_CURSOR.bar}
    content={<ChartTooltipContent valueFormatter={formatCountTick} />}
  />
  <Bar dataKey="count" fill={seriesColor(0)} radius={CHART_BAR_RADIUS} />
</BarChart>;
```

- `chartAxisProps`: for any axis. `chartValueAxisProps` adds `width: 'auto'` for a value axis, so it sizes to its longest label (the share axis on the right takes it too).
- `niceAxisProps(ticks)`: `type`, `domain`, `ticks`, `interval: 0` and `allowDecimals` from `getNiceTicks`.
- `chartGridProps`: dashed, horizontal only. `ChartContainer` paints it in the border colour at half strength, so always render inside `ChartContainer` (`@/components/ui/chart`). The container also gives tick labels tabular figures (the body no longer does) and paints the bar cursor. `globals.css` gives Recharts' hidden measuring span (`#recharts_measurement_span`) tabular figures too, so the labels Recharts decides to show are spaced for the width it draws; keep the two together.
- `CHART_BAR_RADIUS` (4px data ends, square at the baseline), `CHART_LINE_WIDTH` (2px), `CHART_MARGIN`, `CHART_CURSOR.bar` and `.line`.
- Row (horizontal) bars, `layout="vertical"` in Recharts, with the categories on the left: `chartRowGridProps` (dashed vertical gridlines, one per count tick), `CHART_ROW_BAR_RADIUS` (`[0, 4, 4, 0]`, the data end on the right) and `CHART_ROW_MARGIN` (20px on the right, so the last count label, which centres on the plot's edge, is not cut to `1,50`). `CountBarChart` uses all three.
- Stacked bars: a 1px `stroke="var(--card)"` separates segments; round only the top series.
- `CHART_CURSOR.bar` is a band behind the hovered bar, `accent` at half strength (`--muted` matches the dark panel, so a muted band vanished there). `ChartContainer` paints the band the same way, so it also covers charts that pass `cursor` without it; pass it anyway so the intent is explicit.
- Turn off animation (`isAnimationActive={false}`) as the beatmap charts do.
- A share axis on the right is for one case: a running share over the same bars, such as the rating distribution's cumulative line (players at or below each bucket, 0–100%). Give that axis a `yAxisId` and `orientation="right"`, leave the count axis on the default id so the gridlines follow it, and put the share ticks on the count axis's gridlines, so the plot keeps one set of lines: `getRatingDistributionAxes` in `components/stats/stats-data.ts` does both, adding a step to a three-step count axis so no share reads 33%. Format the ticks with `formatPercentTick(share * 100)` and add a `marker: 'line'` legend entry.
- Draw bars with a line in a `BarChart`, not a `ComposedChart`: Recharts 3 draws a `Line` in any cartesian chart, and only a BarChart keeps the `CHART_CURSOR.bar` band (a ComposedChart turns it into a 1px rule).
- A line that crosses bars gets a 2px ring in the card colour: the same `Line` drawn first with `stroke="var(--card)"` and `strokeWidth={CHART_LINE_WIDTH + 4}`.

Don't:

- Don't add a second value axis for a second measure; a share of the plotted total is the only one. Two measures get two charts.
- Don't render Recharts outside `ChartContainer`: in a bare `ResponsiveContainer` its labels fall back to 16px and `#666`.
- Don't set tick font sizes or colours per chart (`fontSize: 14`, `fill: 'var(--foreground)'`); `chartAxisProps` carries `CHART_TICK_STYLE`.

## CountBarChart

A count per category on the shared chart parts: tournaments per year, per ruleset, per lobby size or per verification group. `columns` stand on a category axis along the bottom; `rows` put the categories on the left, for long names. One series in slot 1 of the categorical palette, unless the bars bring their own colour.

```tsx
import {
  CountBarChart,
  type CountBarDatum,
} from '@/components/kit/charts/CountBarChart';

<Panel>
  <SectionHeader icon={ChartColumn} title="Tournaments by lobby size" />
  <PanelBody>
    <CountBarChart data={bars} valueName="Tournaments" />
  </PanelBody>
</Panel>;

// The stats page's verification chart: one bar per RATINGS_GROUPS entry,
// each with `fill: getStatusHueColor(group.hue)`.
<CountBarChart
  data={bars}
  layout="rows"
  valueName="Tournaments"
  footer={(bar) => `${formatPercent(bar.count / total)} of all tournaments`}
/>;
```

- `data`: `CountBarDatum[]`, each `{ key, label, count, fill? }`. `label` is the formatted category (`formatYear`, `formatLobbySize`, `getRulesetLabel`). A `fill` on any bar colours every bar by its own `fill`; without, all take slot 1.
- `layout`: `columns` (default) or `rows`. Rows round their right end, draw vertical gridlines, leave room for the last count label and thin the count axis to four ticks on phones; columns keep six on their value axis.
- `valueName`: what is counted, the tooltip row's name.
- `categoryTicks`: the labels to tick when not all fit, such as `getCategoryTicks(years, maxTicks).map(formatYearTick)`.
- `footer(bar)`: a tooltip footer for the hovered bar, such as its share.
- `className`: the chart box, 240px tall (`h-60`) by default.
- The pure rules behind it, `getCountAxisTicks` and `hasOwnFills`, are in `@/lib/kit/charts/count-bars`.

Don't:

- Don't keep a copy for one page; the stats page's year, ruleset, lobby size and verification charts all use this one.

Gallery anchor: `/admin/design#color-chart-count-bars`

## StackedBarChart

Several series per category stacked in one column, on the shared chart parts: tournaments per year split by rank restriction band, or one series as a share of every column, such as lazer tournaments of each year's. A legend sits above the plot from two series on; the tooltip lists the stack top to bottom, with an optional footer.

```tsx
import {
  StackedBarChart,
  type StackedBarDatum,
} from '@/components/kit/charts/StackedBarChart';
import { RANK_RANGE_BUCKETS } from '@/lib/beatmaps/rankRange';

const series = RANK_RANGE_BUCKETS.map(({ key, label, color }) => ({
  key,
  label,
  color,
}));

// components/stats/RankRestrictionsPanel.tsx
<StackedBarChart
  data={bars} // { key: '2024', label: '2024', values: { open: 144, lt1k: 21, … } }
  series={series}
  mode="share"
  categoryTicks={getCategoryTicks(years, maxTicks).map(formatYearTick)}
  footer={(bar) => formatCountOf(getStackedTotal(bar, series), 'tournament')}
/>;

// One series as a share of a larger total (components/stats/LazerSharePanel.tsx)
<StackedBarChart
  data={[{ key: '2026', label: '2026', values: { lazer: 11 }, total: 178 }]}
  series={[{ key: 'lazer', label: 'Lazer', color: seriesColor(0) }]}
  mode="share"
/>;
```

- `data`: `StackedBarDatum[]`, each `{ key, label, values, total? }`. `values` holds a count per series key; a missing one counts zero. `total` is what a share is out of when it is more than the series add up to; it defaults to their sum.
- `series`: `{ key, label, color }`, bottom of the stack first. Colours are the categorical slots of each series' fixed index, or a domain palette's own (the rank restriction bands keep slots 1 to 5 from `lib/beatmaps/rankRange.ts`).
- `mode`: `count` (default) stacks the counts on a count axis; `share` stacks each count as a percentage of its column's total, on a percentage axis that tops out at 100%. A column with a total of zero draws nothing.
- `categoryTicks`, `footer(datum)` and `className` (`h-60` by default; the legend is extra) work as on CountBarChart. Categories that are not years, such as the rating gap buckets `0–100` to `500+`, tick through the same rule: pass each bucket's start to `getCategoryTicks` and keep the labels of the starts it returns, so a phone labels every other bar (`components/stats/HigherRatedWinsPanel.tsx`).
- The pure rules, `getStackedBarRows`, `getStackedValueTicks` and `getStackedTotal`, are in `@/lib/kit/charts/stacked-bars`.

Don't:

- Don't hand-build a stacked `BarChart`; the stats page's rank restrictions, lazer share and win rate by rating gap all use this one.
- Don't draw a share chart for data with no share yet: the lazer share shows an empty state until a lazer tournament is verified, not a flat 0%.

Gallery anchor: `/admin/design#color-chart-stacked`

## ChartTooltipContent

The one chart tooltip: an optional title, one row per series (marker, muted name, value right-aligned) and an optional footer, on the same card the beatmap charts use. It is the content of the `ChartTooltip` from `@/components/ui/chart` (Recharts' `Tooltip`), the same pairing the beatmap charts use, and it replaces the shadcn `ChartTooltipContent` from that file.

```tsx
import { ChartTooltipContent } from '@/components/kit/charts/ChartTooltip';
import { ChartTooltip } from '@/components/ui/chart';

<ChartTooltip
  cursor={CHART_CURSOR.bar}
  content={
    <ChartTooltipContent
      reverse
      labelFormatter={(label) => formatYearTick(label)}
      nameFormatter={(key) => getRulesetLabel(Number(key))}
      valueFormatter={formatCountTick}
      footer={(payload) => `Total ${formatCountTick(sum(payload))}`}
    />
  }
/>;
```

- Pass it as the tooltip's `content`; Recharts fills in `active`, `payload` and `label`. Rendered on its own inside a chart it shows nothing.
- `labelFormatter`: the title from the hovered x value. `valueFormatter`: each value, usually an axis formatter; `formatNumberTick` by default. `nameFormatter`: series key to display name.
- The marker takes the series' `fill` (or a line's `stroke`). Bars coloured per `Cell` have no series fill, so give each data row a `fill` field, as the beatmap mod charts do, and the marker uses it.
- `marker`: `square` (default), `line`, `dashed` or `dot`, matching the mark.
- It gives every series in Recharts' payload a row, including one marked `tooltipType="none"`. To leave a series out, pass `content` as a function and filter `payload`, as the rating distribution does to keep its cumulative line (and the line's ring) out of the rows; its footer gives the share instead.
- `reverse`: list a vertical stack top to bottom. `footer`: a total or a share. Values and the footer take tabular figures, as they change while the pointer moves; don't wrap a footer in your own `tabular-nums` span.
- `ChartTooltipBody`: the same readout without the card, for a `TapTooltip` around a chart drawn without Recharts (box plots). `ChartTooltipCard`: the card around it, for static use.

Don't:

- Don't write a per-chart tooltip component.
- Don't import the shadcn `ChartTooltipContent` from `@/components/ui/chart`; no chart uses it. It formats numbers as en-US with up to three decimals, never the visitor's locale, but it has no `valueFormatter`, footer or kit marker.
- Don't print values with `toLocaleString()`; pass a formatter.

Gallery anchor: `/admin/design#color-chart-tooltip`

## ChartLegend and SeriesMarker

The key for a chart with two or more series: a marker in the series colour and a muted 12px name, above the plot, in series order.

```tsx
import { ChartLegend } from '@/components/kit/charts/ChartLegend';
import { SeriesMarker } from '@/components/kit/charts/SeriesMarker';

<ChartLegend
  items={RATED_RULESETS.map((ruleset, index) => ({
    key: String(ruleset),
    label: getRulesetLabel(ruleset),
    color: seriesColor(index),
  }))}
/>;
```

- `items`: `key`, `label`, `color` and an optional `marker`. `marker` on the legend sets the default.
- `SeriesMarker`: the marker on its own, for direct labels and custom rows. `square` for bars and areas, `line` for lines, `dashed` for reference and trend lines, `dot` for points.
- A single series needs no legend; the SectionHeader title names it. With four or fewer series, direct labels on the marks are a good addition.
- The legend's text stays muted; the marker carries the colour.

Don't:

- Don't use Recharts' default `<Legend />`, which renders below the plot in the series colour.

Gallery anchor: `/admin/design#color-chart-legend`

## Chart card

A chart sits in a Panel with a SectionHeader, never in a card of its own. There is no separate chart card component; compose the layout family's parts.

```tsx
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ChartContainer } from '@/components/ui/chart';

<Panel>
  <SectionHeader
    icon={ChartColumn}
    title="Tournament verification status"
    meta="2,993 tournaments"
    infoText="Not in ratings yet includes Pending, Pre-verified and Pre-rejected"
  />
  <PanelBody className="flex flex-col gap-3">
    <ChartLegend items={…} />
    <ChartContainer config={{}} className="aspect-auto h-60 w-full">
      <BarChart …>…</BarChart>
    </ChartContainer>
  </PanelBody>
</Panel>;
```

- The SectionHeader icon is muted, the title is the chart's name in sentence case, and the meta is a short count or the peak.
- An info button only when it tells the reader something the chart does not: a threshold ("Mods used in 1%+ of verified games"), a grouping, how a value is counted. Most charts have none: "Tournaments by year" with "2,540 verified" beside it needs no help, and neither do the profile's frequent teammates and opponents.
- The legend goes at the top of the body; the plot is 240px tall (`h-60`) unless the chart needs more.
- Empty data uses the shared empty state inside the same panel.

Don't:

- Don't give a chart a card of its own, a 24px blue icon or a description line under its title.
- Don't turn a caption that restates the title ("Verified tournaments by ruleset", "Most frequently played with teammates") into an info button; drop it.

Gallery anchors: `/admin/design#color-chart-line`, `/admin/design#color-chart-bar`, `/admin/design#color-chart-stacked`, `/admin/design#color-chart-distribution`, `/admin/design#color-chart-count-bars`
