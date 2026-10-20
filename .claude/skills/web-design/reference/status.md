# Status and badges

How the site shows verification status, report states, small labels and "something new" dots.
The glyph carries the meaning and colour only reinforces it, so every status still reads in greyscale. Import each component from its own file under `@/components/kit/status/` and the copy from `@/lib/kit/status/`.

- [Status sheet](#status-sheet): the five verification states and their names
- [Status copy](#status-copy): names, tooltip lines and the "Not in ratings yet" group
- [VerificationStatusIcon](#verificationstatusicon): status as an icon, for rows and pips
- [VerificationStatusBadge](#verificationstatusbadge): status with its name
- [VerificationStatusTooltip](#verificationstatustooltip): the explanation behind an icon or badge
- [NotInRatings](#notinratings): the muted "Not in ratings yet" label and notice
- [Badge](#badge): the one small label, for mods, rulesets, roles, tags and counts
- [ReportStatusBadge](#reportstatusbadge): a data report's state
- [JobStateBadge](#jobstatebadge): a background job's state
- [NotificationDot](#notificationdot): the one "something new" dot
- [CircleDashedX](#circledashedx): the Pre-rejected glyph lucide lacks

## Status sheet

| State        | Glyph                | Hue     | Badge                   | Group              |
| ------------ | -------------------- | ------- | ----------------------- | ------------------ |
| Verified     | circled check        | green   | filled                  | Verified           |
| Pre-verified | dashed circled check | green   | dashed outline, no fill | Not in ratings yet |
| Pending      | clock                | neutral | filled                  | Not in ratings yet |
| Pre-rejected | dashed circled cross | red     | dashed outline, no fill | Not in ratings yet |
| Rejected     | circled cross        | red     | filled                  | Rejected           |

- The glyph says the outcome; a dashed outline says an automated check decided, a solid one says an admin did. The badge repeats this: filled for a person's decision, a dashed outline with no fill for an automated check.
- Each state has exactly one name, everywhere: never "Awaiting review" or "Pre-Verified".
- Pending is `VerificationStatus.None`. Statuses are compared by identity only. Their numbers are not ordered by meaning, so never write `status < VerificationStatus.Verified` or sort by the number; use `VERIFICATION_STATUS_ORDER` for display order.
- Icons and badges take the outcome's hue, so Pre-verified is green and Pre-rejected red. Charts and summaries group the states into three: Verified, "Not in ratings yet" (one neutral bar for Pending, Pre-verified and Pre-rejected) and Rejected. Pending is never a bar or series of its own. A status filter offers all five states, as the tournament list's Status filter does.
- Colours come from the verification palette in `globals.css` (`--verification-verified`, `--verification-rejected`, `--verification-neutral`), not from mods, tiers or the categorical chart palette. Outside these components, use the colour family's helpers in `@/lib/kit/color/verification`: `getVerificationStatusColor(status)` for a status mark and `getRatingsGroupColor(status)` for a chart fill.

Gallery anchor: `/admin/design#status-sheet`

## Status copy

Plain TypeScript in `@/lib/kit/status/verification`, `report`, `reasons` and `count`, with unit tests. Every status name and line on the site comes from here.

```ts
import {
  NOT_IN_RATINGS_YET_LABEL,
  RATING_FAQ_URL,
  RATINGS_GROUPS,
  VERIFICATION_STATUS_ORDER,
  getRatingsGroup,
  getVerificationStatusLine,
  getVerificationStatusName,
  isNotInRatingsYet,
} from '@/lib/kit/status/verification';
import {
  getRejectionReasonTexts,
  getWarningTexts,
} from '@/lib/kit/status/reasons';
import { formatBadgeCount } from '@/lib/kit/status/count';

getVerificationStatusLine(VerificationStatus.Verified, { reviewer: 'apricot' });
// "Verified by apricot"
isNotInRatingsYet(tournament.verificationStatus); // Pending, Pre-verified, Pre-rejected
getWarningTexts('match', match.warningFlags); // ["Low game count", …]
formatBadgeCount(140); // "99+"
```

- `getVerificationStatusName(status)`: the one name; `getVerificationStatusCopy(status)` (from `VERIFICATION_STATUS_COPY`) gives it as `{ name }`. There is no explanation line: the name is the whole message.
- `getVerificationStatusLine(status, { reviewer, pendingRating })`: the line a status tooltip opens with. The reviewer joins Verified and Rejected only ("Rejected by apricot"); `pendingRating` adds ", pending rating calculation" to Verified only.
- `getVerificationStatusLabel(status, { context, hasWarnings })`: the accessible name of an icon on its own, such as "Game 3: Pre-verified, with warnings".
- `isNotInRatingsYet(status)`, `NOT_IN_RATINGS_YET_STATUSES` and `NOT_IN_RATINGS_YET_LABEL`: the group of the three undecided states.
- `getVerificationStatusHue(status)` and `isAutomatedCheckStatus(status)`: the hue of an icon or badge (`success`, `neutral`, `destructive`) and whether it gets the dashed outline.
- `RATINGS_GROUPS` and `getRatingsGroup(status)`: the three chart groups in order, each with a `key`, a `label`, a `hue` (`success`, `neutral`, `destructive`) and the `statuses` it counts.
- `RATING_FAQ_URL`: the Rating FAQ answer on why a tournament is not in ratings.
- `getWarningTexts(entityType, flags)` and `getRejectionReasonTexts(entityType, reason)`: one sentence-case line per set bitflag: the entity's labels from the format family, split by its `getFlagLabels`.
- `REPORT_STATUS_COPY` and `getReportStatusCopy(status)`: Pending, Confirmed and Dismissed, with their tones. `REPORT_STATUS_ORDER` is their order in filters and legends, such as the admin queue's status switch.
- `formatBadgeCount(count, max = 99)`: a count for a badge, with thousands separators, capped as "99+".

Don't:

- Don't write status names or explanations inline. If the wording is wrong, change it in `lib/kit/status/verification.ts` and its tests.
- Don't treat `0` or a falsy status as "no status": `VerificationStatus.None` is Pending.

## VerificationStatusIcon

Status without its name, for table cells, game pips, list rows and next to a heading. Warnings add a small amber triangle beside the icon; they never recolour it.

```tsx
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import {
  getRejectionReasonTexts,
  getWarningTexts,
} from '@/lib/kit/status/reasons';

<VerificationStatusIcon
  status={game.verificationStatus}
  warnings={getWarningTexts('game', game.warningFlags)}
  rejectionReasons={getRejectionReasonTexts('game', game.rejectionReason)}
  context={`Game ${index + 1}`}
  tooltip="tap"
/>;
```

Props that matter:

- `status`: a `VerificationStatus`.
- `size`: `sm` (14px) inside a line of text, `md` (16px, default) in rows and cells, `lg` (20px) next to a page or section heading.
- `variant`: `default`, or `overlay` on cover art only. The overlay sets the glyph on a dark disc (80% black, `OVERLAY_DISC_ALPHA`, with a faint white ring, a 24px disc around the 16px glyph) and gives it the dark theme's lighter colours whatever the page's theme, so every state keeps 3:1 even over a white cover; a test checks it. Warnings make the disc a pill.
- `tooltip`: `tap` opens on tap, hover and focus (it renders a button); `hover` adds no button, for an icon inside a link. Leave it out only when the name is written next to the icon.
- `warnings`, `rejectionReasons`, `reviewer`: what the tooltip lists. Any warning shows the marker.
- `context`: starts the accessible name ("Game 3: Rejected"). `showContext` also heads the bubble with it; use it only in a row of look-alikes, such as game pips.
- `pendingRating`: a verified item whose stats have not come yet, as the match and tournament heroes know from their player stats.
- `decorative`: hides the icon from assistive tech when the name is already beside it.

Related exports in the same file: `VerificationStatusGlyph` (the bare coloured glyph, for legends) and `StatusWarningMarker` (the triangle on its own).

Do:

- Give every icon on its own a tooltip. Without one it still has an accessible name (`role="img"`), but sighted visitors cannot learn what the glyph means.
- Use `context` when several icons sit together, such as the game pips of a match row, so each one is named ("Game 3: Rejected"). Add `showContext` there too, so sighted visitors see which pip they opened.
- Leave `showContext` off where the row beside the icon already names it: a score card, a game card, a match or tournament row.
- Keep tap icons at least 8px apart (`gap-2`): the icon is a 16px target, and the gap gives each one the 24px tap area WCAG 2.5.8 asks for.
- Inside a whole-row link, use `tooltip="hover"`: the row is one link, so it can hold no button. The row link's `linkLabel` replaces the row's content for screen readers, icon included, so a status the row must say aloud goes into the label as well ([RowListItem](layout.md#rowlist-and-rowlistitem)).
- On cover art (the game card header), use `variant="overlay"`, as `VerificationStatusBadge` uses its `overlay` variant there.

Don't:

- Don't put the icon in a tinted chip or a coloured square.
- Don't colour a status with a palette class such as `text-orange-500` for warnings. Pass `warnings` instead.
- Don't set a bare glyph on cover art and rely on the scrim: over a bright cover the 16px glyph drops under 3:1.
- Don't pick status glyphs from lucide by hand (`CircleCheck`, `CircleX`, `TriangleAlert`, a square or a triangle for the automated states). Render this component, or `VerificationStatusGlyph` in a legend.

Gallery anchor: `/admin/design#status-verification-icon`

## VerificationStatusBadge

Status as glyph plus name, for detail heroes, game and match card headers, dialogs and audit diffs. The hue follows the outcome: green for Verified and Pre-verified, neutral for Pending, red for Pre-rejected and Rejected. An admin's decision is a filled badge; an automated check is a dashed outline with no fill.

```tsx
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';

<VerificationStatusBadge
  status={tournament.verificationStatus}
  rejectionReasons={getRejectionReasonTexts(
    'tournament',
    tournament.rejectionReason
  )}
  reviewer={tournament.verifiedByUsername}
  tooltip="tap"
/>;
```

Props that matter:

- `size`: `sm` (20px) in dense rows and diffs, `md` (24px, default) in headers and dialogs, `lg` (32px) in a hero next to the 30px title.
- `variant`: `soft` (default) on any surface; `overlay` only on cover art, inside the card's `dark` wrapper.
- `tooltip`, `warnings`, `rejectionReasons`, `reviewer`, `context`: as for the icon.

Do:

- Use the badge where there is room for the word, and the icon where there is not. Don't use both for the same item.
- For an audit diff's old value, strike it through: `className="line-through"`.

Don't:

- Don't replace the badge's name with "Awaiting review" or add an amber "pending" pill next to it. The "what counts" message is `NotInRatings`.
- Don't build a status pill by hand from `Badge`; the tone, outline, glyph and copy must stay together.
- Don't recolour the badge by ratings group. "Not in ratings yet" is said in words by `NotInRatings`, and in charts by the neutral bar.

Gallery anchor: `/admin/design#status-verification-badge`

## VerificationStatusTooltip

The facts behind a status icon or badge, in short lines with no full stops: the context when `showContext` is set, then the status line from `getVerificationStatusLine` ("Rejected by apricot"), then one bulleted line per rejection reason and one line per warning, each warning behind the warning triangle. The status line ends with a colon when a list follows. The icon and badge use it through their `tooltip` prop; wrap something else with it only when that something is the status trigger.

```tsx
import {
  VerificationStatusDetails,
  VerificationStatusTooltip,
} from '@/components/kit/status/VerificationStatusTooltip';

<VerificationStatusTooltip
  mode="tap"
  label={getVerificationStatusLabel(status)}
  status={status}
>
  {trigger}
</VerificationStatusTooltip>;
```

- `mode="tap"` uses `TapTooltip` (a button that opens on tap, hover and focus); `mode="hover"` uses `SimpleTooltip` and adds no button. `side` places the bubble, and `triggerClassName` styles the tap button.
- `VerificationStatusDetails` is the body on its own, for a chart tooltip or a popover that already exists.

Don't:

- Don't add a line that explains the status, such as "Approved by an admin" or "awaiting admin review": the name says it.
- Don't head the lists with "Rejection reasons" or "Warnings": the bullet and the triangle tell them apart.
- Don't promise when an item counts in ratings unless the page's data shows it has not been rated yet (`pendingRating`).

Gallery anchors: `/admin/design#status-verification-icon`, `/admin/design#status-verification-badge` (the body on its own)

## NotInRatings

Says data does not count toward ratings yet, for Pending, Pre-verified and Pre-rejected; it renders nothing for Verified and Rejected, so pass the status unconditionally.

```tsx
import { NotInRatings } from '@/components/kit/status/NotInRatings';

// In a list row, on the meta line:
<NotInRatings status={tournament.verificationStatus} />

// Once, under a tournament page's header:
<NotInRatings status={tournament.verificationStatus} variant="notice" />
```

Props that matter:

- `variant`: `label` (default) is muted 12px text, "Not in ratings yet"; `notice` is a muted 14px sentence, "This tournament is not in ratings yet.", followed by a "Read our rating FAQ" link.
- `subject`: `tournament` (default) or `match`, the noun the notice uses.

Do:

- Use the label on the tournament list, search results and profile tournament cards, beside or under the row's meta line.
- Use the notice once per detail page, directly under the hero.

Don't:

- Don't show an amber "Awaiting review" pill; this label says it.
- Don't colour the label; it is information, not a warning.

Gallery anchor: `/admin/design#status-not-in-ratings`

## Badge

The one small label: pick a tone for meaning, a size for the line it sits in, and `customColor` or `swatch` for a domain palette. It is a `span`, not a control.

```tsx
import { Badge } from '@/components/kit/status/Badge';

<Badge>lazer</Badge>
<Badge tone="destructive" size="sm">Beatmap not pooled</Badge>
<Badge variant="solid" tone="primary" size="sm">{formatBadgeCount(count)}</Badge>
<Badge customColor={{ background: getModPaletteColor(mods), foreground: MOD_FILL_FOREGROUND }}>
  {getBeatmapModLabel(mods)}
</Badge>
<Badge variant="outline" swatch={getModPaletteColor(Mods.HardRock)}>HR 1,204</Badge>
```

Props that matter:

- `tone`: `neutral` (default), `primary`, `success`, `warning`, `destructive`.
- `variant`: `soft` (default, tinted fill); `outline` (no fill, for tinted surfaces such as tiles and for quiet tags); `solid` (full fill, for counts; only `neutral`, `primary` and `success`); `overlay` (on cover art only).
- `size`: `sm` 20px, `md` 24px (default), `lg` 32px. A lucide icon as a direct child is sized for you (12, 14 or 16px).
- `shape`: `pill` (default) or `rounded` (6px corners). Use `rounded` only where a pill would read as a button, such as a row of chips next to real buttons.
- `customColor`: `{ background, foreground }` for a solid domain fill (mods, star rating). Pass CSS colours, usually `var(--…)` from a palette helper.
- `swatch`: a domain colour shown as the 8px chip in front of the label (mod share, tiers, grades, rank restrictions, teams).

When to pick each:

- Status: never by hand; use `VerificationStatusBadge` or `ReportStatusBadge`.
- Mods: `customColor` with `getModPaletteColor(mods)` and `MOD_FILL_FOREGROUND` from `@/lib/kit/color/mods` (the reviewed mod palette; every entry takes black text), or `swatch={getModPaletteColor(mods)}` beside a count. The label comes from `getBeatmapModLabel` in `@/lib/utils/mods`.
- Tiers: `swatch={getTierColor(tierName)}` from `@/lib/kit/color/tiers`.
- Rulesets: neutral soft with `RulesetIcon` (`className="fill-current"`) and the label from `getRulesetLabel` (`@/lib/kit/format/ruleset`): osu!, taiko, catch, mania 4K, mania 7K.
- Roles: neutral soft with an icon: `ShieldCheck` for Admin, the one role the profile shows (`components/profile/ProfileRoleBadge.tsx`). Never red.
- Tags: `lazer` is neutral outline. "Includes unverified" is a notice, not a tag: use `CalloutChip icon={ShieldQuestion}` from `@/components/kit/feedback/CalloutChip` (see [feedback.md](feedback.md#calloutchip)).
- Counts: solid primary `sm` inside a Filters button (`FilterButton` from `@/components/kit/lists/FilterButton` already renders it) or next to a menu item; neutral soft for a plain total ("1,204 matches"). Format with `formatBadgeCount` or the format family's `formatCount`, never a bare number above 999. A badge whose content is a count (a number, or text with digits and no letters, such as `99+`; `isCountContent` in `@/lib/kit/status/count`) takes tabular figures by itself, also when a screen-reader label follows the count (`{formatBadgeCount(n)}<span className="sr-only"> unseen</span>`, as in the header's Admin menu); words keep proportional ones, so `Pre-verified` keeps its narrow hyphen.
- Failure reasons and other problems: destructive soft, `sm`.

Do:

- Keep labels short and in sentence case. Badges never wrap.
- Wrap a badge that needs explaining in `TapTooltip` (`@/components/tap-tooltip`), so the explanation opens on tap as well as hover.

Don't:

- Don't use `@/components/ui/badge` in new code; it stays only as the shadcn primitive. Don't edit it to add tones.
- Don't add `text-white`, `bg-blue-500`, `text-orange-500` or other palette classes to a badge, and don't stack `className` overrides for height and padding (`h-5 px-1.5 py-0 text-xs`); pick a `size`.
- Don't use red for something that is not an error or a rejection, such as the Admin role.
- Don't make a badge clickable. A removable or toggleable chip is a control (see the lists and controls references), not a badge.

Gallery anchors: `/admin/design#status-badge`, `/admin/design#status-badge-uses`

## ReportStatusBadge

A data report's state on My reports and the admin queue, in the same status language: Pending (clock, neutral), Confirmed (circled check, green) or Dismissed (circled cross, red). The names are the ones the report pages and the admin's Confirm report and Dismiss buttons already use.

```tsx
import { ReportStatusBadge } from '@/components/kit/status/ReportStatusBadge';

<ReportStatusBadge status={report.status} />;
```

- `size` as for Badge. It has no tooltip: the name is the whole message.

Don't:

- Don't build a report state from `Badge` or a solid fill; My reports and the admin queue both render this component.

Gallery anchor: `/admin/design#status-report-badge`

## JobStateBadge

A background job's state on the admin jobs page, and the state of a tournament's fetches and jobs in its progress panel. Waiting and finished work is neutral, a success green, work that is retrying or stalled amber, and a job that gave up red; each state has its own glyph, so it reads without its colour.

```tsx
import { JobStateBadge } from '@/components/kit/status/JobStateBadge';

<JobStateBadge state="retrying" />;
```

| State       | Glyph          | Tone        | Means                                          |
| ----------- | -------------- | ----------- | ---------------------------------------------- |
| `queued`    | clock          | neutral     | waiting and due                                |
| `delayed`   | calendar clock | neutral     | waiting until later, such as a retry's backoff |
| `retrying`  | turning arrow  | warning     | waiting to retry after an error                |
| `running`   | spinner circle | neutral     | claimed by the worker                          |
| `succeeded` | circled check  | success     | finished                                       |
| `failed`    | circled cross  | destructive | gave up                                        |
| `cancelled` | slashed circle | neutral     | cancelled by an admin, or dropped by its job   |
| `stalled`   | triangle       | warning     | waiting to be fetched with no job queued       |

- `state`: one of `JOB_BADGE_STATES` (`@/lib/kit/status/job`), whose `getJobStateCopy(state)` gives the name and tone.
- `size`: as for Badge, `sm` by default, the size a table row takes.
- The admin jobs list shows queued, delayed, running, succeeded, failed and cancelled, by the queue counts' rule: a waiting job is queued once it is due and delayed until then, so one waiting out a retry's backoff is delayed. The progress panel's "Needs attention" list shows `retrying`, `failed` and `stalled`.

Don't:

- Don't spin the running glyph; it is a state, not a loading indicator.
- Don't build a job state from `Badge` by hand.

Gallery anchor: `/admin/design#status-job-state-badge`

## NotificationDot

The one "something new" dot: unseen reports on the Admin menu item, an unread report update, notes on an entity. One colour everywhere (`--notification`), with its own screen-reader text.

```tsx
import { NotificationDot } from '@/components/kit/status/NotificationDot';

// After a label, such as the header's Admin menu item:
<button type="button">
  Admin <NotificationDot label="Unseen reports" />
</button>

// On the corner of an avatar or icon button (the parent must be `relative`):
<span className="relative inline-flex">
  <OsuAvatar … />
  <NotificationDot placement="corner" label="Unread report updates" />
</span>
```

Props that matter:

- `label`: required; what is new, as screen readers should hear it.
- `placement`: `inline` (default) or `corner`, which pins it to the top-right of a `relative` parent with a ring in the page background. On a card or popover, pass `className="ring-card"` or `ring-popover`.

Do:

- Show the dot after the header's "Admin" dropdown label when there are unseen reports or other admin notifications, and the unseen count as a solid primary `sm` `Badge` with `formatBadgeCount` on the Reports item inside the menu. The admin home's own item is labelled "Admin".
- When the parent control is named with `aria-label`, put the news in that label too ("Admin notes (has notes)"); an `aria-label` hides the dot's own text.

Don't:

- Don't draw dots by hand or in a second colour (`bg-blue-500`, a yellow notes dot).
- Don't use the dot for status or as a bullet; it only means "new since you last looked".

Gallery anchor: `/admin/design#status-notification-dot`

## CircleDashedX

The Pre-rejected glyph, a lucide-style icon drawn locally because lucide has none: the outline of `circle-dashed-check` with the cross of `circle-x`. You rarely need it directly; `VerificationStatusIcon` uses it.

```tsx
import { CircleDashedX } from '@/components/kit/status/CircleDashedX';
```
