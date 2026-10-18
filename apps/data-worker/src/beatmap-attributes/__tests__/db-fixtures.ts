import { and, gte, inArray, like, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

const encoder = new TextEncoder();

/** A small hand-written map; `cs` changes the attributes it yields. */
export const syntheticOsuFile = ({
  mode = 0,
  cs = 4,
}: { mode?: number; cs?: number } = {}) =>
  encoder.encode(
    [
      'osu file format v14',
      '',
      '[General]',
      'AudioFilename: audio.mp3',
      `Mode: ${mode}`,
      '',
      '[Metadata]',
      'Title:Synthetic',
      'Artist:o!TR',
      'Creator:o!TR',
      'Version:Test',
      '',
      '[Difficulty]',
      'HPDrainRate:5',
      `CircleSize:${cs}`,
      'OverallDifficulty:8',
      'ApproachRate:9',
      'SliderMultiplier:1.4',
      'SliderTickRate:1',
      '',
      '[TimingPoints]',
      '0,300,4,2,0,60,1,0',
      '',
      '[HitObjects]',
      '64,64,1000,1,0,0:0:0:0:',
      '448,320,1150,1,0,0:0:0:0:',
      '64,320,1300,1,0,0:0:0:0:',
      '448,64,1450,1,0,0:0:0:0:',
      '256,192,1600,1,0,0:0:0:0:',
      '96,192,1750,1,0,0:0:0:0:',
      '416,192,1900,1,0,0:0:0:0:',
      '256,32,2050,1,0,0:0:0:0:',
      '64,192,2200,2,0,B|192:64|320:64|448:192,1,420',
      '448,320,3250,1,0,0:0:0:0:',
      '',
    ].join('\n')
  );

export const md5 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher('md5').update(bytes).digest('hex');

export const createTestDb = (url: string) => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  return { pool, db };
};

interface GameSeed {
  beatmapId: number;
  mods?: number;
  ruleset?: Ruleset;
  verificationStatus?: VerificationStatus;
  /** Defaults to Verified in a verified game, None otherwise. */
  scoreVerificationStatus?: VerificationStatus;
  /** Mods of each score; each score gets its own player. */
  scores: number[];
}

// Far above any real osu! id, so seeded rows never collide with real ones.
const SEED_OSU_ID_BASE = 90_000_000_000;
const SEED_OSU_ID_RANGE = 10_000;

/**
 * Seeds rows with osu! ids from a range of their own per test file (`slot`),
 * so the files stay clear of real data and of each other. `remove()` deletes
 * everything it made.
 */
export class AttributeTestSeed {
  private readonly beatmapOsuIds: number[] = [];
  private readonly tournamentIds: number[] = [];
  private readonly playerIds: number[] = [];
  private readonly base: number;
  private nextOsuId: number;
  private matchId: number | null = null;

  constructor(
    private readonly db: DatabaseClient,
    slot: number
  ) {
    this.base = SEED_OSU_ID_BASE + slot * SEED_OSU_ID_RANGE;
    this.nextOsuId = this.base;
  }

  private osuId() {
    if (this.nextOsuId >= this.base + SEED_OSU_ID_RANGE) {
      throw new Error('Seed osu! id range exhausted');
    }

    return this.nextOsuId++;
  }

  private get tournamentPrefix() {
    return `Beatmap attributes test ${this.base}`;
  }

  /** Clears rows a crashed earlier run may have left. */
  async removeLeftovers() {
    const end = this.base + SEED_OSU_ID_RANGE;

    await this.db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${this.tournamentPrefix} #%`));
    await this.db
      .delete(schema.beatmaps)
      .where(
        and(
          gte(schema.beatmaps.osuId, this.base),
          lt(schema.beatmaps.osuId, end)
        )
      );
    await this.db
      .delete(schema.players)
      .where(
        and(gte(schema.players.osuId, this.base), lt(schema.players.osuId, end))
      );
  }

