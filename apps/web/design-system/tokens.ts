/**
 * The design system's tokens, read from the site's own stylesheet
 * (`app/globals.css`) so the two never drift. Values come from the CSS; this
 * file only adds what CSS can't say: where each token is used, the layout
 * spacing the web-design skill states, and the type scale.
 */

/**
 * Every colour custom property declared in globals.css' `:root` block, with
 * where it is used, in the order the system lists them. A colour added to
 * globals.css needs an entry here, or the build and its test fail.
 */
export const COLOR_USAGE: Record<string, string> = {
  background:
    'Page background behind every panel; also the dialog surface and the chart tooltip card.',
  card: 'Panel surface in light mode (with shadow-sm), the site header bar. In dark mode panels use muted at 75% instead, flat.',
  muted:
    'Grey panels and tinted strips: table header strip, dialog footer (at 30%), dark-mode panels (at 75%).',
  popover: 'Popovers, dropdown menus, selects and command palette.',
  secondary: 'Secondary button fill.',
  accent:
    'Hover fill on ghost controls and menu items, tooltip surface, skeleton bars.',
  'game-frame': "Recessed frame around a game's scores on the match page.",
  'score-card': 'Score card inside the game frame.',
  foreground:
    'Body text on background, card, muted and popover; 11:1 or more on every surface in both themes.',
  'card-foreground': 'Text on card.',
  'popover-foreground': 'Text on popover.',
  'secondary-foreground': 'Text on secondary buttons.',
  'accent-foreground': 'Text on accent (hovered items, tooltips).',
  'muted-foreground':
    'Muted text: labels, captions, column headers, section icons. 4.7:1 on muted and popover in light, 5.9:1 in dark. Not on accent: use accent-muted-foreground there.',
  'accent-muted-foreground':
    'Muted text on accent (tooltips), where muted-foreground falls under 4.5:1. 4.7:1 light, 5.1:1 dark.',
  border:
    'Hairline on panels, tiles, dividers and table rows. Default border colour for every element.',
  input: 'Input and select borders.',
  ring: 'Focus ring, drawn at 50% as a 3px ring (focus-visible).',
  primary:
    'Brand blue for icons, borders, the focus ring and selected tints; 3:1 on every surface. Never text (use link) and never behind white text in dark mode (use primary-solid).',
  'primary-solid':
    'Fill behind white text: primary buttons, solid badges, selected days. White on it is 4.5:1 in both themes.',
  'primary-foreground': 'White text, only on primary-solid.',
  link: 'Blue text: links and row titles on hover. 4.5:1 on background, card and muted in both themes (dark is the original brand blue, 6.3:1).',
  destructive:
    'Red for destructive icons, borders and outlines (Tailwind red-600 / red-500).',
  'destructive-solid':
    'Solid red fill behind white text: only the final destructive confirm (red-600 in both themes).',
  'destructive-foreground':
    'Red text (red-800 / red-400): 7.4:1 light, 5.6:1 dark on muted and popover. Not on accent in dark mode (3.9:1).',
  'color-success':
    'Success fills, borders and icons (green-600 / green-400). On a solid success fill, text is green-950.',
  'color-success-foreground':
    'Success text, such as a rating rise (green-800 / green-400).',
  'color-warning': 'Warning fills, borders and icons (amber-600 / yellow-400).',
  'color-warning-foreground': 'Warning text (amber-800 / yellow-400).',
  warning: 'Alias of color-warning.',
  'warning-foreground': 'Alias of color-warning-foreground.',
  'verification-verified':
    'Verified and Pre-verified icon and chart fill (Pre-verified adds a dashed outline).',
  'verification-rejected':
    'Rejected and Pre-rejected icon and chart fill (Pre-rejected adds a dashed outline).',
  'verification-neutral':
    'Pending icon and the "Not in ratings yet" chart bar.',
  'callout-info': 'Info callout fill (slate, not brand blue).',
  'callout-info-border': 'Info callout border.',
  'callout-info-foreground': 'Info callout text and icon, on callout-info.',
  'callout-warning': 'Warning callout fill.',
  'callout-warning-border': 'Warning callout border.',
  'callout-warning-foreground':
    'Warning callout text and icon, on callout-warning.',
  'callout-danger': 'Danger callout fill.',
  'callout-danger-border': 'Danger callout border.',
  'callout-danger-foreground':
    'Danger callout text and icon, on callout-danger.',
  notification: 'The one notification dot colour.',
  support: "The header's support heart on hover, the pink it always had.",
  'series-1':
    'Categorical chart series 1, the brand blue stepped to clear 3:1 on light cards. Series take this palette in order and never cycle.',
  'series-2': 'Categorical chart series 2.',
  'series-3': 'Categorical chart series 3.',
  'series-4': 'Categorical chart series 4.',
  'series-5': 'Categorical chart series 5.',
  'series-6': 'Categorical chart series 6.',
  'series-7': 'Categorical chart series 7.',
  'series-8':
    'Categorical chart series 8. A ninth series folds into series-other.',
  'series-other': 'The "Other" series or bucket.',
  'match-red': 'Red team edge, tint, swatch and chart line.',
  'match-red-foreground': 'Red team text.',
  'match-blue': 'Blue team edge, tint, swatch and chart line.',
  'match-blue-foreground': 'Blue team text.',
  'match-no-team': 'Scores with no team.',
  'tier-elite-grandmaster':
    'Elite Grandmaster tier name (text) and chart mark.',
  'tier-grandmaster': 'Grandmaster tier name and chart mark.',
  'tier-master': 'Master tier name and chart mark.',
  'tier-diamond': 'Diamond tier name and chart mark.',
  'tier-emerald': 'Emerald tier name and chart mark.',
  'tier-platinum': 'Platinum tier name and chart mark.',
  'tier-gold': 'Gold tier name and chart mark.',
  'tier-silver': 'Silver tier name and chart mark.',
  'tier-bronze': 'Bronze tier name and chart mark.',
  'score-grade-ss': 'SS grade chart mark (keeps the osu! badge hue).',
  'score-grade-s': 'S grade chart mark (osu! badge hue).',
  'score-grade-a': 'A grade chart mark (osu! badge hue).',
  'score-grade-b':
    'B grade chart mark; B to D are a grey ramp that recedes toward the card.',
  'score-grade-c': 'C grade chart mark.',
  'score-grade-d': 'D grade chart mark.',
  'mod-nm':
    'No mod (NM) mark and solid mod pill; black text on the solid fill.',
  'mod-hd':
    'Hidden (HD) mark and solid mod pill; black text on the solid fill.',
  'mod-hr':
    'Hard Rock (HR) mark and solid mod pill; black text on the solid fill.',
  'mod-dt':
    'Double Time (DT) mark and solid mod pill; black text on the solid fill.',
  'mod-ht':
    'Half Time (HT) mark and solid mod pill; black text on the solid fill.',
  'mod-ez': 'Easy (EZ) mark and solid mod pill; black text on the solid fill.',
  'mod-fl':
    'Flashlight (FL) mark and solid mod pill; black text on the solid fill.',
  'mod-hdhr': 'HD + HR mark and solid mod pill; black text on the solid fill.',
  'mod-ezhd': 'EZ + HD mark and solid mod pill; black text on the solid fill.',
  'mod-ezdt': 'EZ + DT mark and solid mod pill; black text on the solid fill.',
  'mod-hdfl': 'HD + FL mark and solid mod pill; black text on the solid fill.',
  'mod-hddt': 'HD + DT mark and solid mod pill; black text on the solid fill.',
  'mod-sd':
    'Sudden Death (SD) mark and solid mod pill; black text on the solid fill.',
  'mod-td':
    'Touch Device (TD) mark and solid mod pill; black text on the solid fill.',
  'mod-rx': 'Relax (RX) mark and solid mod pill; black text on the solid fill.',
  'mod-mr':
    'Mirror (MR) mark and solid mod pill; black text on the solid fill.',
  'mod-rd':
    'Random (RD) mark and solid mod pill; black text on the solid fill.',
  'mod-key':
    'Key-count mods (1K to 9K) mark and solid mod pill; black text on the solid fill.',
};

