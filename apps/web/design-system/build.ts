/**
 * Builds the o!TR design system's files from the site's source into
 * `design-system/out/project/`, ready to publish to the design system
 * artifact. Run it with `bun run design-system` from apps/web; README.md in
 * this folder covers publishing.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';

import { transform as svgr, type Config as SvgrConfig } from '@svgr/core';
import svgrJsx from '@svgr/plugin-jsx';
import svgrSvgo from '@svgr/plugin-svgo';
import tailwind from '@tailwindcss/postcss';
import * as esbuild from 'esbuild';
import postcss from 'postcss';

import { COMPONENTS } from './components';
import { buildTokens } from './tokens';

const HERE = import.meta.dir;
const WEB = join(HERE, '..');
const ROOT = join(WEB, '../..');
const OUT = join(HERE, 'out');
/**
 * Intermediate files (the bundle's entry, declarations), outside the repo so
 * its typecheck skips them, and one folder per build so builds in two
 * worktrees don't collide.
 */
const WORK = mkdtempSync(join(tmpdir(), 'otr-design-system-'));
const PROJECT = join(OUT, 'project');
const CONTENT = join(HERE, 'content');
const REFERENCE = join(ROOT, '.claude/skills/web-design/reference');
const REPO = 'osu-tournament-rating/otr';
const NAMESPACE = 'OTR';
const require = createRequire(join(WEB, 'package.json'));