  async beatmap({
    ruleset = Ruleset.Osu,
    dataFetchStatus = DataFetchStatus.Fetched,
  }: { ruleset?: Ruleset; dataFetchStatus?: DataFetchStatus } = {}) {
    const osuId = this.osuId();
    this.beatmapOsuIds.push(osuId);

    const [row] = await this.db
      .insert(schema.beatmaps)
      .values({
        osuId,
        ruleset,
        rankedStatus: 1,
        diffName: `attributes test ${osuId}`,
        totalLength: 60,
        drainLength: 60,
        bpm: 200,
        countCircle: 10,
        countSlider: 1,
        countSpinner: 0,
        cs: 4,
        hp: 5,
        od: 8,
        ar: 9,
        sr: 3,
        dataFetchStatus,
      })
      .returning({ id: schema.beatmaps.id, osuId: schema.beatmaps.osuId });

    return row!;
  }

  private async tournament() {
    const number = this.tournamentIds.length + 1;
    const [tournament] = await this.db
      .insert(schema.tournaments)
      .values({
        name: `${this.tournamentPrefix} #${number}`,
        abbreviation: `BAT${number}`,
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${this.osuId()}`,
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 4,
        verificationStatus: VerificationStatus.Verified,
      })
      .returning({ id: schema.tournaments.id });
    this.tournamentIds.push(tournament!.id);
    return tournament!.id;
  }

  private async match() {
    if (this.matchId === null) {
      const tournamentId = await this.tournament();
      const [match] = await this.db
        .insert(schema.matches)
        .values({
          osuId: this.osuId(),
          tournamentId,
          verificationStatus: VerificationStatus.Verified,
        })
        .returning({ id: schema.matches.id });
      this.matchId = match!.id;
    }

    return this.matchId;
  }

  private async player() {
    const osuId = this.osuId();
    const [player] = await this.db
      .insert(schema.players)
      .values({ osuId, username: `attributes-${osuId}` })
      .returning({ id: schema.players.id });
    this.playerIds.push(player!.id);
    return player!.id;
  }

  async game({
    beatmapId,
    mods = 0,
    ruleset = Ruleset.Osu,
    verificationStatus = VerificationStatus.Verified,
    scoreVerificationStatus,
    scores,
  }: GameSeed) {
    const matchId = await this.match();
    const [game] = await this.db
      .insert(schema.games)
      .values({
        osuId: this.osuId(),
        ruleset,
        scoringType: 3,
        teamType: 0,
        mods,
        matchId,
        beatmapId,
        verificationStatus,
      })
      .returning({ id: schema.games.id });

    // A verified score cannot sit in a rejected game.
    const scoreStatus =
      scoreVerificationStatus ??
      (verificationStatus === VerificationStatus.Verified
        ? VerificationStatus.Verified
        : VerificationStatus.None);

    for (const [index, scoreMods] of scores.entries()) {
      await this.db.insert(schema.gameScores).values({
        rawScore: 500_000,
        placement: index + 1,
        accuracy: 0.95,
        maxCombo: 100,
        pass: true,
        isPerfectCombo: false,
        legacyPerfect: false,
        grade: 2,
        mods: scoreMods,
        team: 0,
        ruleset,
        verificationStatus: scoreStatus,
        rejectionReason: 0,
        legacyTotalScore: 500_000,
        gameId: game!.id,
        playerId: await this.player(),
      });
    }

    return game!.id;
  }

  async pool(beatmapId: number) {
    const tournamentId = await this.tournament();
    await this.db.insert(schema.joinPooledBeatmaps).values({
      pooledBeatmapsId: beatmapId,
      tournamentsPooledInId: tournamentId,
    });
  }

  async remove() {
    if (this.tournamentIds.length > 0) {
      await this.db
        .delete(schema.tournaments)
        .where(inArray(schema.tournaments.id, this.tournamentIds));
    }

    if (this.beatmapOsuIds.length > 0) {
      await this.db
        .delete(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, this.beatmapOsuIds));
    }

    if (this.playerIds.length > 0) {
      await this.db
        .delete(schema.players)
        .where(inArray(schema.players.id, this.playerIds));
    }
  }
}
