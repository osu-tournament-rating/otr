# Design system

The site's design system as a Claude design system artifact: its tokens, type
scale, brand book, brand assets and a live copy of the component library
(`components/kit/`), each component with its guidelines and a preview. It is
built from this app's source, so it matches what the site ships.

The artifact: <https://claude.ai/artifact/7kZyJvW6eUSbsb3fVtm7kZ> (private;
share it from its page).

## What comes from where

| In the design system                   | From                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Colour, shadow, radius, spacing tokens | `app/globals.css`, with usage notes and layout spacing from `tokens.ts`         |
| Type scale                             | `tokens.ts`, checked against `components/kit/layout/Typography.tsx` by its test |
| Brand book and further sections        | `content/*.md`                                                                  |
| Asset groups                           | `public/` (logos, icons, decorations, images); notes in `content/assets/`       |
| Component bundle and stylesheet        | `components/kit/` and the parts it uses, built with the site's Tailwind config  |
| Component guidelines                   | The web-design skill's reference, the sections `components.ts` names            |
| Component previews                     | `content/components/<Name>/preview.html`, mirroring the admin design gallery    |

## Rebuilding

From `apps/web`:

```sh
bun run design-system          # writes design-system/out/project/
bun run design-system:check    # renders every preview in light and dark
```

The build needs no database or running site. It fails when globals.css has a
colour `tokens.ts` doesn't describe, when a component card names a reference
section that no longer exists, or when the bundle doesn't export a card's
component. The check fails on any console error, failed load or empty
preview, and leaves screenshots in `out/shots/`.

## Publishing

Publishing is done with Claude's Artifact tool; there is no API for it.

1. Build. If it lists assets that are new or changed, upload those files from
   `out/uploads/` to the artifact as assets, then record each returned id:
   `bun design-system/record.ts /icons/mods/mod-hidden.svg=<id> …`. Commit
   the updated `artifact.json` and build again.
2. Read the artifact's live `project/design-system.json` and keep its keys
   when publishing the built one, as the Design System type's instructions
   say; people can edit the system on its page.
3. Publish `out/project/` to the artifact: the index as the file, everything
   else under `project/` as files, with `components/index.d.ts` as
   `text/plain`.

## Changing it

- A new or renamed colour in globals.css: describe it in `COLOR_USAGE` in
  `tokens.ts`.
- A new kit component: add it to `components.ts` with its reference
  sections, and write its preview from the gallery specimen.
- A preview runs in the artifact's frame with the tokens, `bundle.css`,
  React and `window.OTR` already loaded. Write it as plain JavaScript with
  `React.createElement`, wrap it in `OTR.TooltipProvider`, and use only the
  gallery's demo data. Public image paths in it are pointed at the uploads.
