/**
 * Renders every preview the build wrote, in light and dark, in a local
 * stand-in for the design system's preview frame, and fails on a console
 * error, a page error or an empty render. Screenshots land in
 * `out/shots/<Component>-<theme>.png` for a look. Run `bun run design-system`
 * first, then `bun run design-system:check`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const HERE = import.meta.dir;
const PROJECT = join(HERE, 'out/project');
const SHOTS = join(HERE, 'out/shots');
const PUBLIC = join(HERE, '../public');

if (!existsSync(join(PROJECT, 'design-system.json'))) {
  throw new Error('Nothing to check: run `bun run design-system` first.');
}

/** tokens.css as the design system's page compiles it from tokens.json. */
function tokensCss(): string {
  const tokens = JSON.parse(readFileSync(join(PROJECT, 'tokens.json'), 'utf8'));
  const value = (v: string) => v.replace(/^\{(.+)\}$/, 'var(--$1)');
  const theme = (id: string) =>
    tokens.color.tokens
      .map(
        (t: { name: string; value: Record<string, string> }) =>
          `--${t.name}:${value(t.value[id] ?? t.value.light)};`
      )
      .join('');
  const plain = (family: string) =>
    tokens[family].tokens
      .map((t: { name: string; value: string }) => `--${t.name}:${t.value};`)
      .join('');
  const families = Object.entries(
    tokens.type.families as Record<string, string>
  )
    .map(([key, stack]) => `--font-${key}:${stack};`)
    .join('');
  return (
    `:root,[data-theme="light"]{${theme('light')}${plain('shadow')}}` +
    `[data-theme="dark"]{${theme('dark')}}` +
    `:root{${plain('spacing')}${plain('radius')}${families}}`
  );
}

const blobs = new Map<string, string>();
const record = JSON.parse(readFileSync(join(HERE, 'artifact.json'), 'utf8'));
for (const [path, { blob }] of Object.entries(
  record.assets as Record<string, { blob: string }>
)) {
  blobs.set(blob, join(PUBLIC, path));
}

const preload = `<style>${tokensCss()}</style>
<link rel="stylesheet" href="/components/bundle.css">
<script src="/components/lib/react.js"></script>
<script src="/components/lib/react-dom.js"></script>
<script src="/components/bundle.js"></script>`;

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    const preview = /^\/preview\/(\w+)$/.exec(url.pathname);
    if (preview) {
      const file = join(PROJECT, 'components', preview[1], 'preview.html');
      const theme = url.searchParams.get('theme') ?? 'light';
      const html = readFileSync(file, 'utf8')
        .replace(/<html[^>]*>/, `<html data-theme="${theme}">`)
        .replace(/<head>/, `<head>${preload}`);
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    }
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(url.pathname);
    if (blob && blobs.has(blob[1]))
      return new Response(Bun.file(blobs.get(blob[1])!));
    const file = join(PROJECT, url.pathname);
    if (file.startsWith(PROJECT) && existsSync(file))
      return new Response(Bun.file(file));
    return new Response('not found', { status: 404 });
  },
});

const components = readdirSync(join(PROJECT, 'components')).filter((name) =>
  existsSync(join(PROJECT, 'components', name, 'preview.html'))
);
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const problems: string[] = [];
try {
  for (const name of components) {
    const marker = readFileSync(
      join(PROJECT, 'components', name, 'preview.html'),
      'utf8'
    ).split('\n', 1)[0];
    const height = Number(/height=(\d+)/.exec(marker)?.[1] ?? 300);
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 960, height } });
      const errors: string[] = [];
      page.on('console', (message) => {
        // A failed load is reported with its URL by the response listener.
        if (
          message.type() === 'error' &&
          !message.text().startsWith('Failed to load resource')
        ) {
          errors.push(message.text());
        }
      });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (response.status() >= 400 && url.host === new URL(server.url).host) {
          errors.push(`${response.status()} for ${url.pathname}`);
        }
      });
      page.on('requestfailed', (request) => {
        const url = new URL(request.url());
        // Fonts and flags come from outside, as on the real page.
        if (url.host === new URL(server.url).host)
          errors.push(`failed to load ${url.pathname}`);
      });
      await page.goto(`${server.url}preview/${name}?theme=${theme}`, {
        waitUntil: 'networkidle',
      });
      await page.waitForTimeout(300);
      const rendered = await page.evaluate(() => {
        const root = document.querySelector('#root') ?? document.body;
        return (
          root.getBoundingClientRect().height > 0 && root.childElementCount > 0
        );
      });
      if (!rendered) errors.push('rendered nothing');
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
      for (const error of errors) problems.push(`${name} (${theme}): ${error}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.stop();
}

console.log(
  `Checked ${components.length} previews in light and dark; screenshots in out/shots.`
);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