/** Custom properties in `:root` that are not colour tokens. */
const NON_COLOR = new Set([
  'radius',
  'header-height-px',
  'font-sans',
  'spacing',
  'tracking-normal',
  'shadow-2xs',
  'shadow-xs',
  'shadow-sm',
  'shadow',
  'shadow-md',
  'shadow-lg',
  'shadow-xl',
  'shadow-2xl',
]);

const SHADOW_USAGE: Record<string, string> = {
  'shadow-2xs': 'Faintest lift; used by a few one-off elements.',
  'shadow-xs': 'Buttons, inputs and select triggers.',
  'shadow-sm': 'Panels in light mode and the site header.',
  shadow: 'Default shadow (same as shadow-sm).',
  'shadow-md': 'Popovers, dropdown menus, select content and the skip link.',
  'shadow-lg': 'Dialogs and dropdown sub-menus.',
  'shadow-xl': 'Used by a few one-off elements.',
  'shadow-2xl': 'Strongest edge shadow; used by a few one-off elements.',
};

const RADIUS_USAGE: Record<string, string> = {
  'radius-sm': 'Menu and select items inside a popover (rounded-sm).',
  'radius-md':
    'Buttons, base inputs, popovers, menus, tooltips and rounded badges (rounded-md).',
  'radius-lg':
    'Tiles, kit inputs, callouts and skeleton blocks; also the base --radius.',
  'radius-xl': 'Panels and dialogs.',
};

