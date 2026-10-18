o!TR (osu! Tournament Rating) rates osu! tournament players. The site is a data tool first: leaderboards, player profiles, tournaments, matches and the people who verify them. Its look is quiet and neutral so the data, and the few colours that carry meaning, stand out. Build every screen from these tokens and rules; the sections after this one cover page patterns, value formatting and the domain palettes.

## Content fundamentals

- **Sentence case everywhere**: headings, buttons, menu items, dialog titles, status names. "Mod distribution", not "Mod Distribution". Never uppercase text, never wide letter-spacing.
- **Plain, factual statements.** The site describes what is true, not what the visitor should feel. "This tournament is not in ratings yet." then a link, "Read our rating FAQ".
- **One name per thing, everywhere.** Pending, Pre-verified and Pre-rejected are all "Not in ratings yet", in rows, badges and charts. Rulesets are always `osu!`, `taiko`, `catch`, `mania 4K`, `mania 7K` (lowercase, as osu! writes them).
- **Validation is a statement**, not a command or an apology: say what is wrong with the value.
- **Actions say what they do**: "Try again", "Clear all", "Load more", "Show more", "View".
- **Help says only what is not on screen.** Never a tooltip, caption or info text that repeats a label, placeholder or title.
- No emoji. No exclamation marks in interface copy; the `!` in osu! and o!TR is part of the name.
- The product is "o!TR", always with the lowercase o and the `!`.

## Visual foundations

### Colour

- The interface is neutral greys plus one brand blue. Set text in `foreground` on `background`, `card`, `muted` or `popover`; set secondary text in `muted-foreground`.
- **Blue means "you can act on this" or "this is selected".** Primary buttons, a selected chip or tab, the focus ring, links on hover and the notification dot. Nothing decorative is blue: section and page icons are `muted-foreground`, names rest in `foreground` and turn `link` on hover.
- Use `primary` for blue icons, borders and selected tints; `link` for blue text; `primary-solid` behind white `primary-foreground` text. Never put white text on `primary` (3:1 in dark mode) and never colour text with `primary`.
- Status colour goes on fills, borders and icons (`destructive`, `color-success`, `color-warning`); their `*-foreground` tokens colour text. On a solid success fill, text is Tailwind's green-950.
- Red only for destructive actions; a solid red fill (`destructive-solid`) only in the final confirm.
- Tooltips sit on `accent`, where `muted-foreground` fails: muted text there is `accent-muted-foreground`. Never put red text on `accent`.
- Callouts use their own tones (`callout-info`, `callout-warning`, `callout-danger`, each with `-border` and `-foreground`). The info callout is slate, not brand blue.
- Domain colours (tiers, mods, grades, verification, teams, chart series) only ever mean their domain. See the palettes section.
- Colour never carries meaning alone: a status has its glyph, a series its label, a mod its name.
- Contrast floor, in both themes: text 4.5:1, marks and icons 3:1, against `card` and `muted`.

### Type

- One typeface: Inter, from Google Fonts with optical sizes and weights 100–900. It is used for everything, including numbers, chart axes, tooltips and code.
- Five sizes. `page-title` (30px bold, 24px on phones) is the page's only h1 and never larger; `section-title` (16px semibold) heads panels; `row-title` (16px medium) is the name on a row; `body` (14px) is running text and cells; `label` and `meta` (12px, muted) are labels and counts. 12px is the minimum anywhere.
- Body text uses Inter's proportional figures. Numbers that sit in columns or change in place (table cells, stat values, counts, ranks, chart ticks) take tabular figures. Dates and prose never do: Inter's tabular figures widen the hyphen.

### Layout and spacing

- The base unit is `spacing` (4px). Panels sit `panel-gap` (16px) apart at every width and pad `panel-padding` (16px); dialogs pad `dialog-padding` (24px).
- Pages have a `page-gutter` of 16px on phones (20px from sm) and `page-top` of 40px on desktop (24px on phones). The root layout sets these; a page never adds its own container or padding.
- A page is a frame holding a page header (list and tool pages) or a detail hero with tabs (detail pages), then panels. Never nest a panel or card inside a panel.
- The sticky site header is `header-height-px` (64px), `card` with `shadow-sm` and a bottom hairline.

