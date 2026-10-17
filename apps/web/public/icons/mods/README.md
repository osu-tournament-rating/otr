# Mod Icons

Source: <https://github.com/ppy/osu-web/tree/2b41065adeaebc5e918ef8599e815ab81ed27140/public/images/badges/mods>

`mod-*.svg` are osu-web's mod glyphs and `blanks/mod-icon.svg` its badge shape, unchanged. Both are masks: `ModIconset` fills the badge with the mod type's colour and the glyph with a darker shade of it, as osu-web's `resources/css/bem/mod.less` does. The names, types and colours are in `apps/web/lib/utils/mod-badges.ts`.

osu-web is licensed under the GNU Affero General Public License v3.0.