/** Spacing the web-design skill states but CSS holds only as utility classes. */
const LAYOUT_SPACING: Token[] = [
  {
    name: 'panel-gap',
    value: '16px',
    usage:
      'Gap between panels at every width (PageFrame and grids inside it, gap-4).',
  },
  {
    name: 'panel-padding',
    value: '16px',
    usage: 'Padding inside a panel body (PanelBody, p-4) and a form section.',
  },
  {
    name: 'dialog-padding',
    value: '24px',
    usage:
      'Dialog body padding and the side padding of its header and footer strips.',
  },
  {
    name: 'page-gutter',
    value: '16px',
    usage:
      'Side margin on phones; it widens to 20px from sm. Set once by the root layout, never by a page.',
  },
  {
    name: 'page-top',
    value: '40px',
    usage:
      'Top offset above the first panel on desktop (24px on phones), and the space under the last panel.',
  },
];

/**
 * The type scale. `scale` names the `typeScale` entry in
 * components/kit/layout/Typography.tsx the style mirrors, and `at` whether it
 * is that entry's base size or its size from the `sm` breakpoint; the test
 * checks the two agree.
 */
export const TYPE_GROUPS: TypeGroup[] = [
  {
    name: 'Headings',
    family: 'sans',
    styles: [
      {
        name: 'page-title',
        scale: 'pageTitle',
        at: 'sm',
        fontSize: '30px',
        lineHeight: '36px',
        fontWeight: 700,
        letterSpacing: '-0.025em',
        sample: 'Tournaments',
        usage:
          "The page's h1 from sm up (PageHeader, DetailHero). Never larger.",
      },
      {
        name: 'page-title-phone',
        scale: 'pageTitle',
        at: 'base',
        fontSize: '24px',
        lineHeight: '32px',
        fontWeight: 700,
        letterSpacing: '-0.025em',
        sample: 'Tournaments',
        usage: "The page's h1 below sm.",
      },
      {
        name: 'section-title',
        scale: 'sectionTitle',
        at: 'base',
        fontSize: '16px',
        lineHeight: '24px',
        fontWeight: 600,
        sample: 'Mod distribution',
        usage: 'Panel and section headings (SectionHeader), dialog titles.',
      },
      {
        name: 'row-title',
        scale: 'rowTitle',
        at: 'base',
        fontSize: '16px',
        lineHeight: '24px',
        fontWeight: 500,
        sample: 'Corsace Open 2024',
        usage: 'The name on a row or entity tile.',
      },
    ],
  },
  {
    name: 'Text',
    family: 'sans',
    styles: [
      {
        name: 'page-description',
        scale: 'pageDescription',
        at: 'sm',
        fontSize: '16px',
        lineHeight: '24px',
        fontWeight: 400,
        sample: 'Every tournament o!TR has data for.',
        usage:
          'The line under a page title from sm up, in muted-foreground (14px below sm).',
      },
      {
        name: 'body',
        scale: 'body',
        at: 'base',
        fontSize: '14px',
        lineHeight: '20px',
        fontWeight: 400,
        sample: 'osu! · 1v1 · Open rank',
        usage:
          'Running text and table cells; muted-foreground for descriptions and row details.',
      },
    ],
  },
  {
    name: 'Labels',
    family: 'sans',
    styles: [
      {
        name: 'label',
        scale: 'label',
        at: 'base',
        fontSize: '12px',
        lineHeight: '16px',
        fontWeight: 500,
        sample: 'Peak rating',
        usage:
          'Field, column, tile and group labels (Eyebrow), in muted-foreground. 12px is the smallest size anywhere.',
      },
      {
        name: 'meta',
        scale: 'meta',
        at: 'base',
        fontSize: '12px',
        lineHeight: '16px',
        fontWeight: 400,
        sample: '1,368 of 1,368 scores rated',
        usage: 'Counts and notes beside a heading, in muted-foreground.',
      },
    ],
  },
  {
    name: 'Numbers',
    family: 'sans',
    styles: [
      {
        name: 'stat-value',
        fontSize: '20px',
        lineHeight: 1,
        fontWeight: 700,
        sample: '#1,234',
        usage: "A StatTile's number, with tabular figures.",
      },
      {
        name: 'stat-value-inline',
        fontSize: '18px',
        lineHeight: 1,
        fontWeight: 600,
        sample: '1,835',
        usage:
          "A StatTile's number in the inline layout, with tabular figures.",
      },
    ],
  },
];

