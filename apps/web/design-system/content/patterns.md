# Page patterns

How o!TR screens are put together. Every value comes from the beatmap pages, the visual reference for the whole site.

## Page anatomy

- **List and tool pages**: a page header (a muted 28px lucide icon, the `page-title` h1, one line of `page-description`, actions on the right, a divider), then panels. The first panel sits 24px below the divider.
- **Detail pages**: a detail hero with tabs, then panels. The hero shows the name (`page-title`, 30px, never larger), muted text after it (a difficulty name, an abbreviation), status, meta items (16px icon and short text) and public actions on the right in one order: report, audit history, open on osu!. Admin actions live in one "Admin" menu per hero.
- **Panels**: a section header strip (optional muted icon, `section-title`, optional info button, meta or small actions on the right, over a divider; 48px tall with or without a 32px button), then rows, tiles, a table or a chart. Searchable lists start with their list toolbar instead of a section header.
- Side-by-side panels go in a grid with the same 16px gap. Never a panel in a panel, never a box around a table inside a panel.

## Stat tiles

One number with its label: a 12px muted label (with an optional 14px icon) over a `stat-value` number (20px bold, tabular figures), with an optional 12px muted line under it.

## Lists

- One toolbar inside the list's panel: a 40px search field, filters, a 40px sort select and the count ("1,204 tournaments").
- Every control that changes what a list shows lives in the page address. Filters apply as you change them; "Clear all" clears filters only.
- Paging: numbered pages inside the panel for searchable lists; "Load more" for activity feeds; "Show more" for a short list shown in part on a detail page. Never a silent cap.

## Tables and rows

- Column headers are 12px muted text; numbers are right-aligned with tabular figures; a missing value is an em dash.
- No zebra stripes and no second frame. Names link (in `foreground`, `link` on hover). Only rows that open as a whole get a hover tint.
- On phones, tables become rows that keep the key number visible. Nothing scrolls sideways.
- Reports open in a modal from a labelled "View" button.

## Feedback

- **One empty state**, at least 288px tall when it is a panel's main content.
- **One section error** with a "Try again" button: `regular` (a 48px icon and a sentence), `compact` or `inline`.
- **Skeletons shaped like the page**: real panels, headers, tables and rows with `accent` bars in place of the data, so nothing shifts on load.
- **One callout** with info, warning and danger tones: 8px corners, 16px by 12px padding; or a full-width banner under the site header.

## Controls

| Button size | Height | Where                                                                          |
| ----------- | ------ | ------------------------------------------------------------------------------ |
| `sm`        | 32px   | Inside panels and heroes: section headers, rows, hero actions, menus, popovers |
| `default`   | 36px   | Form and dialog actions, page header actions                                   |
| `lg`        | 40px   | List toolbars, beside the 40px search field and sort select                    |

- Primary buttons fill with `primary-solid` and white text. Red is for destructive actions only; solid red only in the final confirm.
- Never large lifted buttons with a big shadow and a hover lift.
- **Dialogs**: one layout. `radius-xl` corners, `background` surface with `shadow-lg`, a header strip (`section-title`, optional muted description), a 24px-padded body, a footer strip in `muted` at 30% with the actions on the right, over a black 50% backdrop. Widths 448, 512 (default) or 672px.
- **Forms**: field labels in a 20px row so side-by-side inputs stay level; fields 16px apart; form sections with a section header strip.
- **Menus**: an overflow menu per row for admin actions. A disabled item shows a muted second line saying why.
- **Status badges**: 20, 24 or 32px tall, pill by default; an 8px swatch for a domain colour in front of the label.
