import { describe, expect, it } from 'bun:test';
import { TournamentStatsCalculator } from '../tournament-stats-calculator';
import { TournamentStatsService } from '../tournament-stats-service';
import type { StatsCalculationFailure, StatsTournament } from '../types';
import { Ruleset, Team, VerificationStatus } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

const resolveTableName = (table: unknown) => {
  if (table === (schema.gameRosters as unknown)) {
    return 'game_rosters';
  }
  if (table === (schema.matchRosters as unknown)) {
    return 'match_rosters';
  }
  if (table === (schema.playerMatchStats as unknown)) {
    return 'player_match_stats';
  }
  if (table === (schema.playerTournamentStats as unknown)) {
    return 'player_tournament_stats';
  }
  return 'unknown';
};

class StubDeleteBuilder {
  constructor(
    private readonly tableName: string,
    private readonly tx: StubTransaction
  ) {}

  async where() {
    this.tx.deletes.push(this.tableName);
  }
}

class StubInsertBuilder {
  constructor(
    private readonly tableName: string,
    private readonly tx: StubTransaction
  ) {}

  async values(values: unknown[]) {
    this.tx.inserts.push({ table: this.tableName, values });
  }
}

class StubTransaction {
  public deletes: string[] = [];
  public inserts: Array<{ table: string; values: unknown[] }> = [];

  delete(table: { tableName?: string }) {
    return new StubDeleteBuilder(resolveTableName(table), this);
  }

  insert(table: { tableName?: string }) {
    return new StubInsertBuilder(resolveTableName(table), this);
  }
}

class StubDatabase {
  public transactions: StubTransaction[] = [];
  constructor(private readonly tournamentRow: unknown) {}

  query = {
    tournaments: {
      findFirst: async () => this.tournamentRow,
    },
  } as const;

  async transaction<T>(callback: (tx: StubTransaction) => Promise<T>) {
    const tx = new StubTransaction();
    this.transactions.push(tx);
    return callback(tx);
  }
}

const toDrizzleTournamentRow = (tournament: StatsTournament) => ({
  id: tournament.id,
  verificationStatus: tournament.verificationStatus,
  matches: tournament.matches.map((match) => ({
    id: match.id,
    verificationStatus: match.verificationStatus,
    games: match.games.map((game) => ({
      id: game.id,
      matchId: game.matchId,
      verificationStatus: game.verificationStatus,
      gameScores: game.scores.map((score) => ({
        id: score.id,
        gameId: score.gameId,
        playerId: score.playerId,
        score: score.score,
        placement: score.placement,
        accuracy: score.accuracy,
        statMeh: score.statMeh,
        statOk: score.statOk,
        statGreat: score.statGreat,
        statMiss: score.statMiss,
        statGood: score.statGood,
        statPerfect: score.statPerfect,
        team: score.team,
        ruleset: score.ruleset,
        verificationStatus: score.verificationStatus,
      })),
      gameRosters: game.rosters.map((roster) => ({
        id: roster.id,
        team: roster.team,
        roster: roster.roster,
        score: roster.score,
        gameId: roster.gameId,
      })),
    })),
    matchRosters: [],
    ratingAdjustments: match.playerRatingAdjustments.map((adjustment) => ({
      id: adjustment.id,
      playerId: adjustment.playerId,
      ratingBefore: adjustment.ratingBefore,
      ratingAfter: adjustment.ratingAfter,
    })),
  })),
});

const createVerifiedTournament = (): StatsTournament => ({
  id: 1,
  verificationStatus: VerificationStatus.Verified,
  matches: [
    {
      id: 10,
      verificationStatus: VerificationStatus.Verified,
      games: [
        {
          id: 100,
          matchId: 10,
          verificationStatus: VerificationStatus.Verified,
          rosters: [],
          scores: [
            {
              id: 1,
              gameId: 100,
              playerId: 1,
              score: 100_000,
              placement: 1,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Red,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 2,
              gameId: 100,
              playerId: 2,
              score: 95_000,
              placement: 2,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Red,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 3,
              gameId: 100,
              playerId: 3,
              score: 90_000,
              placement: 3,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Blue,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 4,
              gameId: 100,
              playerId: 4,
              score: 85_000,
              placement: 4,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Blue,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
          ],
        },
      ],
      playerRatingAdjustments: [
        { id: 1000, playerId: 1, ratingBefore: 1000, ratingAfter: 1010 },
        { id: 1001, playerId: 2, ratingBefore: 1000, ratingAfter: 1005 },
        { id: 1002, playerId: 3, ratingBefore: 1000, ratingAfter: 995 },
        { id: 1003, playerId: 4, ratingBefore: 1000, ratingAfter: 990 },
      ],
    },
  ],
});

describe('TournamentStatsService', () => {
  it('persists calculator results and logs success', async () => {
    const calculator = new TournamentStatsCalculator();
    const tournament = createVerifiedTournament();
    const db = new StubDatabase(toDrizzleTournamentRow(tournament));

    const service = new TournamentStatsService({
      db: db as unknown as DatabaseClient,
      logger: noopLogger,
      calculator,
    });

    const outcome = await service.processTournamentStats(tournament.id);
    expect(outcome).toEqual({ status: 'processed' });

    expect(db.transactions).toHaveLength(1);
    const [tx] = db.transactions;
    expect(tx.deletes).toEqual(
      expect.arrayContaining([
        'game_rosters',
        'match_rosters',
        'player_match_stats',
        'player_tournament_stats',
      ])
    );

    const matchStatsInsert = tx.inserts.find(
      (insert) => insert.table === 'player_match_stats'
    );
    expect(matchStatsInsert).toBeDefined();
    expect(matchStatsInsert?.values).toHaveLength(4);

    const tournamentStatsInsert = tx.inserts.find(
      (insert) => insert.table === 'player_tournament_stats'
    );
    expect(tournamentStatsInsert).toBeDefined();
    expect(tournamentStatsInsert?.values).toHaveLength(4);
  });

  it('skips a missing tournament', async () => {
    const calculator = new TournamentStatsCalculator();
    const db = new StubDatabase(null);

    const service = new TournamentStatsService({
      db: db as unknown as DatabaseClient,
      logger: noopLogger,
      calculator,
    });

    const outcome = await service.processTournamentStats(999);
    expect(outcome.status).toBe('skipped');
    expect(db.transactions).toHaveLength(0);
  });

  it('reports a failure when the calculator fails', async () => {
    const failingCalculator = {
      calculateAllStatistics(): StatsCalculationFailure {
        return { success: false, errorMessage: 'boom' };
      },
    } as unknown as TournamentStatsCalculator;

    const tournament = createVerifiedTournament();
    const db = new StubDatabase(toDrizzleTournamentRow(tournament));

    const service = new TournamentStatsService({
      db: db as unknown as DatabaseClient,
      logger: noopLogger,
      calculator: failingCalculator,
    });

    const outcome = await service.processTournamentStats(tournament.id);
    expect(outcome).toEqual({
      status: 'failed',
      reason: 'Calculating statistics failed: boom',
    });
    expect(db.transactions).toHaveLength(0);
  });
});
