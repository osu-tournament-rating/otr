import { and, eq, notInArray, sql } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';
import {
  CALCULATOR,
  calculateBeatmapAttributes,
  type CalculationResult,
} from './calculator';
import type { BeatmapFileDownloader } from './downloader';
import { beatmapFileKey, type BeatmapFileStore } from './file-store';
import { loadNeededAttributeMods } from './needed-mods';

interface BeatmapAttributesServiceOptions {
  db: DatabaseClient;
  logger: Logger;
  store: BeatmapFileStore;
  downloader: Pick<BeatmapFileDownloader, 'download'>;
}

interface FileUpdate {
  checksum: string | null;
  fetchStatus: DataFetchStatus;
}

/** Whether the rows cover exactly the needed keys, all from this calculator. */
const rowsAreCurrent = (
  rows: ReadonlyArray<{ mods: number; calculator: string }>,
  needed: ReadonlyArray<number>
) => {
  const keys = new Set(rows.map((row) => row.mods));

  return (
    keys.size === needed.length &&
    needed.every((key) => keys.has(key)) &&
    rows.every((row) => row.calculator === CALCULATOR)
  );
};

// The calculator only reads the bytes it is given, so a throw would repeat on
// every retry; it counts as an unusable file instead.
const calculate = (bytes: Uint8Array, mods: number[]): CalculationResult => {
  try {
    return calculateBeatmapAttributes(bytes, mods);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unsupported', reason: `calculation failed: ${message}` };
  }
};

/**
 * Stores a beatmap's .osu file and keeps its attribute rows current.
 *
 * Correct only with a single consumer at prefetch 1: nothing locks the
 * beatmap between reading its rows and writing them. A duplicate job is
 * harmless, because a job with nothing to do returns early.
 */
export class BeatmapAttributesService {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly store: BeatmapFileStore;
  private readonly downloader: Pick<BeatmapFileDownloader, 'download'>;

  constructor(options: BeatmapAttributesServiceOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.store = options.store;
    this.downloader = options.downloader;
  }

