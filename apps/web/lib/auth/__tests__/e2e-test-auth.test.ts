import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

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
