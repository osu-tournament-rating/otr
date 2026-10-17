import type { Logger } from '../logging/logger';
import { FixedWindowRateLimiter, type RateLimiter } from '../rate-limiter';

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type BeatmapFileDownload =
  | { status: 'ok'; bytes: Uint8Array; checksum: string }
  | { status: 'not_found' }
  | { status: 'invalid'; reason: string };

type Attempt =
  BeatmapFileDownload | { status: 'rate_limited'; retryAfter: string | null };

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_FILE_MEGABYTES = 10;
const MAX_FILE_BYTES = MAX_FILE_MEGABYTES * 1024 * 1024;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 60;
const FILE_HEADER = 'osu file format v';
const UTF8_BOM_BYTES = 3;

export const beatmapFileUrl = (osuBeatmapId: number) =>
  `https://osu.ppy.sh/osu/${osuBeatmapId}`;

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

/** Null when the body is larger than maxBytes; stops reading at that point. */
const readBody = async (response: Response, maxBytes: number) => {
  if (!response.body) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    length += value.byteLength;

    if (length > maxBytes) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

const hasFileHeader = (bytes: Uint8Array) =>
  // TextDecoder drops a leading UTF-8 BOM.
  new TextDecoder()
    .decode(bytes.subarray(0, UTF8_BOM_BYTES + FILE_HEADER.length))
    .startsWith(FILE_HEADER);

// osu! serves .osu files as text/plain.
const isHtml = (response: Response) =>
  (response.headers.get('content-type') ?? '')
    .toLowerCase()
    .startsWith('text/html');

const retryAfterSeconds = (retryAfter: string | null, retry: number) => {
  // Retry-After may also be an HTTP date; anything but a positive number of
  // seconds counts as absent.
  const seconds = Number(retryAfter ?? '');
  const wait =
    Number.isFinite(seconds) && seconds > 0 ? seconds : 8 * 2 ** retry;

  return Math.min(wait, MAX_RETRY_AFTER_SECONDS);
};

export interface BeatmapFileDownloaderOptions {
  logger: Logger;
  /** Defaults to a limiter of its own, separate from the osu! API limiter. */
  rateLimiter?: RateLimiter;
  fetchImpl?: FetchFunction;
  sleep?: (durationMs: number) => Promise<void>;
}

/** Downloads a beatmap's .osu file from osu!. */
export class BeatmapFileDownloader {
  private readonly logger: Logger;
  private readonly rateLimiter: RateLimiter;
  private readonly fetchImpl: FetchFunction;
  private readonly sleep: (durationMs: number) => Promise<void>;

  constructor(options: BeatmapFileDownloaderOptions) {
    this.logger = options.logger;
    this.rateLimiter =
      options.rateLimiter ??
      new FixedWindowRateLimiter({
        requests: 60,
        windowMs: 60_000,
        logger: options.logger,
        label: 'osu-beatmap-files',
      });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? sleep;
  }

  /**
   * Throws, so the queue retries the job later, on network errors, timeouts,
   * a 429 that outlasts the retries, any other status but 200 and 404, and an
   * HTML page: a refusal or challenge in front of osu! says nothing about the
   * map, so recording it would leave the beatmap without a file.
   */
  async download(osuBeatmapId: number): Promise<BeatmapFileDownload> {
    for (let retry = 0; ; retry++) {
      const attempt = await this.rateLimiter.schedule(() =>
        this.request(osuBeatmapId)
      );

      if (attempt.status !== 'rate_limited') {
        return attempt;
      }

      if (retry === MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `osu! still rate limited ${beatmapFileUrl(osuBeatmapId)} after ${MAX_RATE_LIMIT_RETRIES} retries`
        );
      }

      const waitSeconds = retryAfterSeconds(attempt.retryAfter, retry);
      this.logger.warn('osu! rate limited a beatmap file download', {
        osuBeatmapId,
        waitSeconds,
      });
      await this.sleep(waitSeconds * 1000);
    }
  }

  private async request(osuBeatmapId: number): Promise<Attempt> {
    const url = beatmapFileUrl(osuBeatmapId);
    let response: Response;
    let bytes: Uint8Array | null = null;

    try {
      // The signal also bounds reading the body.
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (response.ok) {
        bytes = await readBody(response, MAX_FILE_BYTES);
      } else {
        await response.body?.cancel();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Downloading ${url} failed: ${reason}`, {
        cause: error,
      });
    }

    if (response.status === 429) {
      return {
        status: 'rate_limited',
        retryAfter: response.headers.get('retry-after'),
      };
    }

    if (response.status === 404) {
      return { status: 'not_found' };
    }

    if (!response.ok) {
      throw new Error(`Downloading ${url} failed: HTTP ${response.status}`);
    }

    if (!bytes) {
      return {
        status: 'invalid',
        reason: `larger than ${MAX_FILE_MEGABYTES} MB`,
      };
    }

    // osu! answers 200 with an empty body for a deleted beatmap.
    if (bytes.byteLength === 0) {
      return { status: 'not_found' };
    }

    if (isHtml(response)) {
      throw new Error(
        `Downloading ${url} failed: the response is an HTML page`
      );
    }

    if (!hasFileHeader(bytes)) {
      return {
        status: 'invalid',
        reason: `does not start with "${FILE_HEADER}"`,
      };
    }

    return {
      status: 'ok',
      bytes,
      checksum: new Bun.CryptoHasher('md5').update(bytes).digest('hex'),
    };
  }
}
