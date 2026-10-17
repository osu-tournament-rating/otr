import { describe, expect, it } from 'bun:test';

import { parseBeatmapFilesEnv } from '../env';

const gcsSource = {
  BEATMAP_FILES_BUCKET: 'bucket-value',
  BEATMAP_FILES_ACCESS_KEY_ID: 'access-id-value',
  BEATMAP_FILES_SECRET_ACCESS_KEY: 'secret-value',
};

describe('parseBeatmapFilesEnv', () => {
  it('turns the feature off when nothing is set', () => {
    expect(parseBeatmapFilesEnv({})).toEqual({ config: null });
  });

  it('treats blank values as unset', () => {
    expect(
      parseBeatmapFilesEnv({
        BEATMAP_FILES_BUCKET: ' ',
        BEATMAP_FILES_ACCESS_KEY_ID: '',
        BEATMAP_FILES_SECRET_ACCESS_KEY: '\t',
        BEATMAP_FILES_DIR: '',
      })
    ).toEqual({ config: null });
  });

  it('reads a GCS bucket with its HMAC key, trimmed', () => {
    expect(
      parseBeatmapFilesEnv({
        BEATMAP_FILES_BUCKET: ' bucket-value ',
        BEATMAP_FILES_ACCESS_KEY_ID: 'access-id-value',
        BEATMAP_FILES_SECRET_ACCESS_KEY: 'secret-value\n',
      })
    ).toEqual({
      config: {
        kind: 'gcs',
        bucket: 'bucket-value',
        accessKeyId: 'access-id-value',
        secretAccessKey: 'secret-value',
      },
    });
  });

  it('reads a local directory', () => {
    expect(
      parseBeatmapFilesEnv({ BEATMAP_FILES_DIR: '/tmp/beatmap-files' })
    ).toEqual({ config: { kind: 'local', dir: '/tmp/beatmap-files' } });
  });

  it('ignores an HMAC key without a bucket', () => {
    expect(
      parseBeatmapFilesEnv({
        BEATMAP_FILES_ACCESS_KEY_ID: 'access-id-value',
        BEATMAP_FILES_SECRET_ACCESS_KEY: 'secret-value',
      })
    ).toEqual({ config: null });

    expect(
      parseBeatmapFilesEnv({
        BEATMAP_FILES_ACCESS_KEY_ID: 'access-id-value',
        BEATMAP_FILES_SECRET_ACCESS_KEY: 'secret-value',
        BEATMAP_FILES_DIR: '/tmp/beatmap-files',
      })
    ).toEqual({ config: { kind: 'local', dir: '/tmp/beatmap-files' } });
  });

  it('names the missing access ID', () => {
    const result = parseBeatmapFilesEnv({
      ...gcsSource,
      BEATMAP_FILES_ACCESS_KEY_ID: '',
    });

    expect(result.config).toBeNull();
    expect(result.error).toContain('BEATMAP_FILES_ACCESS_KEY_ID');
    expect(result.error).not.toContain('BEATMAP_FILES_SECRET_ACCESS_KEY');
  });

  it('names the missing secret', () => {
    const result = parseBeatmapFilesEnv({
      ...gcsSource,
      BEATMAP_FILES_SECRET_ACCESS_KEY: undefined,
    });

    expect(result.config).toBeNull();
    expect(result.error).toContain('BEATMAP_FILES_SECRET_ACCESS_KEY');
    expect(result.error).not.toContain('BEATMAP_FILES_ACCESS_KEY_ID');
  });

  it('names both missing settings', () => {
    const result = parseBeatmapFilesEnv({
      BEATMAP_FILES_BUCKET: 'bucket-value',
    });

    expect(result.config).toBeNull();
    expect(result.error).toContain('BEATMAP_FILES_ACCESS_KEY_ID');
    expect(result.error).toContain('BEATMAP_FILES_SECRET_ACCESS_KEY');
  });

  it('rejects a bucket and a directory together', () => {
    const result = parseBeatmapFilesEnv({
      ...gcsSource,
      BEATMAP_FILES_DIR: '/tmp/beatmap-files',
    });

    expect(result.config).toBeNull();
    expect(result.error).toContain('BEATMAP_FILES_BUCKET');
    expect(result.error).toContain('BEATMAP_FILES_DIR');
  });

  it('never echoes a value in an error', () => {
    const errors = [
      parseBeatmapFilesEnv({ ...gcsSource, BEATMAP_FILES_DIR: '/tmp/dir' }),
      parseBeatmapFilesEnv({ ...gcsSource, BEATMAP_FILES_ACCESS_KEY_ID: '' }),
      parseBeatmapFilesEnv({
        ...gcsSource,
        BEATMAP_FILES_SECRET_ACCESS_KEY: '',
      }),
    ].map((result) => result.error);

    for (const error of errors) {
      expect(error).toBeString();

      for (const value of [...Object.values(gcsSource), '/tmp/dir']) {
        expect(error).not.toContain(value);
      }
    }
  });
});
