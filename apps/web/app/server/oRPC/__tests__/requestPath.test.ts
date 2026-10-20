import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { call } from '@orpc/server';
import * as tracing from '@otr/core/tracing';

import { publicProcedure } from '../procedures/base';

let spanAttributes: ReturnType<
  typeof spyOn<typeof tracing, 'setActiveSpanAttributes'>
>;
let logLines: ReturnType<typeof spyOn<typeof console, 'info'>>;

beforeEach(() => {
  spanAttributes = spyOn(tracing, 'setActiveSpanAttributes');
  logLines = spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  spanAttributes.mockRestore();
  logLines.mockRestore();
});

/** What the call's procedure span recorded as its request path. */
const spanRequestPath = () => {
  const values = spanAttributes.mock.calls
    .map(([attributes]) => attributes['otr.request_path'])
    .filter((value) => value !== undefined);

  expect(values).toHaveLength(1);
  return values[0];
};

/** The path on the call's "procedure completed" log line. */
const loggedRequestPath = () => {
  const lines = logLines.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes('message="procedure completed"'));

  expect(lines).toHaveLength(1);
  return lines[0]!.match(/ path=(\S+)/)?.[1];
};

describe('the request path on spans and log lines', () => {
  // The site's own calls send their input in the body, but /rpc also takes
  // it in the query string of a GET
  it('leaves out the input of a GET call to /rpc (#1095)', async () => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { searchKey: 'Stage' } })
    );
    const probe = publicProcedure.handler(() => ({ ok: true }));

    await call(probe, undefined, {
      path: ['search', 'query'],
      context: {
        headers: new Headers(),
        requestUrl: `http://localhost:3000/rpc/search/query?data=${input}`,
        rpc: { kind: 'browser', clientIp: '203.0.113.7' },
      },
    });

    expect(spanRequestPath()).toBe('/rpc/search/query');
    expect(loggedRequestPath()).toBe('/rpc/search/query');
  });
});
