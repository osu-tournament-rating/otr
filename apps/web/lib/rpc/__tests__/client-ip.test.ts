import { describe, expect, it } from 'bun:test';

import { resolveClientIp } from '../client-ip';

const resolve = (headers: HeadersInit) => resolveClientIp(new Headers(headers));

describe('resolveClientIp', () => {
  it("prefers Cloudflare's header over x-forwarded-for", () => {
    expect(
      resolve({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '172.68.1.1',
      })
    ).toBe('203.0.113.7');
  });

  it('uses a single x-forwarded-for value', () => {
    expect(resolve({ 'x-forwarded-for': ' 198.51.100.4 ' })).toBe(
      '198.51.100.4'
    );
  });

  it('trusts no address from a multi-value x-forwarded-for', () => {
    expect(resolve({ 'x-forwarded-for': '198.51.100.4, 172.68.1.1' })).toBe(
      null
    );
  });

  it('falls back to x-forwarded-for when the Cloudflare header is invalid', () => {
    expect(
      resolve({
        'cf-connecting-ip': 'not-an-ip',
        'x-forwarded-for': '198.51.100.4',
      })
    ).toBe('198.51.100.4');
  });

  it('groups an IPv6 address by its /64', () => {
    const first = resolve({ 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' });
    const second = resolve({ 'cf-connecting-ip': '2001:db8:1:2:bbbb::2' });

    expect(first).toBe('2001:0db8:0001:0002:0000:0000:0000:0000');
    expect(second).toBe(first);
  });

  it('turns an IPv4-mapped address into IPv4', () => {
    expect(resolve({ 'x-forwarded-for': '::ffff:192.0.2.1' })).toBe(
      '192.0.2.1'
    );
  });

  it('returns null without forwarding headers', () => {
    expect(resolve({})).toBe(null);
  });
});
