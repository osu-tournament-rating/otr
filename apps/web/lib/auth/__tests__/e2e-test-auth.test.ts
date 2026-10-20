import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { isE2eAuthEnabled } from '../e2e-test-auth-plugin';

type ComposeService = {
  image?: string;
  extends?: string | { service: string };
  command?: unknown;
  environment?: Record<string, string>;
};

const WEB_IMAGE = 'stagecodes/otr-web';

const readServices = async () => {
  const file = Bun.file(
    join(import.meta.dir, '../../../../../docker-compose.yml')
  );
  const compose = Bun.YAML.parse(await file.text()) as {
    services: Record<string, ComposeService>;
  };
  return compose.services;
};

/** The service with what it inherits through `extends`, as compose merges it. */
const resolve = (
  services: Record<string, ComposeService>,
  name: string
): ComposeService => {
  const service = services[name]!;
  const parentName =
    typeof service.extends === 'string'
      ? service.extends
      : service.extends?.service;

  if (!parentName) {
    return service;
  }

  const parent = resolve(services, parentName);
  return {
    ...parent,
    ...service,
    environment: { ...parent.environment, ...service.environment },
  };
};

// Test sign-in lets anyone sign in as any player, as an admin
describe('production', () => {
  it('pins test sign-in off in every container that serves the site', async () => {
    const services = await readServices();
    const sites = Object.keys(services)
      .map((name) => ({ name, service: resolve(services, name) }))
      // The migrate service runs the image's migrations instead of the site
      .filter(
        ({ service }) =>
          service.image?.startsWith(`${WEB_IMAGE}:`) &&
          service.command === undefined
      );

    expect(sites.map(({ name }) => name)).toEqual(['web', 'web-standby']);
    expect(
      sites
        .filter(({ service }) => service.environment?.E2E_TEST_AUTH !== 'false')
        .map(({ name }) => name)
    ).toEqual([]);
  });
});

describe('test sign-in', () => {
  // Widened view: the app's env typings declare these vars as required
  const env = process.env as Record<string, string | undefined>;
  const saved = {
    E2E_TEST_AUTH: env.E2E_TEST_AUTH,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
  };

  const serve = (flag: string | undefined, url: string | undefined) => {
    env.E2E_TEST_AUTH = flag;
    env.BETTER_AUTH_URL = url;
    if (flag === undefined) delete env.E2E_TEST_AUTH;
    if (url === undefined) delete env.BETTER_AUTH_URL;
  };

  beforeEach(() => serve(undefined, undefined));

  afterEach(() => serve(saved.E2E_TEST_AUTH, saved.BETTER_AUTH_URL));

  // Playwright, worktree stacks, and PR previews turn it on
  it.each([
    'http://localhost:3001',
    'http://127.0.0.1:20080',
    'https://otr-pr-1234.tail1a2b3c.ts.net',
  ])('turns on with the flag on a site served from %s', (url) => {
    serve('true', url);
    expect(isE2eAuthEnabled()).toBe(true);
  });

  // An operator's override or a copied .env must not open it on the live site
  it.each([
    ['the live site', 'https://otr.stagec.net'],
    ['a site with no sign-in URL', undefined],
  ])('stays off on %s, even with the flag on', (_, url) => {
    serve('true', url);
    expect(isE2eAuthEnabled()).toBe(false);
  });

  it('stays off without the flag', () => {
    serve('false', 'http://localhost:3001');
    expect(isE2eAuthEnabled()).toBe(false);
  });
});
