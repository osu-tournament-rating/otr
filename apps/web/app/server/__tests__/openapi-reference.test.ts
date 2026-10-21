import { describe, expect, it } from 'bun:test';

import { diffReferences } from '../openapi-reference';

// `bun run lint` passes when this finds no difference between the committed
// and generated public API references, so a difference it misses reaches API
// users unreviewed.
describe('diffReferences', () => {
  it('names each field one reference has and the other lacks', () => {
    expect(
      diffReferences(
        {
          components: {
            schemas: { Player: { properties: { id: {}, osuLastFetch: {} } } },
          },
        },
        {
          components: {
            schemas: { Player: { properties: { id: {}, country: {} } } },
          },
        }
      )
    ).toEqual([
      '- $.components.schemas.Player.properties.osuLastFetch',
      '+ $.components.schemas.Player.properties.country',
    ]);
  });

  it('names a value that changed, including a list', () => {
    expect(
      diffReferences(
        {
          paths: {
            '/players/{id}': {
              get: { summary: 'Get player', parameters: ['id'] },
            },
          },
        },
        {
          paths: {
            '/players/{id}': {
              get: { summary: 'Get a player', parameters: ['id', 'keyType'] },
            },
          },
        }
      )
    ).toEqual([
      '~ $.paths["/players/{id}"].get.summary',
      '~ $.paths["/players/{id}"].get.parameters',
    ]);
  });

  it('finds no difference when only the order of keys differs', () => {
    expect(
      diffReferences(
        { info: { title: 'o!TR API', version: '1.0.0' }, paths: {} },
        { paths: {}, info: { version: '1.0.0', title: 'o!TR API' } }
      )
    ).toEqual([]);
  });
});
