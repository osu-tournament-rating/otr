import { optionalEnv } from '@otr/core/utils/env';

export type BeatmapFilesConfig =
  | {
      kind: 'gcs';
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | { kind: 'local'; dir: string };

export interface BeatmapFilesEnv {
  /** Null turns beatmap file storage and attribute calculation off. */
  config: BeatmapFilesConfig | null;
  /** Set when the settings are incomplete or conflict; config is then null. */
  error?: string;
}

/**
 * Reads the beatmap file storage settings. Never throws: a bad setting turns
 * the feature off with an error the worker logs, so the rest keeps running.
 * Errors name settings and never echo their values.
 */
export const parseBeatmapFilesEnv = (
  source: Record<string, string | undefined>
): BeatmapFilesEnv => {
  const bucket = optionalEnv(source.BEATMAP_FILES_BUCKET);
  const accessKeyId = optionalEnv(source.BEATMAP_FILES_ACCESS_KEY_ID);
  const secretAccessKey = optionalEnv(source.BEATMAP_FILES_SECRET_ACCESS_KEY);
  const dir = optionalEnv(source.BEATMAP_FILES_DIR);

  if (bucket && dir) {
    return {
      config: null,
      error: 'Set BEATMAP_FILES_BUCKET or BEATMAP_FILES_DIR, not both',
    };
  }

  if (bucket) {
    if (!accessKeyId || !secretAccessKey) {
      const missing = [
        !accessKeyId && 'BEATMAP_FILES_ACCESS_KEY_ID',
        !secretAccessKey && 'BEATMAP_FILES_SECRET_ACCESS_KEY',
      ].filter(Boolean);

      return {
        config: null,
        error: `BEATMAP_FILES_BUCKET also needs ${missing.join(' and ')}`,
      };
    }

    return {
      config: { kind: 'gcs', bucket, accessKeyId, secretAccessKey },
    };
  }

  if (dir) {
    return { config: { kind: 'local', dir } };
  }

  return { config: null };
};
