import { S3Client } from 'bun';
import { join, resolve } from 'node:path';

import type { BeatmapFilesConfig } from './env';

const GCS_ENDPOINT = 'https://storage.googleapis.com';
const PROBE_KEY = 'beatmaps/.probe';

/** Upper bound for one store call; Bun's S3Client has no request timeout. */
export const BEATMAP_FILE_STORE_TIMEOUT_MS = 30_000;

/**
 * Objects are named by checksum, so an updated map gets a new object and the
 * previous file stays readable.
 */
export const beatmapFileKey = (osuBeatmapId: number, checksum: string) =>
  `beatmaps/${osuBeatmapId}/${checksum}.osu`;

export interface BeatmapFileStore {
  /**
   * For logs: `gs://bucket` or the local directory. Never includes
   * credentials.
   */
  readonly location: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
}

/**
 * Rejects when the promise has not settled within timeoutMs. The call behind
 * it keeps running, since neither store can cancel a call in flight.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${description} timed out after ${timeoutMs} ms`)),
      timeoutMs
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** E.g. ENOENT, or for an S3Error NoSuchKey or AccessDenied. */
const errorCode = (error: unknown) =>
  error instanceof Error && 'code' in error ? String(error.code) : undefined;

const isS3Error = (error: unknown): error is Error =>
  error instanceof Error && error.name === 'S3Error';

interface GcsBeatmapFileStoreOptions {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Tests point this at a fake server. */
  endpoint?: string;
  timeoutMs?: number;
}

export class GcsBeatmapFileStore implements BeatmapFileStore {
  readonly location: string;

  private readonly client: S3Client;
  private readonly timeoutMs: number;

  constructor(options: GcsBeatmapFileStoreOptions) {
    // Options win over Bun's S3_* and AWS_* defaults, but a session token or
    // region set in the environment still applies, so the worker must not
    // have them.
    this.client = new S3Client({
      endpoint: options.endpoint ?? GCS_ENDPOINT,
      bucket: options.bucket,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
    this.location = `gs://${options.bucket}`;
    this.timeoutMs = options.timeoutMs ?? BEATMAP_FILE_STORE_TIMEOUT_MS;
  }

  async put(key: string, bytes: Uint8Array) {
    await withTimeout(
      this.client.write(key, bytes, { type: 'text/plain' }),
      this.timeoutMs,
      `Writing ${this.location}/${key}`
    );
  }

  async get(key: string) {
    try {
      return await withTimeout(
        this.client.file(key).bytes(),
        this.timeoutMs,
        `Reading ${this.location}/${key}`
      );
    } catch (error) {
      // Only NoSuchKey means the object is gone. exists() is no substitute:
      // it also returns false for a missing bucket.
      if (isS3Error(error) && errorCode(error) === 'NoSuchKey') {
        return null;
      }

      throw error;
    }
  }
}

interface LocalBeatmapFileStoreOptions {
  dir: string;
  timeoutMs?: number;
}

/** Stores files under a local directory, for development and tests. */
export class LocalBeatmapFileStore implements BeatmapFileStore {
  readonly location: string;

  private readonly timeoutMs: number;

  constructor(options: LocalBeatmapFileStoreOptions) {
    this.location = resolve(options.dir);
    this.timeoutMs = options.timeoutMs ?? BEATMAP_FILE_STORE_TIMEOUT_MS;
  }

  async put(key: string, bytes: Uint8Array) {
    await withTimeout(
      Bun.write(this.path(key), bytes),
      this.timeoutMs,
      `Writing ${this.path(key)}`
    );
  }

  async get(key: string) {
    try {
      return await withTimeout(
        Bun.file(this.path(key)).bytes(),
        this.timeoutMs,
        `Reading ${this.path(key)}`
      );
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  private path(key: string) {
    return join(this.location, key);
  }
}

export const createBeatmapFileStore = (
  config: BeatmapFilesConfig
): BeatmapFileStore =>
  config.kind === 'gcs'
    ? new GcsBeatmapFileStore(config)
    : new LocalBeatmapFileStore(config);

// Bun's S3 messages can be as vague as "an unexpected error has occurred";
// the code (e.g. ConnectionRefused) says what went wrong.
const describeStoreError = (error: unknown) => {
  if (isS3Error(error)) {
    return `${errorCode(error)}: ${error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
};

/**
 * Writes and reads back a probe object; throws with a clear message when the
 * store is unusable. The message carries the S3 error code and message only,
 * never credentials.
 */
export const checkBeatmapFileStore = async (store: BeatmapFileStore) => {
  const probe = new TextEncoder().encode(
    `o!TR beatmap file store probe ${new Date().toISOString()}\n`
  );

  let readBack: Uint8Array | null;

  try {
    await store.put(PROBE_KEY, probe);
    readBack = await store.get(PROBE_KEY);
  } catch (error) {
    throw new Error(
      `Beatmap file store ${store.location} is unusable: ${describeStoreError(error)}`,
      { cause: error }
    );
  }

  if (!readBack || !Buffer.from(readBack).equals(probe)) {
    throw new Error(
      `Beatmap file store ${store.location} did not return the probe object it just wrote`
    );
  }
};