  /**
   * Throws on database, storage, and transient download failures, so the
   * queue retries the job.
   */
  async process({
    beatmapId,
    checksum,
  }: {
    beatmapId: number;
    checksum?: string;
  }): Promise<void> {
    const beatmap = await this.db.query.beatmaps.findFirst({
      where: eq(schema.beatmaps.id, beatmapId),
      columns: { id: true, osuId: true },
      with: { beatmapFile: { columns: { checksum: true, fetchStatus: true } } },
    });

    if (!beatmap) {
      this.logger.warn('Beatmap for attribute calculation not found', {
        beatmapId,
      });
      return;
    }

    const { osuId } = beatmap;
    const file = beatmap.beatmapFile;
    const storedChecksum = file?.checksum ?? null;
    const logContext = { beatmapId, osuBeatmapId: osuId };

    const needed = await loadNeededAttributeMods(this.db, beatmapId);
    const existing = await this.db
      .select({
        mods: schema.beatmapAttributes.mods,
        calculator: schema.beatmapAttributes.calculator,
      })
      .from(schema.beatmapAttributes)
      .where(eq(schema.beatmapAttributes.beatmapId, beatmapId));

    let wantDownload =
      !storedChecksum ||
      (checksum !== undefined && checksum !== storedChecksum);

    if (!wantDownload) {
      // Only a fetch that reports a different checksum retries a stored file
      // that is known to be unusable.
      if (file?.fetchStatus === DataFetchStatus.Error) {
        return;
      }

      if (rowsAreCurrent(existing, needed)) {
        return;
      }
    }

    let bytes: Uint8Array | null = null;
    // Checksum of the file in `bytes`.
    let bytesChecksum: string | null = null;
    let lost = false;
    let downloaded = false;
    let fileUpdate: FileUpdate | null = null;

    if (!wantDownload && storedChecksum) {
      bytes = await this.store.get(beatmapFileKey(osuId, storedChecksum));

      if (bytes) {
        bytesChecksum = storedChecksum;
      } else {
        this.logger.warn('Stored beatmap file is missing, downloading again', {
          ...logContext,
          checksum: storedChecksum,
        });
        lost = true;
        wantDownload = true;
      }
    }

    if (wantDownload) {
      const download = await this.downloader.download(osuId);

      if (download.status === 'ok') {
        if (checksum !== undefined && download.checksum !== checksum) {
          // osu! may have updated the map after the fetch read its checksum.
          this.logger.warn('Downloaded beatmap file has another checksum', {
            ...logContext,
            expected: checksum,
            actual: download.checksum,
          });
        }

        await this.store.put(
          beatmapFileKey(osuId, download.checksum),
          download.bytes
        );
        bytes = download.bytes;
        bytesChecksum = download.checksum;
        downloaded = true;
        fileUpdate = {
          checksum: download.checksum,
          fetchStatus: DataFetchStatus.Fetched,
        };
      } else {
        const failure = {
          ...logContext,
          status: download.status,
          reason: download.status === 'invalid' ? download.reason : undefined,
        };
        const olderChecksum = lost ? null : storedChecksum;

        if (olderChecksum) {
          bytes = await this.store.get(beatmapFileKey(osuId, olderChecksum));

          if (!bytes) {
            this.logger.warn('Stored beatmap file is missing', {
              ...logContext,
              checksum: olderChecksum,
            });
          }
        }

        if (bytes) {
          // A failed download says nothing against the stored file, so the
          // row stays Fetched unless the calculator rejects the file below,
          // and a later calculator change still recalculates from it.
          this.logger.warn(
            'osu! served no usable beatmap file, using the stored one',
            { ...failure, checksum: olderChecksum }
          );
          bytesChecksum = olderChecksum;
          fileUpdate = {
            checksum: olderChecksum,
            fetchStatus: DataFetchStatus.Fetched,
          };
        } else {
          this.logger.warn('osu! served no usable beatmap file', failure);
          fileUpdate = {
            checksum: null,
            fetchStatus:
              download.status === 'not_found'
                ? DataFetchStatus.NotFound
                : DataFetchStatus.Error,
          };
        }
      }
    }

    const result = bytes && needed.length > 0 ? calculate(bytes, needed) : null;

    if (result?.status === 'unsupported') {
      this.logger.warn('Beatmap file has no osu! standard attributes', {
        ...logContext,
        checksum: bytesChecksum,
        reason: result.reason,
      });
      fileUpdate = {
        checksum: bytesChecksum,
        fetchStatus: DataFetchStatus.Error,
      };
    }

    const nowIso = new Date().toISOString();

    // One transaction, so a crash leaves the old file row in place and the
    // job downloads again, rather than marking attributes from an older file
    // as current.
    await this.db.transaction(async (tx) => {
      if (fileUpdate) {
        await tx
          .insert(schema.beatmapFiles)
          .values({ beatmapId, ...fileUpdate, updated: nowIso })
          .onConflictDoUpdate({
            target: schema.beatmapFiles.beatmapId,
            set: { ...fileUpdate, updated: nowIso },
          });
      }

      const thisBeatmap = eq(schema.beatmapAttributes.beatmapId, beatmapId);

      if (needed.length === 0 || result?.status === 'unsupported') {
        await tx.delete(schema.beatmapAttributes).where(thisBeatmap);
        return;
      }

      if (result?.status !== 'ok') {
        return;
      }

      await tx
        .insert(schema.beatmapAttributes)
        .values(
          result.attributes.map((row) => ({
            beatmapId,
            ...row,
            calculator: CALCULATOR,
            updated: nowIso,
          }))
        )
        .onConflictDoUpdate({
          target: [
            schema.beatmapAttributes.beatmapId,
            schema.beatmapAttributes.mods,
          ],
          set: {
            sr: sql`excluded.sr`,
            ar: sql`excluded.ar`,
            cs: sql`excluded.cs`,
            od: sql`excluded.od`,
            hp: sql`excluded.hp`,
            calculator: sql`excluded.calculator`,
            updated: sql`excluded.updated`,
          },
        });

      await tx
        .delete(schema.beatmapAttributes)
        .where(
          and(thisBeatmap, notInArray(schema.beatmapAttributes.mods, needed))
        );
    });

    if (result?.status === 'ok') {
      this.logger.info('Beatmap attributes calculated', {
        ...logContext,
        checksum: bytesChecksum,
        mods: needed,
        downloaded,
      });
    }
  }
}
