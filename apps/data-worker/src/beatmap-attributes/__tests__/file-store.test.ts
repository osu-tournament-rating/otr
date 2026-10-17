import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  beatmapFileKey,
  checkBeatmapFileStore,
  createBeatmapFileStore,
  GcsBeatmapFileStore,
  LocalBeatmapFileStore,
  withTimeout,
  type BeatmapFileStore,
} from '../file-store';

const encode = (text: string) => new TextEncoder().encode(text);

const ACCESS_KEY_ID = 'test-access-id';
const SECRET_ACCESS_KEY = 'test-secret';

describe('beatmapFileKey', () => {
  it('names the object by osu! beatmap id and checksum', () => {
    expect(beatmapFileKey(129891, 'abc123')).toBe('beatmaps/129891/abc123.osu');
  });
});

describe('withTimeout', () => {
  it('resolves with the value of a promise that settles in time', async () => {
    expect(await withTimeout(Promise.resolve(42), 1000, 'Answering')).toBe(42);
  });

  it('passes a rejection through', async () => {
    const failure = new Error('boom');

    await expect(
      withTimeout(Promise.reject(failure), 1000, 'Failing')
    ).rejects.toBe(failure);
  });

  it('rejects with the description once the timeout passes', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 10, 'Reading beatmaps/1/a.osu')
    ).rejects.toThrow('Reading beatmaps/1/a.osu timed out after 10 ms');
  });
});

describe('LocalBeatmapFileStore', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'otr-beatmap-files-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a file under its directory and reads it back', async () => {
    const store = new LocalBeatmapFileStore({ dir });
    const bytes = encode('osu file format v14\n');
    const key = beatmapFileKey(1, 'abc');

    await store.put(key, bytes);

    expect(await store.get(key)).toEqual(bytes);
    expect(await Bun.file(join(dir, 'beatmaps/1/abc.osu')).bytes()).toEqual(
      bytes
    );
  });

  it('returns null for a missing file', async () => {
    const store = new LocalBeatmapFileStore({ dir });

    expect(await store.get(beatmapFileKey(2, 'missing'))).toBeNull();
  });

  it('reports the resolved directory as its location', () => {
    const store = new LocalBeatmapFileStore({ dir: join(dir, 'a', '..') });

    expect(store.location).toBe(dir);
  });
});