### Surfaces, borders, radii, shadows

- **The panel is the one surface**: `radius-xl` (12px) corners, a `border` hairline, `card` with `shadow-sm` in light mode; in dark mode a flat `muted` at 75% with no shadow.
- Inside a panel, tiles are bordered boxes with `radius-lg` (8px) corners. Inputs in the kit use 8px corners too; buttons and base controls `radius-md` (6px). Badges are pills (`radius-full`) or 6px-rounded where a pill would look like a button.
- Borders are hairlines in `border`. No zebra stripes, no second frame around a table, no coloured left-border cards.
- Shadows are short and grey: `shadow-xs` on buttons and inputs, `shadow-md` on popovers and menus, `shadow-lg` on dialogs. Dialogs sit over one black 50% backdrop.
- Cover art (beatmap backgrounds) appears only in a detail hero, under a dark matte with white text in both themes. When there is no art, show none; never a placeholder image.

### States and motion

- Focus is a 3px `ring` at 50% (black in light mode, brand blue in dark), shown on keyboard focus.
- Hover on ghost controls fills with `accent`. Only rows that open as a whole get a hover tint; names turn `link` on hover.
- Motion is small and functional: skeletons pulse, the header logo grows 5% on hover, the support heart pulses in `support` pink on hover. All motion is behind `prefers-reduced-motion: no-preference`.
- Help opens on tap, hover and keyboard focus alike. Anything that opens only on hover is a bug.

## Iconography

- **Interface icons are lucide**, line icons at 16px in controls and rows, 14px in tile labels, 28px muted beside a page title. Section icons are `muted-foreground`, never blue.
- **Brand and domain marks are the SVGs in the asset groups**: logos, rulesets, tier badges, mod badges and score grades. Use them as they are; never redraw them or recolour multi-colour marks. Mod badges are masks drawn by `ModIconset`, never placed as images.
- Verification status has its own glyph set: the glyph shows the outcome and a dashed outline means an automated check (Verified, Pre-verified, Pending, Pre-rejected, Rejected).
- Icon-only buttons always have an accessible name and a tooltip, except an X that closes or clears.
- The one help button is a circled "i" (InfoButton).
- No emoji as icons.

## Components

- Build screens from the component library, `window.OTR` (`components/bundle.js` with `components/bundle.css`, over React 19 in `components/lib/`). Each component's card says when to use it, its props, and its do's and don'ts.
- Wrap the whole app once in `OTR.TooltipProvider`, as the site's root layout does; every tooltip, info button and icon button needs it.
- Follow the page anatomy: `PageFrame`, then `PageHeader` or `DetailHero`, then `Panel`s, each starting with a `SectionHeader` or a `ListToolbar`. Never a panel inside a panel.
- Don't restyle a component with colour, size or padding overrides; pick its `variant` or `size`. If nothing fits, the library gains a component; a page never grows its own.
- Icons are `OTR.Icons` (lucide). Domain enums are `OTR.osu`; formatters and palette helpers are `OTR.format`, `OTR.color`, `OTR.status` and `OTR.lists`, so values read the same everywhere.
- Form inputs, selects, radios, checkboxes, switches and the react-hook-form bindings are the shadcn primitives under `OTR.ui`; lay them out with `FormPanel` and label them with `FormFieldLabel`. Beatmap art is `OTR.BeatmapCover`, avatars `OTR.OsuAvatar`.

## Accessibility

- Every control is reachable by keyboard and shows visible focus.
- Status is never told by colour alone.
- Text holds 4.5:1 and marks 3:1 in both themes; the site's own tests check every token pair.
- Tap icons keep at least 8px between them so each has a 24px target.
