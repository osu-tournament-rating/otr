import { describe, expect, it } from 'bun:test';

import {
  CLIENT_IP_HEADER,
  getInternalRpcToken,
  INTERNAL_RPC_HEADER,
} from '@/lib/rpc/internal-token';

import { buildServerRpcHeaders } from '../server-headers';

describe('buildServerRpcHeaders', () => {
  it("adds the internal token and the visitor's IP, keeping their cookie", async () => {
    const incoming = new Headers({
      cookie: 'session=abc',
      'cf-connecting-ip': '203.0.113.7',
    });

    const headers = await buildServerRpcHeaders(incoming);

    expect(headers.get(INTERNAL_RPC_HEADER)).toBe(await getInternalRpcToken());
    expect(headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.7');
    expect(headers.get('cookie')).toBe('session=abc');
    expect(incoming.has(INTERNAL_RPC_HEADER)).toBe(false);
  });

  it('overwrites the token and IP a visitor sent', async () => {
    const headers = await buildServerRpcHeaders(
      new Headers({
        [INTERNAL_RPC_HEADER]: 'forged',
        [CLIENT_IP_HEADER]: '192.0.2.99',
        'x-forwarded-for': '198.51.100.4',
      })
    );

    expect(headers.get(INTERNAL_RPC_HEADER)).toBe(await getInternalRpcToken());
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.4');
  });

  it("drops a visitor's IP header when no IP can be resolved", async () => {
    const headers = await buildServerRpcHeaders(
      new Headers({ [CLIENT_IP_HEADER]: '192.0.2.99' })
    );

    expect(headers.has(CLIENT_IP_HEADER)).toBe(false);
  });
});
