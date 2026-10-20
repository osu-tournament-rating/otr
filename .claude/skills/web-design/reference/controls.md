# Buttons, dialogs and forms

How the site lays out actions: text and icon buttons, the one admin menu per page and per row, dialogs and confirmations, and page forms.
Import each component from its own file under `@/components/kit/controls/`; the menu grouping helper lives in `@/lib/kit/controls/menu`.

- [Rules at a glance](#rules-at-a-glance)
- [Button](#button): text buttons in three sizes
- [IconButton](#iconbutton): every icon-only control
- [AdminMenu](#adminmenu): the one admin control in a detail hero
- [RowActionsMenu](#rowactionsmenu): the overflow menu on a row or card
- [ActionMenu and MenuAction](#actionmenu-and-menuaction): the menu both are built on
- [DialogTemplate](#dialogtemplate): every dialog that is not a confirmation
- [ConfirmDialog](#confirmdialog): confirms one consequential action
- [FormPanel, FormSection, FormGrid and FormActions](#formpanel-formsection-formgrid-and-formactions): page forms
- [FormFieldLabel](#formfieldlabel): a field label with the info button

## Rules at a glance

- Three heights, the ones `components/ui/button.tsx` already has:

  | Size      | Height | Use                                                                            |
  | --------- | ------ | ------------------------------------------------------------------------------ |
  | `sm`      | 32px   | Inside panels and heroes: section headers, rows, hero actions, menus, popovers |
  | `default` | 36px   | Form and dialog actions, page header actions                                   |
  | `lg`      | 40px   | List toolbars, beside the 40px search field and sort select                    |

  Nothing else: no `h-6`, `h-7`, `py-5` or `py-6` buttons, and no lifted buttons that grow a shadow and move on hover.

- One primary (blue, `default`) button per view: the action the view exists for. Everything else is `outline` or `ghost`.
- Red means the action deletes or overwrites data. A button or menu item that starts such an action is red text (`destructive`); only the button that carries it out, in the final confirm, is solid red (`destructive-confirm`, which ConfirmDialog renders for you). A destructive action is never blue.
- Every icon-only control is an IconButton: it has an accessible name, a tooltip that repeats it (except an X that closes or clears), and a hover fill.
- A detail page has one admin control, AdminMenu, in the hero's `adminActions`. A row or card has at most one RowActionsMenu. No clusters of unlabelled admin icons.
- A dialog is a DialogTemplate or a ConfirmDialog: 12px corners, 24px side padding, a header strip with a sentence-case title, a body, a footer strip with the actions on the right, and one backdrop (black at 50%, the same as every alert dialog and sheet).
- A page form is a PageHeader, then FormPanel with FormSections and FormActions. Notices are Callouts (`@/components/kit/feedback/Callout`).
- Sentence case for every label, title and menu item: "Edit tournament", not "Edit Tournament".
- Button and IconButton have no `'use client'`, so a server page can render them, for example drawn on a `Link` with `asChild`. AdminMenu, RowActionsMenu, ActionMenu, DialogTemplate and ConfirmDialog are client components, and menu actions hold functions and icon components, so build a menu and its dialogs inside a client component (the entity's admin view), never in a server page such as `app/tournaments/[id]/page.tsx`.

Gallery anchor: `/admin/design#controls`

## Button

The site's text button. It wraps the shadcn Button with the three sizes, a quiet red for destructive actions, a dark pill for cover art, a fill that stays while a menu or popover it opens is open, and a `pending` state. The hover fills (ghost included) and the solid red behind white text come from the shadcn variants.

```tsx
import { Button } from '@/components/kit/controls/Button';

<Button type="submit" pending={saving}>
  {saving ? 'Saving…' : 'Save changes'}
</Button>;

<Button variant="destructive" icon={Trash2}>
  Delete tournament
</Button>;

<Button asChild variant="outline" icon={ExternalLink}>
  <Link href={ACCEPTANCE_CRITERIA_URL}>Read our acceptance criteria</Link>
</Button>;
```

Props:

- `size`: `sm`, `default` or `lg` (see the table above).
- `variant`: see below.
- `icon`: a leading lucide icon, 16px. With `asChild` it still renders inside the child.
- `pending`: swaps the icon for a spinner, disables the button and sets `aria-busy`. Change the label too ("Saving…").
- `type`: defaults to `"button"`, so Cancel never submits a form by accident. Pass `type="submit"` on the submit button.
- `asChild`: draws the button on its child, such as a `Link` or `a`.
- `wrap`: lets a label that can be longer than a phone is wide wrap onto more lines instead of running out of its container, such as a cascade level's counts in the audit log ("46 matches: 45 verified, 1 rejected"). The size's height becomes a minimum, so a one-line label looks the same, and the label aligns left. Don't hand-write `h-auto whitespace-normal` on a Button. Gallery anchor: `/admin/design#controls-button-wrap`.

Variants:

| Variant               | Looks like                      | Use                                                                   |
| --------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `default`             | Solid blue                      | The one primary action of a form, dialog or page                      |
| `outline`             | Bordered                        | Secondary actions: Cancel, Back, Clear, a page's second action        |
| `ghost`               | Text, fills on hover            | Quiet actions inside a panel: Clear all, a Load more in an opened row |
| `destructive`         | Red text and border, no fill    | Starts an action that deletes or overwrites data; it opens a confirm  |
| `destructive-confirm` | Solid red (`destructive-solid`) | Only the final confirm in a dialog (ConfirmDialog already renders it) |
| `overlay`             | Dark pill, white in both themes | Only on cover art, like the beatmap hero's preview button             |

A list's own footer, "Load more" or "Show more", is [LoadMore](tables.md#loadmore), which draws an outline `sm` Button; don't build that footer from a ghost button.

Do:

- Keep the primary last in a row of buttons (right on desktop, top when they stack on phones).
- Name the action: "Delete tournament", "Save changes", "Submit tournament". Never "OK", "Yes" or "Confirm".

Don't:

- Don't import `Button` from `@/components/ui/button` in a page. It is the primitive the kit builds on: it has a fourth size (`icon`), a grey `secondary`, a solid red `destructive` that belongs only in the final confirm, and no `pending` or open-state fill. Its `ghost` fills on hover (`hover:bg-accent`), so a ghost button needs no hover fill of its own.
- Don't use large lifted buttons (`py-5 sm:py-6 text-base sm:text-lg shadow-lg hover:-translate-y-0.5`); a form's buttons are `default` size in FormActions.
- Don't use a grey `secondary` button for Clear or Reset; use `outline`.
- Don't make the button that opens a destructive action solid red, or blue. Use `destructive`, or an AdminMenu item.
- Don't recolour `AlertDialogAction` with `bg-destructive text-white`; use ConfirmDialog.
- Don't put white text on `bg-destructive`. Dark mode's `--destructive` (red-500) gives white 14px text only about 3.8:1, so `destructive-confirm` fills with `bg-destructive-solid` (`hover:bg-destructive-solid/90`): red-600 in dark mode and the usual destructive red in light. The shadcn `destructive` variants of `components/ui/button.tsx` and `components/ui/badge.tsx` use it too; any other solid red fill behind white text needs the same token.
- Don't hand-roll a spinner (`<Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting...`); use `pending`.

Gallery anchors: `/admin/design#controls-button-sizes`, `/admin/design#controls-button-variants`

## IconButton

The one icon-only button: a square (round on art) with a hover fill, an `aria-label`, and a tooltip that repeats it.

```tsx
import { IconButton } from '@/components/kit/controls/IconButton';

<IconButton label="Copy link" icon={Link2} onClick={copyLink} />;

<IconButton asChild label="View audit history" icon={History}>
  <Link href={`/audit/tournaments/${id}`} />
</IconButton>;

<DialogTrigger asChild>
  <IconButton label="Edit note" icon={PencilLine} />
</DialogTrigger>;
```

Props:

- `label`: required. The accessible name and the tooltip, in sentence case.
- `icon`: the lucide glyph. With `asChild` it is placed inside the child element.
- `tooltip`: tooltip text when it should differ from `label` (RowActionsMenu uses it to keep the tooltip short while the name says which row; the support heart uses it to leave "opens in a new tab" to the accessible name). `false` drops the tooltip, only for an X that closes a dialog or panel or clears a field: everyone knows it, and a tooltip on it is noise. `tooltipSide`: where it opens, `top` by default.
- `size`: `sm` (32px, the default), `default` (36px), `lg` (40px), matching the button heights.
- `variant`: `ghost` (default) muted icon that fills on hover; `outline` bordered, beside inputs and outline buttons; `overlay` the round dark pill on cover art.
- `destructive`: red icon and red fill on hover, for a single destructive action outside a menu, such as deleting one admin note. Ignored on `overlay`.
- `expanded`: makes it a disclosure toggle for content that expands in place, such as an audit row's details. It sets `aria-expanded` and drops the open-state fill: that fill stays on a ghost or outline button while the menu, popover or dialog it opens is open, and an expanded row is not an open menu (Radix Collapsible sets the same `data-state="open"`). Hover and focus still fill it. Keep the `label` the same in both states ("Details for Game 3"); `aria-expanded` says whether it is open. For a chevron that turns, add `className="[&>svg]:transition-transform aria-expanded:[&>svg]:rotate-180"`. The audit rows' `AuditRowToggle` (`components/audit/AuditRow.tsx`) is a live one: a constant "Details" label inside `CollapsibleTrigger asChild`.

```tsx
<IconButton
  label={`Details for ${game.name}`}
  icon={ChevronDown}
  expanded={open}
  onClick={() => setOpen((value) => !value)}
  className="[&>svg]:transition-transform aria-expanded:[&>svg]:rotate-180"
/>
```

Do:

- Put it inside `DialogTrigger`, `PopoverTrigger` or `DropdownMenuTrigger` with `asChild`. The tooltip lives inside IconButton, so this is the "tooltip wraps the trigger" rule already done. Its tooltip opens on hover and on keyboard focus (Tab, or arrows inside a group), but not when the menu, popover or dialog it opened hands focus back as it closes, by a click, Escape or a chosen item: the visitor is done with it. `components/ui/tooltip.tsx` does this for every tooltip by opening on focus only right after a navigation key, so don't pass `tooltip={false}` to silence it.
- Use `ghost` in section header strips, rows and dialog headers, and `outline` next to inputs.
- Give a section's main action, such as "Add matches" or "Add beatmaps", a labelled `<Button variant="outline" size="sm" icon={Plus}>`. Only on phones, where the strip is tight, does it shrink to an IconButton in the style of its neighbours: outline beside a sort control (`components/tournaments/TournamentMatchesAdminView.tsx`), ghost among ghost icons (`components/tournaments/TournamentBeatmapsAdminView.tsx`).

Don't:

- Don't wrap `<Button variant="ghost" size="icon" className="h-6 w-6 …">` in `SimpleTooltip` by hand: a 24px target with a home-made hover fill.
- Don't make a bare glyph clickable, and don't turn the icon blue on hover. Links that need more than an icon to explain them, such as the header's docs and API reference, are labelled items in a menu. The header's support heart is the one icon link that stays at the top right: it turns `text-support` pink and pulses on hover (`motion-safe:hover:animate-pulse`), as it always has (`components/header/SupportButton.tsx`). Beside it, the account avatar fills its 36px IconButton and, in place of the hover fill, grows a little on hover and presses in on click (`motion-safe:hover:scale-103 motion-safe:active:scale-97`), as it always has (`components/profile/AccountMenu.tsx`).
- Don't give an X that closes or clears a tooltip ("Close", "Clear search"); pass `tooltip={false}`. Every other icon-only button keeps its tooltip.
- Don't rely on the tooltip of a disabled IconButton: a disabled button gets no pointer events. Say why it is disabled somewhere visible, such as an AdminMenu item's `description`.

Gallery anchor: `/admin/design#controls-icon-button`

## AdminMenu

The one admin control on a detail page: an outline "Admin" button with a muted shield, in the hero's `adminActions` slot, that opens every admin action for the entity as a labelled list. Destructive items sit last, after a separator, in red. Render it only for admins.

```tsx
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';

const [editing, setEditing] = useState(false);
const [deleting, setDeleting] = useState(false);

<DetailHero
  title={tournament.name}
  adminActions={
    isAdmin && (
      <AdminMenu
        notification={notes.length > 0 ? 'Has admin notes' : undefined}
        actions={[
          { label: 'Edit tournament', icon: PencilLine, onSelect: () => setEditing(true) },
          { label: 'Admin notes', icon: NotebookPen, trailing: <Badge size="sm">{formatBadgeCount(notes.length)}</Badge>, onSelect: openNotes },
          { label: 'Reset automated checks', icon: RotateCcw, group: 'data', onSelect: () => setResetting(true) },
          { label: 'Refetch match data', icon: RefreshCw, group: 'data', onSelect: () => setRefetching(true) },
          { label: 'Delete tournament', icon: Trash2, destructive: true, onSelect: () => setDeleting(true) },
        ]}
      />
    )
  }
  actions={
    <IconButton asChild variant="outline" label="View audit history" icon={History}>
      <Link href={`/audit/tournaments/${tournament.id}`} />
    </IconButton>
  }
/>
<TournamentEditDialog open={editing} onOpenChange={setEditing} />
<ConfirmDialog open={deleting} onOpenChange={setDeleting} … />
```

Props:

- `actions`: MenuActions (see [ActionMenu and MenuAction](#actionmenu-and-menuaction)). Falsy entries are skipped, so `isLazer && { … }` works. With no visible actions the menu renders nothing.
- `title`: a muted line at the top of the menu. Leave it out in a hero: the title beside the button already names the entity, and the tournament and match heroes pass none.
- `header`: a richer top section, passed to ActionMenu (see below).
- `notification`: shows the one notification dot on the button; the string is its screen-reader text ("Has admin notes").
- `onArt`: the dark pill, for a hero with cover art.
- `label`: the button's text, "Admin". Keep it unless a page has two admin menus.
- `data-testid`: on the button; the menu content gets `{testid}-content`.

How dialogs open: render each dialog next to the menu, controlled by state, and open it from the item's `onSelect`. The menu runs `onSelect` after it has closed and focus is back on the Admin button, and DialogTemplate and ConfirmDialog return focus there when they close. Never nest a `Dialog` inside a menu item.

Do:

- Label every item with a verb and the noun: "Edit tournament", "Refetch match data", "Unlink pooled beatmaps".
- Group with `group`: edit and notes first, then data operations, then (automatically) the destructive group.
- Keep public actions (report, open on osu!, audio preview, audit history) in the hero's `actions`, not in the admin menu.

Don't:

- Don't build a row of admin icons in different colours, or a cluster of admin pills on art.
- Don't hide operations inside an edit dialog's button bar (Accept, Reset, Refetch and Delete icons beside Save); each is a menu item with its own ConfirmDialog.
- Don't colour admin items or their icons; icons are muted, only destructive items are red.
- Don't put audit history in the admin menu or behind an admin check. Audit pages are public; the link belongs in the hero's `actions` for everyone, on tournaments, matches and beatmaps, and in each game's and score's RowActionsMenu.

Gallery anchors: `/admin/design#controls-admin-menu`, `/admin/design#controls-on-art`

## RowActionsMenu

The overflow menu at the end of a row or card: one "…" IconButton in place of a cluster of icons, such as on each game and score of a match page. Its items work exactly like AdminMenu's.

```tsx
import { RowActionsMenu } from '@/components/kit/controls/RowActionsMenu';

<RowListItem
  title={<Link href={`/beatmaps/${game.beatmap.osuId}`}>{beatmapLabel}</Link>}
  trailing={
    <RowActionsMenu
      itemName={beatmapLabel}
      actions={[
        {
          label: 'Report an issue',
          icon: Flag,
          onSelect: () => setReporting(true),
        },
        {
          label: 'View audit history',
          icon: History,
          href: `/audit/games/${game.id}`,
        },
        isAdmin && {
          label: 'Edit game',
          icon: PencilLine,
          group: 'admin',
          onSelect: () => setEditing(true),
        },
        isAdmin && {
          label: 'Delete game',
          icon: Trash2,
          destructive: true,
          onSelect: () => setDeleting(true),
        },
      ]}
    />
  }
/>;
```

Props:

- `actions`: as AdminMenu.
- `itemName`: what the row is. It names the button for screen readers ("Actions for Hidden Chamber [Insane]") and heads the menu, truncated at the width the items set. Always set it in a list, or every button is just "Actions", and keep it unique per row: two games on the same beatmap need what tells them apart, or a screen reader's list of buttons shows two identical names. A game card's menu is "Game 3", its place in the match, since the beatmap's name is on the card beside it.
- `label`: the tooltip, "Actions" by default.
- `notification`: as AdminMenu's. It puts the one notification dot on the "…" button's corner and adds its text to the button's accessible name ("Actions for Game 3, Has admin notes"). Pair it with a count `Badge` as the matching item's `trailing`, so the menu says what is new.
- Public items (report, audit history) are for everyone; gate only the admin items with `isAdmin &&`. With every admin item hidden, the menu still holds the public ones.
- Order: the public items first, in the heroes' order ("Report an issue", "View audit history", "View on osu!"), then the admin items in their own `group: 'admin'` (edit, admin notes), then data operations, then the destructive group. The game and score menus (`components/games/GameActionsMenu.tsx`, `ScoreActionsMenu.tsx`) follow it.
- `onArt`: the round dark pill, for a card header on cover art (`components/games/GameCardHeader.tsx`).
- `size`: `sm` (default) or `default`.

Don't:

- Don't repeat a cluster of external-link, report, audit, notes and edit icons on every card.
- Don't put it inside a whole-row link; a linked row holds no other button.

Gallery anchors: `/admin/design#controls-row-actions-menu`, `/admin/design#controls-on-art`

## ActionMenu and MenuAction

AdminMenu and RowActionsMenu are ActionMenu with a fixed trigger. Use ActionMenu directly only for a different trigger.

```tsx
import {
  ActionMenu,
  type MenuAction,
} from '@/components/kit/controls/ActionMenu';

<ActionMenu
  trigger={
    <Button variant="outline" size="sm">
      More
    </Button>
  }
  actions={actions}
/>;

// A rich header above the items, such as an account's avatar, name and role:
<ActionMenu
  header={
    <span className="flex items-center gap-3">
      <OsuAvatar … />
      <span className="flex min-w-0 flex-col items-start gap-1">
        <span className="truncate font-semibold">{player.username}</span>
        <ProfileRoleBadge scopes={scopes} />
      </span>
    </span>
  }
  trigger={…}
  actions={accountActions}
/>;
```

ActionMenu props besides `trigger` and `actions`:

- `title`: the muted line at the top (AdminMenu's `title`, RowActionsMenu's `itemName`). It takes the width the items give the menu and truncates past it (`w-0 min-w-full truncate`), so a long name never widens a menu of short items.
- `header`: richer content above `title` and the items, over a separator, in 14px text up to 288px wide. It is not focusable, so links and buttons belong in `actions`. AdminMenu passes it through.
- `align`, `side`, `contentClassName`, `data-testid` (on the menu content).

MenuAction fields:

- `label` (required), `icon` (muted, red on a destructive item).
- `onSelect`: runs after the menu has closed and focus has returned to the trigger.
- `href`: makes the item a link (`next/link`, not prefetched). `external` opens it in a new tab with an external-link glyph and "(opens in a new tab)" for screen readers.
- `destructive`: red, and moved into the last group.
- `disabled` with `description`: a muted second line that says why the action is off. The label and icon dim; the description keeps full contrast so it stays readable. A description wraps at 240px (`max-w-60`), so a long reason never widens the menu past a 390px screen.
- `trailing`: a count `Badge` or a `NotificationDot` on the right.
- `group`: items with the same group sit together between separators, in order of first appearance.
- `hidden`: leaves the item out. `id`: the React key when two items share a label. `testId`.

`groupMenuActions(actions)` in `@/lib/kit/controls/menu` does the grouping (unit-tested): groups by first appearance, destructive last, hidden and falsy entries dropped.

Gallery anchor: `/admin/design#controls-action-menu`

## DialogTemplate

Every dialog that is not a confirmation: edit forms, report forms, report details, admin notes, merge pickers. A header strip with the title and a close button, a body that scrolls, and a footer strip with the actions on the right.

```tsx
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { Form } from '@/components/ui/form';

<Form {...form}>
  <DialogTemplate
    open={open}
    onOpenChange={setOpen}
    title="Edit tournament"
    description={`Editing ${tournament.name}`}
    size="lg"
    onSubmit={form.handleSubmit(save)}
    footer={
      <>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" pending={form.formState.isSubmitting}>
          Save changes
        </Button>
      </>
    }
  >
    <FormField … />
  </DialogTemplate>
</Form>;
```

Props:

- `open`, `defaultOpen`, `onOpenChange`: as Radix Dialog. Omit `open` and pass `trigger` for a self-contained dialog.
- `trigger`: the button that opens it, wrapped in `DialogTrigger`. Leave it out when an AdminMenu item opens the dialog.
- `title`: sentence case, 16px semibold. `description`: one or two muted sentences under it.
- `children`: the body, 24px padding, children 16px apart. It scrolls when the dialog is taller than the screen; the header and footer stay.
- `footer`: the actions, right-aligned, primary last. `footerStart`: muted text or a quiet action on the left, such as "Pin this beatmap permanently?" beside the beatmap edit dialog's final buttons.
- `notice`: a Callout or error line above the actions that must stay in view, such as "Saving is permanent" in the beatmap edit dialog.
- `size`: `sm` 448px, `md` 512px (default), `lg` 672px for long forms.
- `onSubmit`: makes the body and footer one `<form>`, so a `type="submit"` button in `footer` submits it and Enter in a field works.
- `closable`: `false` hides the close button and ignores clicks outside. Escape still closes, so guard unsaved changes in `onOpenChange`.
- `bodyClassName`: classes for the body, such as a tighter gap.

Anatomy, shared with ConfirmDialog through `DIALOG_CLASSES` (and `DIALOG_SIZE_CLASSES` for the widths): header `border-b px-6 py-4`, body `p-6`, footer `border-t bg-muted/30 px-6 py-4`, surface `rounded-xl border bg-background shadow-lg`, backdrop `bg-black/50`. The close button is last in the DOM, so keyboard focus starts on the first field, and is drawn in the header's corner. `DialogFooterStrip` is the footer on its own (notice, start and actions), and `useReturnFocus()` gives the content's `onOpenAutoFocus` and `onCloseAutoFocus` handlers that return focus to whatever had it when the dialog opened, such as a menu's trigger (Radix would return it only to the dialog's own trigger).

Do:

- Ask before discarding edits: open a ConfirmDialog ("Discard your changes?") from `onOpenChange` when the form is dirty.
- Keep one dialog per task. A multi-step flow (edit, then confirm the edit) swaps the footer's buttons rather than opening a second dialog. The one dialog that may open on top of another is the discard confirmation above.

Don't:

- Don't pad `DialogContent` yourself (`className="p-4"`) or build your own header and footer strips.
- Don't use Title Case ("Report Details") or prefix titles with "Confirm" ("Confirm delete tournament").
- Don't use the shadcn `DialogContent` directly: it has no header and footer strips and pads itself. Its backdrop is the same black at 50% as every dialog, alert dialog and sheet, so never override a backdrop.

Gallery anchor: `/admin/design#controls-dialog-template`

## ConfirmDialog

Confirms one consequential action before it runs: delete, reset, refetch, merge, discard. Built on AlertDialog, so it cannot be dismissed by clicking outside, and Cancel takes the initial focus. Its confirm button is the only solid red button on the site.

```tsx
import { DELETE_CASCADE_DESCRIPTION } from '@/components/admin-forms/adminFormFields';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';

<ConfirmDialog
  open={deleting}
  onOpenChange={setDeleting}
  title="Delete this tournament?"
  // "This action will cascade to all children. …" and "This action cannot be undone."
  description={DELETE_CASCADE_DESCRIPTION}
  confirmLabel="Delete tournament"
  pendingLabel="Deleting…"
  errorText="Failed to delete tournament"
  onConfirm={async () => {
    await orpc.tournaments.admin.delete({ id: tournament.id });
    toast.success('Tournament deleted successfully');
    router.replace('/tournaments');
  }}
/>;
```

Props:

- `title`: a question in sentence case: "Delete this tournament?", "Reset automated checks?", "Discard your changes?".
- `description`: what happens and whether it can be undone. Paragraphs, not `<br />`. Reuse the sentences the site already has for that action.
- `children`: options under the description, such as a checkbox ("Reset verified and rejected data").
- `confirmLabel`: verb and noun, matching the action that opened it. `pendingLabel`: shown with a spinner while `onConfirm` runs. `cancelLabel`: "Cancel" by default ("Keep editing" for a discard).
- `onConfirm`: return a promise and the dialog stays open with a spinner (Cancel and Escape disabled) until it settles. It closes when the promise resolves; when it rejects, it stays open and shows `errorText` ("Something went wrong. Try again." by default; pass the action's own message, such as "Failed to delete match"). Show your own success toast inside `onConfirm`.
- `tone`: `destructive` (default, solid red confirm) for anything that deletes or overwrites data, including a refetch, which can lose a match's data if osu! has since deleted it; `default` (blue) for a consequential action that loses nothing, such as continuing a submission without beatmaps.
- `trigger`: for a self-contained confirm; otherwise control it with `open` from an AdminMenu item.
- `confirmDisabled`: holds the confirm button until a required option is set.

Don't:

- Don't write "Are you sure you want to …?" with bullet lists of side effects; say what happens in plain sentences.
- Don't label the confirm "Confirm", "OK" or "Continue".
- Don't use a plain `Dialog` for a confirmation, merges included.

Gallery anchor: `/admin/design#controls-confirm-dialog`

## FormPanel, FormSection, FormGrid and FormActions

The layout of a page form, such as tournament submission or registrant filtering: the standard PageHeader, any page notice the page already has as a Callout, then one panel holding the form. Sections are split by section header strips, and the actions sit in a strip at the bottom right.

```tsx
import {
  FormActions,
  FormGrid,
  FormPanel,
  FormSection,
} from '@/components/kit/controls/FormPanel';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { Form } from '@/components/ui/form';

<PageFrame>
  <PageHeader
    icon={Upload}
    title="Tournament submission"
    description="Use this form to submit a new tournament for verification and tracking."
  />
  <Form {...form}>
    <FormPanel onSubmit={form.handleSubmit(submit)} data-testid="tournament-submission-form">
      <FormSection icon={Trophy} title="Information">
        <FormGrid>
          <FormField … />
          <FormField … />
        </FormGrid>
        <FormField … />
      </FormSection>
      <FormSection icon={Database} title="Data">
        …
      </FormSection>
      <FormActions>
        <Button variant="outline" onClick={() => form.reset()}>Clear</Button>
        <Button type="submit" pending={submitting}>Submit tournament</Button>
      </FormActions>
    </FormPanel>
  </Form>
</PageFrame>;
```

Parts:

- FormPanel: a Panel holding the `<form>`. Props other than `panelClassName` go to the form (`onSubmit`, `noValidate`, `data-testid`). It renders no `Form` provider; wrap it in shadcn's `Form` for react-hook-form.
- FormSection: a group (`role="group"`, named by its title) with a SectionHeader strip and the fields 16px apart in 16px padding. Takes `icon` (muted), `title`, `level`, `description` (one muted line above the fields), `infoText` and `actions` (passed to the strip), `bodyClassName`. Sections after the first get a divider.
- FormGrid: fields side by side, one column on phones. `columns` 2 (default), 3 (two from `sm`, three from `lg`) or 4; 4 is for short fields such as CS, HP, OD and AR in the beatmap edit dialog and keeps two columns on phones. `1` stacks the fields at every width with the grid's 16px gap. Fields align to the top, so an error under one does not shift its neighbour.
- FormActions: the bottom strip. `default`-size buttons on the right with the primary last; `start` holds a muted note on the left. On phones the buttons stack full width with the primary on top.

Notices: a page-level notice is a Callout between the PageHeader and the panel; a notice about one section is a Callout at the top of that FormSection; a field's help is its FormFieldLabel `info` or a `FormDescription`; errors are `FormMessage`.

Do:

- Use the shadcn `Input`, `Textarea`, `Select` and `Checkbox` as they are.
- Give each field the rules its schema has: required or optional, the options it allows, its minimum and maximum, and its format (`lib/orpc/schema/tournamentSubmission.ts`, `lib/validation-schema.ts`, `components/filtering/FilteringForm.tsx`). The forum post URL is required and accepts only links that start with `https://osu.ppy.sh/community/forums/topics/` or `https://osu.ppy.sh/wiki/en/Tournaments/`; lobby sizes are 1v1 to 8v8; a rank restriction is a whole number of at least 1.
- Write validation messages as statements about the field, as the site's schemas do: "Tournament name is required", "Rank restriction must be a whole number", "Lobby size cannot exceed 8", "Matches cannot exceed 1,000". Name the field as its label does: "Forum post URL is required", not "Forum URL is required". The tournament fields' messages are shared constants in `@/lib/orpc/schema/tournamentMessages` (`RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE`, `maxMatchIdsMessage(n)` and the rest), safe on the client; import them rather than retyping them.
- Keep a page form's input across reloads with `useFormDraft(form, name, emptyValues)` from `@/lib/hooks/useFormDraft`, as tournament submission and registrant filtering do. It saves to the tab's session storage and forgets the draft once the form is back to `emptyValues`, the same object as the form's `defaultValues`: tournament submission's ends on a successful submit or Clear, and registrant filtering's, which keeps its input after a run, on Reset. A reload that picks up a new release then costs nothing. Dialogs don't use it.
- Keep a form's existing labels and placeholders, and the help that adds something, when it moves onto these parts. Add a notice or help line only when the page already says it, and drop help and captions that only restate the label, placeholder or hint: "Choose the option that best describes the issue." under a Reason select, or "Include anything that may help an admin review the report." under a textarea whose placeholder says what to add.

Don't:

- Don't centre a blue title above the form or stack a padded card inside the page (`px-4 py-4 sm:px-6 sm:py-6 lg:px-8`).
- Don't hand-build section headings with `size-6 text-primary` icons and `text-lg sm:text-xl` titles; FormSection uses the standard strip.
- Don't restyle inputs (`border-2 shadow-sm bg-card focus-visible:ring-primary`).
- Don't build notices from palette classes (`border-orange-500/50 bg-orange-500/15`); use Callout.

Admin edit dialogs share their parts in `components/admin-forms/adminFormFields.tsx`: `VerifyChildrenChoices` (with `VERIFY_CHILDREN_TITLE` and `VERIFY_CHILDREN_DESCRIPTION`), `LabelSelectContent` and `VerificationStatusSelectContent` for enum selects (`ALL_RULESET_LABELS` is every ruleset, `mania (other)` included, for admin pickers; the status picker shows each state's glyph and is the one the tournament, match, game and score dialogs use), `flagOptions` and `combineFlags` for bitflag fields, `changedFieldClass` for a field the admin changed, `EDITED_FIELD_HINT` ("Edited", the FormFieldLabel `hint` on an osu! field an admin edited earlier, which refetches keep; a row of fields that shows it uses FormFieldLabel throughout; `@/lib/kit/format/edited-fields` names each such field), and `DELETE_CASCADE_DESCRIPTION`, the delete confirmations' shared wording. `components/admin-forms/ResetEditedFieldsDialog.tsx` is the "Reset to osu! values" confirmation: a `data` item in the match's AdminMenu or the game's or score's RowActionsMenu, shown only while `hasEditedFields` is true, opens it with every edited field ticked. Import them from there rather than copying them into a dialog. The tournament submission form and edit dialog share their own pickers in `components/tournaments/TournamentFieldOptions.tsx`: `RulesetSelectContent` (`includeManiaOther` for admins; `leading` for options above the rulesets, such as the settings page's "Most played (taiko)" and a `SelectSeparator`), `LobbySizeSelectContent` and `RejectionReasonChips`.

Gallery anchor: `/admin/design#controls-form-layout`

## FormFieldLabel

A field label with the one info button for help and an optional muted hint on the right, such as a unit ("mm:ss" in the beatmap edit dialog), a range ("100 – 5,000" in registrant filtering) or a format ("IDs or URLs, one per line" in tournament submission). Inside a shadcn `FormItem` it is that field's `FormLabel`; outside react-hook-form (a filter, a settings toggle, a field held in plain state) pass `htmlFor` with the control's id.

```tsx
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';

<FormItem>
  <FormFieldLabel info="Lobby prefix such as OWC2024">
    Abbreviation
  </FormFieldLabel>
  <FormControl>
    <Input {...field} />
  </FormControl>
  <FormMessage />
</FormItem>;
```

Props:

- `children`: the label text, sentence case. It turns red with the field's error, from `FormLabel`.
- `info`: the explanation behind an InfoButton (its `md` size, the one beside 14px text), which opens on tap, hover and focus. `infoLabel` names it; it defaults to "About {label}", lower-cased mid-sentence ("About rank restriction"). Write it as a short fragment with no full stop; see [InfoButton](layout.md#infobutton).
- `hint`: muted text on the right. `hintId` gives it an id, so the control can point `aria-describedby` at it, such as a "Required" hint: `hint="Required" hintId={hintId}`, not a hand-made `<span id>` inside `hint`.
- `htmlFor`: the id of the control it labels, for a field outside a `FormItem`. It then renders the plain `Label` (`FormLabel` only works inside a form field). `invalid` turns it red, as a field error does inside a form.
- `groupId`: labels a group of controls, such as a `RadioGroup`, that a `<label>` can't point at. The label is plain text with this id, in the same 20px row and text style, and the group takes `aria-labelledby={groupId}`; each option keeps its own `Label`. `invalid` works here too.

```tsx
const id = useId();

<FormFieldLabel htmlFor={id} hint="Any">
  Lobby size
</FormFieldLabel>
<Select value={lobbySize} onValueChange={setLobbySize}>
  <SelectTrigger id={id}>…</SelectTrigger>
  …
</Select>
```

```tsx
// The admin home's Priority (app/admin/AdminDashboardClient.tsx).
const labelId = useId();

<FormFieldLabel groupId={labelId}>Priority</FormFieldLabel>
<RadioGroup aria-labelledby={labelId} value={priority} onValueChange={…}>
  …
</RadioGroup>
```

The label row is 20px tall with or without the info button or hint, so fields side by side in a FormGrid keep their inputs level.

Don't:

- Don't use a circled "?" label or a hover-only info tooltip beside a label; use `info`.
- Don't give a field an `info` that restates its label, placeholder or hint, such as "The ruleset the tournament is played in" beside Ruleset or "Players below this rating will be filtered out" beside Minimum rating. Help is for a fact the field does not show, such as Abbreviation's lobby prefix or Rank restriction's "Use 1 for open rank"; most fields need none. A short fact that fits beside the label is a `hint` instead.
- Don't label a radio group with a bare `<Label id>`; it is 14px tall where every other field label is 20px. Use `groupId`.
- Don't mix FormFieldLabel and a bare `FormLabel` in one FormGrid row; the bare label is shorter and its input sits 6px higher.

Gallery anchors: `/admin/design#controls-form-field-label`, `/admin/design#controls-form-layout`