export interface Token {
  name: string;
  value: string | Record<string, string>;
  usage: string;
}

export interface TypeStyle {
  name: string;
  scale?: string;
  at?: 'base' | 'sm';
  fontSize: string;
  lineHeight: string | number;
  fontWeight: number;
  letterSpacing?: string;
  sample: string;
  usage: string;
}

export interface TypeGroup {
  name: string;
  family: string;
  styles: TypeStyle[];
}

/** The custom properties declared in the block that opens at `opener`. */
export function readBlock(css: string, opener: RegExp): Map<string, string> {
  const match = opener.exec(css);
  if (!match) throw new Error(`globals.css has no block matching ${opener}`);
  let depth = 0;
  let end = match.index + match[0].length;
  for (let i = end - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = css
    .slice(match.index + match[0].length, end)
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const props = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    props.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return props;
}

/** Tailwind's palette (`--color-red-600` and friends) from its theme.css. */
export function readPalette(themeCss: string): Map<string, string> {
  const palette = new Map<string, string>();
  for (const [, name, value] of themeCss.matchAll(
    /--(color-[a-z]+-\d+):\s*([^;]+);/g
  )) {
    palette.set(name, value.trim());
  }
  return palette;
}

const toPx = (value: string): number => {
  const m = /^(-?[\d.]+)(px|rem)$/.exec(value.trim());
  if (!m) throw new Error(`not a px or rem length: ${value}`);
  return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
};

export function buildTokens(globalsCss: string, tailwindThemeCss: string) {
  const light = readBlock(globalsCss, /(^|\n):root,\s*\.theme-light\s*\{/);
  const dark = readBlock(globalsCss, /\n\.dark\s*\{/);
  const inline = readBlock(globalsCss, /\n@theme inline\s*\{/);
  const palette = readPalette(tailwindThemeCss);

  for (const name of light.keys()) {
    if (!(name in COLOR_USAGE) && !NON_COLOR.has(name)) {
      throw new Error(
        `globals.css declares --${name}, which the design system doesn't know. Add it to COLOR_USAGE in design-system/tokens.ts with where it is used.`
      );
    }
  }

  const resolve = (value: string): string => {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (ref) {
      if (ref[1] in COLOR_USAGE) return `{${ref[1]}}`;
      const fromPalette = palette.get(ref[1]);
      if (fromPalette) return fromPalette;
      throw new Error(`can't resolve ${value}`);
    }
    return value.startsWith('#') ? value.toLowerCase() : value;
  };

  const colors: Token[] = Object.entries(COLOR_USAGE).map(([name, usage]) => {
    const lightValue = light.get(name);
    if (lightValue === undefined) {
      throw new Error(
        `COLOR_USAGE names --${name}, which globals.css no longer declares.`
      );
    }
    const value: Record<string, string> = { light: resolve(lightValue) };
    const darkValue = dark.get(name);
    if (darkValue !== undefined) value.dark = resolve(darkValue);
    return { name, value, usage };
  });

  const shadows: Token[] = Object.entries(SHADOW_USAGE).map(([name, usage]) => {
    const value = light.get(name);
    if (!value) throw new Error(`globals.css has no --${name}`);
    return { name, value, usage };
  });

  const basePx = toPx(light.get('radius') ?? '');
  const radius: Token[] = Object.entries(RADIUS_USAGE).map(([name, usage]) => {
    const formula = inline.get(name) ?? '';
    const m = /^calc\(var\(--radius\) ([+-]) (\d+)px\)$/.exec(formula);
    const px =
      formula === 'var(--radius)'
        ? basePx
        : m
          ? basePx + (m[1] === '+' ? 1 : -1) * Number(m[2])
          : NaN;
    if (Number.isNaN(px)) throw new Error(`can't read --${name}: ${formula}`);
    return { name, value: `${px}px`, usage };
  });
  radius.push({
    name: 'radius-full',
    value: '9999px',
    usage: 'Pill badges, avatars and notification dots.',
  });

  const spacingValue = light.get('spacing') ?? '';
  const headerFormula = light.get('header-height-px') ?? '';
  const headerSteps = /^calc\(var\(--spacing\) \* (\d+)\)$/.exec(headerFormula);
  if (!headerSteps) throw new Error(`can't read --header-height-px`);
  const spacing: Token[] = [
    {
      name: 'spacing',
      value: spacingValue,
      usage:
        'The 4px base unit; every Tailwind spacing class is a multiple of it.',
    },
    ...LAYOUT_SPACING,
    {
      name: 'header-height-px',
      value: `${toPx(spacingValue) * Number(headerSteps[1])}px`,
      usage: 'Height of the sticky site header.',
    },
  ];

  return {
    color: {
      note: 'Light is :root, dark is .dark in apps/web/app/globals.css. Text clears 4.5:1 and marks 3:1 on card and muted in both themes.',
      themes: [
        { id: 'light', name: 'Light' },
        { id: 'dark', name: 'Dark' },
      ],
      tokens: colors,
    },
    type: {
      fonts: [],
      families: { sans: light.get('font-sans') ?? 'Inter, sans-serif' },
      groups: TYPE_GROUPS.map((group) => ({
        ...group,
        styles: group.styles.map(
          ({ scale: _scale, at: _at, ...style }) => style
        ),
      })),
    },
    spacing: { tokens: spacing },
    radius: { tokens: radius },
    shadow: {
      note: 'The same values in both themes. Panels take shadow-sm in light mode and none in dark mode.',
      tokens: shadows,
    },
  };
}