describe('createBeatmapFileStore', () => {
  it('builds a local store for a directory', () => {
    const store = createBeatmapFileStore({ kind: 'local', dir: '/tmp/files' });

    expect(store).toBeInstanceOf(LocalBeatmapFileStore);
    expect(store.location).toBe('/tmp/files');
  });

  it('builds a GCS store whose location leaves out the HMAC key', () => {
    const store = createBeatmapFileStore({
      kind: 'gcs',
      bucket: 'otr-beatmaps',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(store).toBeInstanceOf(GcsBeatmapFileStore);
    expect(store.location).toBe('gs://otr-beatmaps');
  });
});

// Answers the way the GCS XML API does, without checking signatures.
describe('GcsBeatmapFileStore against a fake server', () => {
  const objects = new Map<
    string,
    { body: Uint8Array<ArrayBuffer>; type: string | null }
  >();
  let server: ReturnType<typeof Bun.serve>;

  const errorResponse = (status: number, code: string, message: string) =>
    new Response(
      `<?xml version='1.0' encoding='UTF-8'?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
      { status, headers: { 'content-type': 'application/xml' } }
    );

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        const path = new URL(request.url).pathname;

        if (path.startsWith('/missing-bucket/')) {
          return errorResponse(
            404,
            'NoSuchBucket',
            'The specified bucket does not exist.'
          );
        }

        if (path.startsWith('/denied/')) {
          return errorResponse(403, 'AccessDenied', 'Access denied.');
        }

        if (path.startsWith('/slow/')) {
          await Bun.sleep(500);
          return new Response('late');
        }

        if (request.method === 'PUT') {
          objects.set(path, {
            body: new Uint8Array(await request.arrayBuffer()),
            type: request.headers.get('content-type'),
          });
          return new Response(null, { status: 200 });
        }

        const object = objects.get(path);

        return object
          ? new Response(object.body)
          : errorResponse(
              404,
              'NoSuchKey',
              'The specified key does not exist.'
            );
      },
    });
  });

  afterEach(() => {
    objects.clear();
  });

  afterAll(() => {
    server.stop(true);
  });

  const storeFor = (bucket: string, timeoutMs?: number) =>
    new GcsBeatmapFileStore({
      bucket,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      endpoint: `http://127.0.0.1:${server.port}`,
      timeoutMs,
    });

  it('writes a plain-text object and reads it back', async () => {
    const store = storeFor('otr-beatmaps');
    const bytes = encode('osu file format v14\n');
    const key = beatmapFileKey(1, 'abc');

    await store.put(key, bytes);

    const stored = objects.get('/otr-beatmaps/beatmaps/1/abc.osu');
    expect(stored?.body).toEqual(bytes);
    expect(stored?.type).toStartWith('text/plain');
    expect(await store.get(key)).toEqual(bytes);
  });

  it('returns null for a missing object', async () => {
    expect(
      await storeFor('otr-beatmaps').get(beatmapFileKey(2, 'missing'))
    ).toBeNull();
  });

  it('throws for a missing bucket instead of reporting the object lost', async () => {
    await expect(
      storeFor('missing-bucket').get(beatmapFileKey(1, 'abc'))
    ).rejects.toMatchObject({ code: 'NoSuchBucket' });
  });

  it('throws when access is denied', async () => {
    await expect(
      storeFor('denied').get(beatmapFileKey(1, 'abc'))
    ).rejects.toMatchObject({ code: 'AccessDenied' });
  });

  it('gives up on a call that outlasts the timeout', async () => {
    await expect(
      storeFor('slow', 50).get(beatmapFileKey(1, 'abc'))
    ).rejects.toThrow('timed out after 50 ms');
  });

  it('passes the probe on a working bucket', async () => {
    await checkBeatmapFileStore(storeFor('otr-beatmaps'));

    expect(objects.has('/otr-beatmaps/beatmaps/.probe')).toBe(true);
  });

  it('fails the probe with the S3 error code and no credentials', async () => {
    const error = await checkBeatmapFileStore(storeFor('denied')).then(
      () => null,
      (failure: Error) => failure
    );

    expect(error?.message).toContain('gs://denied');
    expect(error?.message).toContain('AccessDenied: Access denied.');
    expect(error?.message).not.toContain(ACCESS_KEY_ID);
    expect(error?.message).not.toContain(SECRET_ACCESS_KEY);
  });
});

describe('checkBeatmapFileStore', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'otr-beatmap-probe-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads back a probe object', async () => {
    await checkBeatmapFileStore(new LocalBeatmapFileStore({ dir }));

    expect(await Bun.file(join(dir, 'beatmaps/.probe')).exists()).toBe(true);
  });

  it('fails when the store cannot write', async () => {
    const notADirectory = join(dir, 'file');
    await writeFile(notADirectory, 'x');

    await expect(
      checkBeatmapFileStore(new LocalBeatmapFileStore({ dir: notADirectory }))
    ).rejects.toThrow(`Beatmap file store ${notADirectory} is unusable`);
  });

  it('fails when the store does not return what it was given', async () => {
    const forgetful: BeatmapFileStore = {
      location: 'forgetful',
      put: async () => {},
      get: async () => null,
    };
    const garbling: BeatmapFileStore = {
      location: 'garbling',
      put: async () => {},
      get: async () => encode('something else'),
    };

    await expect(checkBeatmapFileStore(forgetful)).rejects.toThrow(
      'did not return the probe object'
    );
    await expect(checkBeatmapFileStore(garbling)).rejects.toThrow(
      'did not return the probe object'
    );
  });
});
