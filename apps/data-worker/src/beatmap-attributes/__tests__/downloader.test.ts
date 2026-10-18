import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { BeatmapFileDownloader } from '../downloader';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

class StubRateLimiter implements RateLimiter {
  public calls = 0;

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return task();
  }
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const OSU_FILE = 'osu file format v14\n\n[General]\nMode: 0\n';

type Reply = Response | (() => Response | Promise<Response>);

/** Answers each request with the next reply, recording what was asked. */
const createHarness = (...replies: Reply[]) => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const sleeps: number[] = [];
  const rateLimiter = new StubRateLimiter();

  const downloader = new BeatmapFileDownloader({
    logger: noopLogger,
    rateLimiter,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      const reply = replies.shift();

      if (!reply) {
        throw new Error('No reply left for this request');
      }

      return typeof reply === 'function' ? reply() : reply;
    },
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
    },
  });

  return { downloader, requests, sleeps, rateLimiter };
};

const tooManyRequests = (retryAfter?: string) =>
  new Response('Too Many Attempts.', {
    status: 429,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  });

const md5 = (bytes: Uint8Array) =>
  createHash('md5').update(bytes).digest('hex');

describe('BeatmapFileDownloader', () => {
  it('downloads the file with its MD5 checksum', async () => {
    const { downloader, requests, rateLimiter } = createHarness(
      new Response(OSU_FILE, { headers: { 'content-type': 'text/plain' } })
    );

    const result = await downloader.download(129891);
    const bytes = new TextEncoder().encode(OSU_FILE);

    expect(result).toEqual({ status: 'ok', bytes, checksum: md5(bytes) });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://osu.ppy.sh/osu/129891');
    expect(requests[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(rateLimiter.calls).toBe(1);
  });

  it('accepts a file that starts with a UTF-8 BOM', async () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(OSU_FILE),
    ]);
    const { downloader } = createHarness(new Response(bytes));

    const result = await downloader.download(1);

    expect(result).toEqual({ status: 'ok', bytes, checksum: md5(bytes) });
  });

  it('accepts a file of exactly 10 MB', async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES).fill(0x20);
    bytes.set(new TextEncoder().encode(OSU_FILE));
    const { downloader } = createHarness(new Response(bytes));

    const result = await downloader.download(1);

    expect(result.status).toBe('ok');
  });

  it('reports an empty 200 as not found', async () => {
    const { downloader } = createHarness(
      new Response(''),
      new Response('', { headers: { 'content-type': 'text/html' } })
    );

    expect(await downloader.download(1)).toEqual({ status: 'not_found' });
    expect(await downloader.download(1)).toEqual({ status: 'not_found' });
  });

  it('reports a 404 as not found', async () => {
    const { downloader } = createHarness(
      new Response('Not Found', { status: 404 })
    );

    expect(await downloader.download(1)).toEqual({ status: 'not_found' });
  });

  it('throws on another 4xx or a 5xx so the queue retries', async () => {
    for (const status of [401, 403, 408, 451, 502]) {
      const { downloader } = createHarness(
        new Response('<!DOCTYPE html><html></html>', {
          status,
          headers: { 'content-type': 'text/html' },
        })
      );

      await expect(downloader.download(1)).rejects.toThrow(
        `Downloading https://osu.ppy.sh/osu/1 failed: HTTP ${status}`
      );
    }
  });

  it('throws on an HTML page so the queue retries', async () => {
    const { downloader } = createHarness(
      new Response('<!DOCTYPE html><html></html>', {
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      })
    );

    await expect(downloader.download(1)).rejects.toThrow(
      'Downloading https://osu.ppy.sh/osu/1 failed: the response is an HTML page'
    );
  });

  it('reports a body without the .osu header as invalid', async () => {
    const { downloader } = createHarness(
      new Response('not a beatmap', {
        headers: { 'content-type': 'text/plain' },
      })
    );

    expect(await downloader.download(1)).toEqual({
      status: 'invalid',
      reason: 'does not start with "osu file format v"',
    });
  });

  it('stops reading a body larger than 10 MB and reports it invalid', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { downloader } = createHarness(new Response(body));

    expect(await downloader.download(1)).toEqual({
      status: 'invalid',
      reason: 'larger than 10 MB',
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(15);
  });

  it('waits for Retry-After on a 429 and tries again through the limiter', async () => {
    const { downloader, requests, sleeps, rateLimiter } = createHarness(
      tooManyRequests('5'),
      new Response(OSU_FILE)
    );

    const result = await downloader.download(1);

    expect(result.status).toBe('ok');
    expect(sleeps).toEqual([5_000]);
    expect(requests).toHaveLength(2);
    expect(rateLimiter.calls).toBe(2);
  });

  it('backs off 8, 16 and 32 seconds when a 429 has no Retry-After', async () => {
    const { downloader, sleeps } = createHarness(
      tooManyRequests(),
      tooManyRequests(),
      tooManyRequests(),
      new Response(OSU_FILE)
    );

    const result = await downloader.download(1);

    expect(result.status).toBe('ok');
    expect(sleeps).toEqual([8_000, 16_000, 32_000]);
  });

  it('treats a Retry-After date as absent and waits at most 60 seconds', async () => {
    const { downloader, sleeps } = createHarness(
      tooManyRequests('Wed, 21 Oct 2026 07:28:00 GMT'),
      tooManyRequests('600'),
      new Response(OSU_FILE)
    );

    await downloader.download(1);

    expect(sleeps).toEqual([8_000, 60_000]);
  });

  it('throws after three retries that are all rate limited', async () => {
    const { downloader, requests, sleeps, rateLimiter } = createHarness(
      tooManyRequests('1'),
      tooManyRequests('1'),
      tooManyRequests('1'),
      tooManyRequests('1')
    );

    await expect(downloader.download(1)).rejects.toThrow(
      'osu! still rate limited https://osu.ppy.sh/osu/1 after 3 retries'
    );
    expect(requests).toHaveLength(4);
    expect(rateLimiter.calls).toBe(4);
    expect(sleeps).toEqual([1_000, 1_000, 1_000]);
  });

  it('throws on a network error or timeout', async () => {
    const { downloader } = createHarness(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    await expect(downloader.download(1)).rejects.toThrow(
      'Downloading https://osu.ppy.sh/osu/1 failed: The operation timed out.'
    );
  });

  it('uses a rate limiter of its own when none is given', async () => {
    const downloader = new BeatmapFileDownloader({
      logger: noopLogger,
      fetchImpl: async () => new Response(OSU_FILE),
    });

    expect((await downloader.download(1)).status).toBe('ok');
  });
});