/** Public paths the site serves images from, which become uploads. */
const PUBLIC_LITERAL =
  /(?<!__otrAsset\()(['"`])(\/(?:icons|images|logos|decorations)\/[^'"`\n]*)\1/g;
const PUBLIC_CSS_URL =
  /(['"])url\((\/(?:icons|images|logos|decorations)\/[^)'"\n]*)\)\1/g;
const PUBLIC_JSX_ATTRIBUTE =
  /(\s[\w-]+)=(["'])(\/(?:icons|images|logos|decorations)\/[^"'\n]*)\2/g;

interface AssetGroup {
  group: string;
  dir: string;
  tile: 'l' | 'm' | 's';
  /** Files shown first, in this order; the rest follow by name. */
  order?: string[];
}

const TIER_ORDER = [
  'Grandmaster',
  'Master',
  'Diamond',
  'Emerald',
  'Platinum',
  'Gold',
  'Silver',
  'Bronze',
];

const ASSET_GROUPS: AssetGroup[] = [
  {
    group: 'Logos',
    dir: 'public/logos',
    tile: 'l',
    order: [
      'small.svg',
      'full-logo.svg',
      'full-logo-dark.svg',
      'full.svg',
      'otr-logo-2.svg',
    ],
  },
  {
    group: 'Rulesets',
    dir: 'public/icons/rulesets',
    tile: 's',
    order: [
      'osu.svg',
      'taiko.svg',
      'catch.svg',
      'mania.svg',
      'mania4k.svg',
      'mania7k.svg',
      'all.svg',
    ],
  },
  {
    group: 'Tiers',
    dir: 'public/icons/tiers',
    tile: 's',
    order: [
      'Elite Grandmaster.svg',
      ...TIER_ORDER.flatMap((tier) => [3, 2, 1].map((n) => `${tier}${n}.svg`)),
    ],
  },
  {
    group: 'Mods',
    dir: 'public/icons/mods',
    tile: 's',
    order: ['blanks/mod-icon.svg'],
  },
  {
    group: 'Grades',
    dir: 'public/icons/grades',
    tile: 's',
    order: [
      'SSH.svg',
      'SS.svg',
      'SH.svg',
      'S.svg',
      'A.svg',
      'B.svg',
      'C.svg',
      'D.svg',
    ],
  },
  { group: 'Decorations', dir: 'public/decorations', tile: 'm' },
  { group: 'Images', dir: 'public/images', tile: 'm' },
];

/** The artifact this system publishes to, and the assets already uploaded there. */
interface ArtifactRecord {
  url: string;
  createdAt: string;
  assets: Record<string, { blob: string; sha256: string }>;
}

const MEDIA_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function write(path: string, contents: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Who the change is by: git's user.name, which may be unset. */
function author(): string {
  try {
    return git('config', 'user.name') || 'Claude';
  } catch {
    return 'Claude';
  }
}

/** An index key: the file name with bytes outside [A-Za-z0-9_./-] as ~hex. */
function assetKey(name: string): string {
  return [...Buffer.from(name)]
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      return /[A-Za-z0-9_./-]/.test(ch)
        ? ch
        : `~${byte.toString(16).padStart(2, '0')}`;
    })
    .join('');
}

// ── Assets ─────────────────────────────────────────────────────────────────

function collectAssets(record: ArtifactRecord) {
  const urls: Record<string, string> = {};
  const groups: Record<string, unknown> = {};
  const missing: { publicPath: string; file: string }[] = [];
  for (const { group, dir, tile, order = [] } of ASSET_GROUPS) {
    const base = join(WEB, dir);
    const names = walk(base)
      .filter((f) => MEDIA_TYPES[f.slice(f.lastIndexOf('.'))])
      .map((f) => relative(base, f))
      .sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 || ib !== -1)
          return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
        return a.localeCompare(b);
      });
    const files: Record<string, unknown> = {};
    for (const name of names) {
      const file = join(base, name);
      const publicPath = `/${relative(join(WEB, 'public'), file)}`;
      const bytes = readFileSync(file);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const uploaded = record.assets[publicPath];
      if (!uploaded || uploaded.sha256 !== sha256) {
        missing.push({ publicPath, file });
        continue;
      }
      urls[publicPath] = `/_blob/${uploaded.blob}`;
      files[assetKey(name)] = {
        name,
        blob: uploaded.blob,
        size: bytes.length,
        type: MEDIA_TYPES[name.slice(name.lastIndexOf('.'))],
      };
    }
    groups[group] = {
      name: group,
      tile,
      order: names.filter((n) => files[assetKey(n)]),
      files,
    };
  }
  return { urls, groups, missing };
}

// ── Content ────────────────────────────────────────────────────────────────

/** Points every public image path in a preview at its upload. */
function rewritePreview(html: string, urls: Record<string, string>): string {
  return html.replace(
    /(['"`(])(\/(?:icons|images|logos|decorations)\/[^'"`)\n]*)(?=['"`)])/g,
    (match, before: string, path: string) =>
      urls[path] ? `${before}${urls[path]}` : match
  );
}

function copyContent(urls: Record<string, string>) {
  for (const file of walk(CONTENT)) {
    const rel = relative(CONTENT, file);
    const text = readFileSync(file, 'utf8');
    write(
      join(PROJECT, rel),
      rel.endsWith('preview.html') ? rewritePreview(text, urls) : text
    );
  }
}

/** Each component's guidelines, from its sections of the web-design skill. */
function writeComponentReadmes() {
  const sections = new Map<string, Map<string, string>>();
  const read = (file: string) => {
    if (!sections.has(file)) {
      const parts = readFileSync(join(REFERENCE, file), 'utf8')
        .split(/^## /m)
        .slice(1);
      sections.set(
        file,
        new Map(
          parts.map((p) => [
            p.slice(0, p.indexOf('\n')).trim(),
            p.slice(p.indexOf('\n') + 1),
          ])
        )
      );
    }
    return sections.get(file)!;
  };
  const clean = (body: string) =>
    body
      .replace(/^Gallery anchors?:.*\n?/gm, '')
      .replace(/\s*Gallery anchor: `[^`]*`\.?/g, '')
      .replace(/\[([^\]]+)\]\((?:[a-z-]+\.md)?#[^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([a-z-]+\.md\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  for (const component of COMPONENTS) {
    const out = [`# ${component.name}`, ''];
    component.refs.forEach((ref, i) => {
      const [file, heading] = ref.split('#');
      const body = read(file).get(heading);
      if (body === undefined) {
        throw new Error(
          `${component.name}: no "## ${heading}" in the web-design skill's ${file}`
        );
      }
      if (i > 0) out.push(`## ${heading}`, '');
      out.push(clean(body), '');
    });
    out.push(
      '## In this design system',
      '',
      `Live as \`window.${NAMESPACE}.${component.name}\` from \`components/bundle.js\`, the site's own build of \`apps/web/${component.src}\`. ` +
        `The examples above are the site's source, which imports from \`@/components/…\`; outside the site, read the same names from \`window.${NAMESPACE}\`. ` +
        `Lucide icons are \`${NAMESPACE}.Icons\`, the osu! enums \`${NAMESPACE}.osu\`, the shadcn primitives \`${NAMESPACE}.ui\`, and the kit's helpers \`${NAMESPACE}.format\`, \`${NAMESPACE}.color\`, \`${NAMESPACE}.status\` and \`${NAMESPACE}.lists\`.`,
      ''
    );
    write(
      join(PROJECT, 'components', component.name, 'README.md'),
      out.join('\n')
    );
  }
}

// ── Bundle ─────────────────────────────────────────────────────────────────

/** Helper namespaces: name → modules under apps/web whose exports it gathers. */
const NAMESPACES: Record<string, string[]> = {
  format: [
    'lib/kit/format/date',
    'lib/kit/format/number',
    'lib/kit/format/ruleset',
    'lib/kit/format/tier',
    'lib/kit/format/fields',
    'lib/kit/format/mods',
    'lib/kit/format/country',
    'lib/kit/format/enum-labels',
    'lib/kit/format/empty',
  ],
  color: [
    'lib/kit/color/categorical',
    'lib/kit/color/grades',
    'lib/kit/color/mods',
    'lib/kit/color/tiers',
    'lib/kit/color/teams',
    'lib/kit/color/verification',
    'lib/kit/color/tokens',
    'lib/kit/color/star-rating',
  ],
  status: [
    'lib/kit/status/verification',
    'lib/kit/status/report',
    'lib/kit/status/approval',
    'lib/kit/status/job',
    'lib/kit/status/count',
  ],
  lists: [
    'lib/kit/lists/range',
    'lib/kit/lists/filters',
    'lib/filters/scale',
    'lib/filters/tournament-rank',
  ],
  ui: [
    'components/ui/input',
    'components/ui/textarea',
    'components/ui/select',
    'components/ui/radio-group',
    'components/ui/checkbox',
    'components/ui/switch',
    'components/ui/label',
    'components/ui/form',
    'components/ui/avatar',
    'components/ui/progress',
  ],
};

/** Single exports a namespace also carries: namespace → [names, module]. */
const NAMESPACE_EXTRAS: Record<string, [string, string][]> = {
  format: [['getBeatmapModLabel', 'lib/utils/mods']],
  ui: [['useForm', 'react-hook-form']],
};

/** Default exports and parts outside the kit that its components and previews need. */
const EXTRAS: [string, string][] = [
  ['RulesetIcon', 'components/icons/RulesetIcon.tsx'],
  ['TierIcon', 'components/icons/TierIcon.tsx'],
  ['ModIconset', 'components/icons/ModIconset.tsx'],
  ['FittingModIconset', 'components/icons/FittingModIconset.tsx'],
  ['SectionError', 'components/error/SectionError.tsx'],
  ['BeatmapCover', 'components/beatmaps/BeatmapCover.tsx'],
  ['StarRatingPill', 'components/beatmaps/StarRatingPill.tsx'],
];
const NAMED_EXTRAS: [string, string][] = [
  ['OsuAvatar', 'components/ui/osu-avatar.tsx'],
  ['Avatar, AvatarImage, AvatarFallback', 'components/ui/avatar.tsx'],
  ['Progress', 'components/ui/progress.tsx'],
  ['TooltipProvider', 'components/ui/tooltip.tsx'],
];

function writeEntry(): string {
  const kit = walk(join(WEB, 'components/kit'))
    .filter((f) => f.endsWith('.tsx') && !f.includes('__tests__'))
    .sort();
  const lines = [
    ...kit.map((f) => `export * from '${f}';`),
    `export * from '${join(WEB, 'components/icons/TierIcon.tsx')}';`,
    ...EXTRAS.map(
      ([name, src]) => `export { default as ${name} } from '${join(WEB, src)}';`
    ),
    ...NAMED_EXTRAS.map(
      ([names, src]) => `export { ${names} } from '${join(WEB, src)}';`
    ),
    `export * as Icons from 'lucide-react';`,
    `export * as osu from '@otr/core/osu';`,
  ];
  for (const [ns, modules] of Object.entries(NAMESPACES)) {
    const file = join(WORK, `ns-${ns}.ts`);
    const extras = (NAMESPACE_EXTRAS[ns] ?? []).map(
      ([names, from]) =>
        `export { ${names} } from '${from.startsWith('lib/') ? join(WEB, from) : from}';\n`
    );
    write(
      file,
      [
        ...modules.map((m) => `export * from '${join(WEB, m)}';\n`),
        ...extras,
      ].join('')
    );
    lines.push(`export * as ${ns} from '${file}';`);
  }
  const entry = join(WORK, 'entry.ts');
  write(entry, lines.join('\n') + '\n');
  return entry;
}

const GLOBAL_MODULES: Record<string, string> = {
  react: 'module.exports = window.React;',
  'react-dom': 'module.exports = window.ReactDOM;',
  'react-dom/client': 'module.exports = window.ReactDOM;',
};

function sitePlugin(): esbuild.Plugin {
  const shims = join(HERE, 'shims');
  const files: Record<string, string> = {
    'react/jsx-runtime': join(shims, 'jsx-runtime.ts'),
    'react/jsx-dev-runtime': join(shims, 'jsx-runtime.ts'),
    'next/link': join(shims, 'next-link.ts'),
    'next/image': join(shims, 'next-image.ts'),
  };
  const svgoConfig: SvgrConfig['svgoConfig'] = {
    plugins: [
      {
        name: 'preset-default',
        params: { overrides: { removeViewBox: false } },
      },
      { name: 'removeAttrs', params: { attrs: '(fill|stroke)' } },
    ],
  };
  return {
    name: 'otr-site',
    setup(build) {
      build.onResolve(
        { filter: /^(react|react-dom|react-dom\/client)$/ },
        (args) => ({
          path: args.path,
          namespace: 'global',
        })
      );
      build.onLoad({ filter: /.*/, namespace: 'global' }, (args) => ({
        contents: GLOBAL_MODULES[args.path],
        loader: 'js',
      }));
      build.onResolve(
        { filter: /^(react\/jsx(-dev)?-runtime|next\/.*)$/ },
        (args) => {
          if (files[args.path]) return { path: files[args.path] };
          return {
            errors: [
              {
                text: `the design system has no stand-in for ${args.path} (imported by ${args.importer})`,
              },
            ],
          };
        }
      );
      // SVGs imported as components, as the site's SVGR loader does.
      build.onLoad({ filter: /\.svg$/ }, async (args) => ({
        contents: await svgr(
          readFileSync(args.path, 'utf8'),
          { plugins: [svgrSvgo, svgrJsx], svgoConfig },
          { filePath: args.path, caller: { name: 'otr-design-system' } }
        ),
        loader: 'jsx',
        resolveDir: dirname(args.path),
      }));
      // Public image paths in the site's source → the uploads.
      build.onLoad({ filter: /\.(tsx?|jsx?)$/ }, (args) => {
        if (
          args.path.includes('node_modules') ||
          !args.path.startsWith(WEB) ||
          args.path.startsWith(HERE)
        ) {
          return undefined;
        }
        const source = readFileSync(args.path, 'utf8');
        const rewritten = source
          .replace(PUBLIC_JSX_ATTRIBUTE, '$1={__otrAsset("$3")}')
          .replace(PUBLIC_CSS_URL, '`url(${__otrAsset("$2")})`')
          .replace(PUBLIC_LITERAL, '__otrAsset($1$2$1)');
        if (rewritten === source) return undefined;
        const contents = `import { assetUrl as __otrAsset } from '${join(shims, 'asset.ts')}';\n${rewritten}`;
        return {
          contents,
          loader: args.path.endsWith('x') ? 'tsx' : 'ts',
          resolveDir: dirname(args.path),
        };
      });
    },
  };
}

async function buildBundle(urls: Record<string, string>) {
  const define = { 'process.env.NODE_ENV': '"production"' };
  const libDir = join(PROJECT, 'components/lib');
  const libs: [string, string][] = [
    ['react.js', `import * as R from 'react'; window.React = R;`],
    [
      'react-dom.js',
      `import * as D from 'react-dom'; import * as C from 'react-dom/client'; window.ReactDOM = Object.assign({}, D, C);`,
    ],
  ];
  for (const [file, contents] of libs) {
    await esbuild.build({
      stdin: { contents, resolveDir: WEB, loader: 'js' },
      bundle: true,
      minify: true,
      format: 'iife',
      define,
      legalComments: 'none',
      outfile: join(libDir, file),
      plugins:
        file === 'react-dom.js'
          ? [
              {
                name: 'react-global',
                setup(build) {
                  build.onResolve({ filter: /^react$/ }, () => ({
                    path: 'react',
                    namespace: 'global',
                  }));
                  build.onLoad({ filter: /.*/, namespace: 'global' }, () => ({
                    contents: GLOBAL_MODULES.react,
                    loader: 'js',
                  }));
                },
              },
            ]
          : [],
    });
  }

  const result = await esbuild.build({
    entryPoints: [writeEntry()],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: NAMESPACE,
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    define: { ...define, __OTR_ASSETS__: JSON.stringify(urls) },
    plugins: [sitePlugin()],
    tsconfig: join(WEB, 'tsconfig.json'),
    absWorkingDir: WEB,
    nodePaths: [join(WEB, 'node_modules'), join(ROOT, 'node_modules')],
    legalComments: 'none',
    logLevel: 'warning',
    write: false,
  });
  const js = `${result.outputFiles[0].text}window.${NAMESPACE}=${NAMESPACE};\n`;
  if (/<\/script|<!--/i.test(js))
    throw new Error(
      'the bundle contains </script or <!--, which breaks inlining'
    );

  // Which cards are real exports: run the bundle against the libraries.
  const context: Record<string, unknown> = {
    console: { log() {}, warn() {}, error() {} },
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  for (const [file] of libs)
    vm.runInContext(readFileSync(join(libDir, file), 'utf8'), context);
  vm.runInContext(js, context);
  const exported = new Set(Object.keys(context[NAMESPACE] as object));
  const missing = COMPONENTS.filter((c) => !exported.has(c.name)).map(
    (c) => c.name
  );
  if (missing.length)
    throw new Error(`the bundle doesn't export ${missing.join(', ')}`);

  const header = {
    format: 4,
    namespace: NAMESPACE,
    components: COMPONENTS.map((c) => ({ name: c.name })),
  };
  write(
    join(PROJECT, 'components/bundle.js'),
    `/* @ds-bundle: ${JSON.stringify(header)} */\n${js}`
  );
  return exported.size;
}

// ── Stylesheet ─────────────────────────────────────────────────────────────

/**
 * The site's Tailwind build over the kit and the previews, without the token
 * values: tokens.css declares those, so an edit on the design system's page
 * reaches the previews. Dark mode follows the page's data-theme.
 */
async function buildStylesheet() {
  let css = readFileSync(join(WEB, 'app/globals.css'), 'utf8');
  const start = css.search(/(^|\n):root,\s*\.theme-light\s*\{/);
  const end = css.indexOf('@layer base {\n  * {');
  if (start === -1 || end === -1)
    throw new Error("can't find globals.css' token blocks");
  css = css.slice(0, start) + '\n' + css.slice(end);
  const replace = (from: string | RegExp, to: string) => {
    const next = css.replace(from, to);
    if (next === css) throw new Error(`globals.css no longer contains ${from}`);
    css = next;
  };
  replace(
    "@import 'tailwindcss';",
    [
      "@import 'tailwindcss' source(none);",
      `@source '${join(WEB, 'components')}';`,
      `@source '${join(WEB, 'lib/kit')}';`,
      `@source '${join(WEB, 'lib/utils.ts')}';`,
      `@source '${join(PROJECT, 'components')}/**/*.html';`,
    ].join('\n')
  );
  replace(
    '@custom-variant dark (&:is(.dark *):not(.theme-light *));',
    "@custom-variant dark (&:is([data-theme='dark'] *, .dark *):not(.theme-light *));"
  );
  // Radii and the status colours come from tokens.css, not from formulas here.
  replace(/--radius-(sm|md|lg|xl): [^;]+;/g, '--radius-$1: var(--radius-$1);');
  replace(/\n\s*--radius: 0\.5rem;/, '');
  replace(
    /@theme \{([^}]*)\}/,
    (() => {
      const names = [
        'color-success',
        'color-success-foreground',
        'color-warning',
        'color-warning-foreground',
      ];
      return `@theme inline {\n${names.map((n) => `  --${n}: var(--${n});`).join('\n')}\n}`;
    })()
  );
  css += '\n:root {\n  --tracking-normal: 0em;\n}\n';

  const result = await postcss([
    tailwind({ base: WEB, optimize: { minify: true } }),
  ]).process(css, {
    from: join(WEB, 'app/globals.css'),
  });
  const font =
    "@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap');\n";
  write(join(PROJECT, 'components/bundle.css'), font + result.css);
}

// ── Types ──────────────────────────────────────────────────────────────────

function buildTypes() {
  const dts = join(WORK, 'dts');
  rmSync(dts, { recursive: true, force: true });
  const sources = [
    ...COMPONENTS.map((c) => c.src),
    ...EXTRAS.map(([, src]) => src),
    ...NAMED_EXTRAS.map(([, src]) => src),
    ...NAMESPACES.ui.map((m) => `${m}.tsx`),
  ];
  const kit = walk(join(WEB, 'components/kit')).filter(
    (f) => f.endsWith('.tsx') && !f.includes('__tests__')
  );
  const files = [...new Set([...kit, ...sources.map((s) => join(WEB, s))])];
  const config = join(WORK, 'tsconfig.dts.json');
  write(
    config,
    JSON.stringify({
      extends: join(WEB, 'tsconfig.json'),
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        outDir: dts,
        rootDir: ROOT,
        incremental: false,
        skipLibCheck: true,
        types: [],
        plugins: [],
      },
      files,
      include: [],
    })
  );
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', config], {
      cwd: WEB,
      stdio: 'pipe',
    });
  } catch {
    // tsc exits non-zero on type errors unrelated to the declarations; it still emits them.
  }
  const base = join(dts, relative(ROOT, WEB));
  const order = [
    ...new Set([
      ...COMPONENTS.map((c) => join(base, c.src)),
      ...files.map((f) => join(base, relative(WEB, f))),
    ]),
  ].map((f) => f.replace(/\.tsx?$/, '.d.ts'));
  const out = [
    '/**',
    ` * o!TR component library: the declarations of apps/web/components/kit, as built into`,
    ` * components/bundle.js (window.${NAMESPACE}). Documentation, not type-checked. Domain types such as`,
    ` * Ruleset, VerificationStatus and Mods are the enums in ${NAMESPACE}.osu; KitIcon is any lucide icon (${NAMESPACE}.Icons).`,
    ` * Declarations from components/ui/ are reached as ${NAMESPACE}.ui.<Name> (Avatar, Progress and TooltipProvider also sit on ${NAMESPACE}).`,
    ' */',
    "import type * as React from 'react';",
    '',
  ];
  for (const file of order) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8')
      .replace(/^import[^;]*?;\n/gm, '')
      .replace(/^export \{\};?\n?/gm, '')
      .replace(/export default function (\w+)/g, 'export declare function $1')
      .trim();
    if (text)
      out.push(
        `// ── apps/web/${relative(base, file).replace(/\.d\.ts$/, '.tsx')}`,
        text,
        ''
      );
  }
  let text = out.join('\n');
  const typeNames = new Set(
    [...text.matchAll(/export (?:declare )?(?:interface|type) (\w+)/g)].map(
      (m) => m[1]
    )
  );
  const functions = new Set(
    [...text.matchAll(/export declare (?:function|const) (\w+)/g)].map(
      (m) => m[1]
    )
  );
  const aliases = COMPONENTS.filter(
    (c) => !typeNames.has(`${c.name}Props`) && functions.has(c.name)
  ).map(
    (c) =>
      `export type ${c.name}Props = React.ComponentProps<typeof ${c.name}>;`
  );
  text += `\n// ── Props of each component, for the API cards\n${aliases.join('\n')}\n`;
  write(join(PROJECT, 'components/index.d.ts'), text);
}

// ── Index ──────────────────────────────────────────────────────────────────

async function main() {
  const record: ArtifactRecord = JSON.parse(
    readFileSync(join(HERE, 'artifact.json'), 'utf8')
  );
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });

  const sha = git('rev-parse', '--short', 'HEAD');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const { urls, groups, missing } = collectAssets(record);

  const tokens = {
    name: 'o!TR',
    version: 1,
    ...buildTokens(
      readFileSync(join(WEB, 'app/globals.css'), 'utf8'),
      readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8')
    ),
    meta: {
      source: 'github',
      repo: REPO,
      ref: `${branch}@${sha}`,
      package: 'apps/web',
      paths: {
        tokens: [
          'apps/web/app/globals.css',
          'apps/web/components/kit/layout/Typography.tsx',
        ],
        fonts: ['apps/web/app/layout.tsx (Google Fonts link)'],
        assets: ASSET_GROUPS.map((g) => `apps/web/${g.dir}`),
        docs: [
          'apps/web/design-system/content',
          '.claude/skills/web-design/reference/',
        ],
      },
      components: Object.fromEntries(
        COMPONENTS.map((c) => [c.name, `apps/web/${c.src}`])
      ),
      synced: new Date().toISOString().slice(0, 10),
    },
  };
  write(join(PROJECT, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n');

  copyContent(urls);
  writeComponentReadmes();
  const exports = await buildBundle(urls);
  await buildStylesheet();
  buildTypes();

  const reactVersion = JSON.parse(
    readFileSync(require.resolve('react/package.json'), 'utf8')
  ).version;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const index = {
    v: 3,
    layout: 'files',
    createdOnFiles: { v: 1, at: record.createdAt },
    title: 'o!TR',
    namespace: NAMESPACE,
    libraries: [
      {
        name: 'react',
        version: reactVersion,
        global: 'React',
        file: 'components/lib/react.js',
      },
      {
        name: 'react-dom',
        version: reactVersion,
        global: 'ReactDOM',
        file: 'components/lib/react-dom.js',
      },
    ],
    sections: {},
    groups: ASSET_GROUPS.map((g) => g.group),
    assetGroups: groups,
    blobs: {},
    docs: { sections: [] },
    lastChange: {
      by: author(),
      at: now,
      via: `bun run design-system · ${REPO}@${sha}`,
      note: `Rebuilt from apps/web at ${sha}.`,
    },
  };
  write(
    join(PROJECT, 'design-system.json'),
    JSON.stringify(index, null, 2) + '\n'
  );

  // Files that still need uploading, gathered in one folder for the upload.
  for (const { publicPath, file } of missing) {
    const target = join(OUT, 'uploads', publicPath.slice(1));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
  }

  const kb = (p: string) =>
    `${Math.round(statSync(join(PROJECT, p)).size / 1024)} KB`;
  console.log(`Built ${relative(WEB, PROJECT)} at ${sha}:`);
  console.log(
    `  ${tokens.color.tokens.length} colours, ${COMPONENTS.length} components, ${exports} exports`
  );
  console.log(
    `  bundle.js ${kb('components/bundle.js')}, bundle.css ${kb('components/bundle.css')}, index.d.ts ${kb('components/index.d.ts')}`
  );
  if (missing.length) {
    console.log(
      `\n${missing.length} assets are new or changed and need uploading (copies in ${relative(WEB, join(OUT, 'uploads'))}):`
    );
    for (const { publicPath } of missing) console.log(`  ${publicPath}`);
    console.log(
      'Upload them to the artifact, record each blob id in artifact.json, then build again.'
    );
  }
}

try {
  await main();
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
