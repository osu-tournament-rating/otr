import { describe, expect, it } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { TournamentDataCompletionService } from '../../src/osu/services/tournament-data-completion-service';
import type { DatabaseClient } from '../../src/db';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import * as schema from '@otr/core/db/schema';
import { syncTournamentDateRange } from '@otr/core/db';
import type { Logger } from '../../src/logging/logger';
import { VerificationStatus } from '@otr/core/osu/enums';

interface MatchRow {
  id: number;
  tournamentId: number;
  dataFetchStatus: number;
  verificationStatus: number;
  startTime: string | null;
}

interface BeatmapRow {
  id: number;
  dataFetchStatus: number;
  manualOverride: boolean;
}

interface TournamentRow {
  id: number;
  startTime: string | null;
  endTime: string | null;
  updated?: string | null;
}

interface GameRow {
  matchId: number;
  beatmapId: number;
}

interface JoinRow {
  pooledBeatmapsId: number;
  tournamentsPooledInId: number;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const dialect = new PgDialect();

const render = (condition: unknown) =>
  condition
    ? dialect.sqlToQuery(condition as SQL)
    : { sql: '', params: [] as unknown[] };

const extractColumnName = (condition: unknown): string | undefined =>
  render(condition).sql.match(/"[^"]+"\."([^"]+)"/)?.[1];

const extractNumbers = (condition: unknown): number[] =>
  render(condition).params.filter(
    (param): param is number => typeof param === 'number'
  );

const excludesManualOverride = (condition: unknown): boolean =>
  render(condition).sql.includes('manual_override');

class TournamentDataTestDb {
  matches = new Map<number, MatchRow>();
  beatmaps = new Map<number, BeatmapRow>();
  tournaments = new Map<number, TournamentRow>();
  games: GameRow[] = [];
  joins: JoinRow[] = [];

  constructor(options: {
    matches: MatchRow[];
    beatmaps: BeatmapRow[];
    games: GameRow[];
    joins: JoinRow[];
    tournaments?: TournamentRow[];
  }) {
    options.matches.forEach((match) =>
      this.matches.set(match.id, { ...match })
    );
    options.beatmaps.forEach((beatmap) =>
      this.beatmaps.set(beatmap.id, { ...beatmap })
    );
    options.tournaments?.forEach((tournament) =>
      this.tournaments.set(tournament.id, { ...tournament })
    );
    this.games = options.games.map((game) => ({ ...game }));
    this.joins = options.joins.map((join) => ({ ...join }));
  }

  query = {
    matches: {
      findFirst: async (args: { where: unknown }) => {
        const matchIds = extractNumbers(args.where);
        const match = matchIds
          .map((id) => this.matches.get(id))
          .find((row): row is MatchRow => Boolean(row));

        if (!match) {
          return null;
        }

        return {
          id: match.id,
          tournamentId: match.tournamentId,
          dataFetchStatus: match.dataFetchStatus,
          verificationStatus: match.verificationStatus,
        };
      },
      findMany: async (args: { where: unknown }) => {
        const tournamentIds = extractNumbers(args.where);
        const [tournamentId] = tournamentIds;

        return Array.from(this.matches.values())
          .filter((match) => match.tournamentId === tournamentId)
          .map((match) => ({
            id: match.id,
            dataFetchStatus: match.dataFetchStatus,
            startTime: match.startTime,
          }));
      },
    },
    beatmaps: {
      findFirst: async (args: { where: unknown }) => {
        const beatmapIds = extractNumbers(args.where);
        const beatmap = beatmapIds
          .map((id) => this.beatmaps.get(id))
          .find((row): row is BeatmapRow => Boolean(row));

        if (!beatmap) {
          return null;
        }

        return {
          id: beatmap.id,
          dataFetchStatus: beatmap.dataFetchStatus,
        };
      },
    },
    tournaments: {
      findFirst: async (args: { where: unknown }) => {
        const tournamentIds = extractNumbers(args.where);
        const tournament = tournamentIds
          .map((id) => this.tournaments.get(id))
          .find((row): row is TournamentRow => Boolean(row));

        if (!tournament) {
          return null;
        }

        return {
          startTime: tournament.startTime,
          endTime: tournament.endTime,
        };
      },
    },
  } as const;

  // The service locks tournaments with raw SQL inside a transaction of its own.
  execute = async () => ({ rows: [] });

  transaction = async <T>(fn: (tx: TournamentDataTestDb) => Promise<T>) =>
    fn(this);

  update(table: unknown) {
    if (table === schema.matches) {
      return {
        set: (values: Partial<MatchRow>) => ({
          where: (condition: unknown) => {
            const [matchId] = extractNumbers(condition);
            const match = this.matches.get(matchId);
            if (match && typeof values.dataFetchStatus === 'number') {
              match.dataFetchStatus = values.dataFetchStatus;
            }
            return undefined;
          },
        }),
      };
    }

    if (table === schema.beatmaps) {
      return {
        set: (values: Partial<BeatmapRow>) => ({
          where: (condition: unknown) => {
            const [beatmapId] = extractNumbers(condition);
            const beatmap = this.beatmaps.get(beatmapId);
            if (
              beatmap &&
              typeof values.dataFetchStatus === 'number' &&
              !(excludesManualOverride(condition) && beatmap.manualOverride)
            ) {
              beatmap.dataFetchStatus = values.dataFetchStatus;
            }
            return undefined;
          },
        }),
      };
    }

    if (table === schema.tournaments) {
      return {
        set: (values: Partial<TournamentRow>) => ({
          where: (condition: unknown) => {
            const [tournamentId] = extractNumbers(condition);
            const tournament = this.tournaments.get(tournamentId);
            if (tournament) {
              if (Object.prototype.hasOwnProperty.call(values, 'startTime')) {
                tournament.startTime = values.startTime ?? null;
              }
              if (Object.prototype.hasOwnProperty.call(values, 'endTime')) {
                tournament.endTime = values.endTime ?? null;
              }
              if (Object.prototype.hasOwnProperty.call(values, 'updated')) {
                tournament.updated = values.updated ?? null;
              }
            }
            return undefined;
          },
        }),
      };
    }

    throw new Error('Unsupported update table in test database');
  }

  select() {
    return new SelectBuilder(this);
  }
}

class SelectBuilder {
  private table: unknown;
  private joinTable: unknown;

  constructor(private readonly db: TournamentDataTestDb) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  innerJoin(table: unknown) {
    this.joinTable = table;
    return this;
  }

  where(condition: unknown) {
    const column = extractColumnName(condition);
    const values = extractNumbers(condition);

    if (this.table === schema.matches && column === 'tournament_id') {
      const [tournamentId] = values;
      return Array.from(this.db.matches.values())
        .filter((match) => match.tournamentId === tournamentId)
        .map((match) => ({
          id: match.id,
          dataFetchStatus: match.dataFetchStatus,
          startTime: match.startTime,
        }));
    }

    if (
      this.table === schema.joinPooledBeatmaps &&
      column === 'pooled_beatmaps_id'
    ) {
      const [beatmapId] = values;
      return this.db.joins
        .filter((join) => join.pooledBeatmapsId === beatmapId)
        .map((join) => ({ tournamentId: join.tournamentsPooledInId }));
    }

    if (
      this.table === schema.joinPooledBeatmaps &&
      column === 'tournaments_pooled_in_id'
    ) {
      const [tournamentId] = values;
      return this.db.joins
        .filter((join) => join.tournamentsPooledInId === tournamentId)
        .map((join) => ({ beatmapId: join.pooledBeatmapsId }));
    }

    if (this.table === schema.beatmaps && column === 'id') {
      return values
        .map((id) => this.db.beatmaps.get(id))
        .filter((row): row is BeatmapRow => Boolean(row))
        .map((row) => ({ dataFetchStatus: row.dataFetchStatus }));
    }

    if (this.table === schema.games) {
      if (column === 'tournament_id' && this.joinTable === schema.matches) {
        const [tournamentId] = values;
        const matchIds = Array.from(this.db.matches.values())
          .filter((match) => match.tournamentId === tournamentId)
          .map((match) => match.id);

        return this.db.games
          .filter((game) => matchIds.includes(game.matchId))
          .map((game) => ({ beatmapId: game.beatmapId }));
      }

      if (column === 'beatmap_id') {
        const [beatmapId] = values;
        return this.db.games
          .filter((game) => game.beatmapId === beatmapId)
          .map((game) => {
            const match = this.db.matches.get(game.matchId);
            return match ? { tournamentId: match.tournamentId } : null;
          })
          .filter((row): row is { tournamentId: number } => Boolean(row));
      }
    }

    return [];
  }
}

describe('TournamentDataCompletionService', () => {
  it('leaves a manually configured beatmap status alone', async () => {
    const db = new TournamentDataTestDb({
      matches: [],
      beatmaps: [
        {
          id: 10,
          dataFetchStatus: DataFetchStatus.NotFound,
          manualOverride: true,
        },
        {
          id: 11,
          dataFetchStatus: DataFetchStatus.NotFetched,
          manualOverride: false,
        },
      ],
      games: [],
      joins: [],
    });

    const service = new TournamentDataCompletionService({
      db: db as unknown as DatabaseClient,
      logger: noopLogger,
    });

    await service.updateBeatmapFetchStatus(10, DataFetchStatus.Fetched);
    await service.updateBeatmapFetchStatus(11, DataFetchStatus.Fetched);

    expect(db.beatmaps.get(10)?.dataFetchStatus).toBe(DataFetchStatus.NotFound);
    expect(db.beatmaps.get(11)?.dataFetchStatus).toBe(DataFetchStatus.Fetched);
  });

  it('updates tournament start and end dates when matches are fully fetched', async () => {
    const db = new TournamentDataTestDb({
      matches: [
        {
          id: 1,
          tournamentId: 200,
          dataFetchStatus: DataFetchStatus.NotFetched,
          verificationStatus: VerificationStatus.None,
          startTime: '2024-03-01T12:00:00.000Z',
        },
        {
          id: 2,
          tournamentId: 200,
          dataFetchStatus: DataFetchStatus.NotFetched,
          verificationStatus: VerificationStatus.None,
          startTime: '2024-03-05T15:30:00.000Z',
        },
      ],
      beatmaps: [],
      games: [],
      joins: [],
      tournaments: [{ id: 200, startTime: null, endTime: null, updated: null }],
    });

    const service = new TournamentDataCompletionService({
      db: db as unknown as DatabaseClient,
      logger: noopLogger,
    });

    await service.updateMatchFetchStatus(1, DataFetchStatus.Fetched);
    const afterFirst = db.tournaments.get(200);
    expect(afterFirst?.startTime).toBeNull();
    expect(afterFirst?.endTime).toBeNull();

    await service.updateMatchFetchStatus(2, DataFetchStatus.Fetched);
    const afterSecond = db.tournaments.get(200);
    expect(afterSecond?.startTime).toBe('2024-03-01T12:00:00.000Z');
    expect(afterSecond?.endTime).toBe('2024-03-05T15:30:00.000Z');
    expect(afterSecond?.updated).toBeString();
  });

  it('clears tournament date range when no matches remain', async () => {
    const db = new TournamentDataTestDb({
      matches: [],
      beatmaps: [],
      games: [],
      joins: [],
      tournaments: [
        {
          id: 300,
          startTime: '2024-04-01T00:00:00.000Z',
          endTime: '2024-04-05T00:00:00.000Z',
          updated: null,
        },
      ],
    });

    await syncTournamentDateRange(db as unknown as DatabaseClient, 300, {
      logger: noopLogger,
    });

    const updated = db.tournaments.get(300);
    expect(updated?.startTime).toBeNull();
    expect(updated?.endTime).toBeNull();
    expect(updated?.updated).toBeString();
  });
});
