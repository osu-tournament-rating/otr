import { describe, expect, it } from 'bun:test';
import {
  GameRejectionReason,
  GameWarningFlags,
  MatchRejectionReason,
  MatchWarningFlags,
  Mods,
  Ruleset,
  ScoringType,
  ScoreRejectionReason,
  Team,
  TeamType,
  TournamentRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';

import {
  GameAutomationChecks,
  MatchAutomationChecks,
  ScoreAutomationChecks,
  TournamentAutomationCheckService,
  TournamentAutomationChecks,
} from '../index';
import type { Logger } from '../../logging/logger';
import type { TournamentRow } from '../tournament-automation-check-service';
import * as schema from '@otr/core/db/schema';
import type { DatabaseClient } from '../../db';

class UpdateBuilder {
  private values: Record<string, unknown> = {};

  constructor(
    private readonly tableName: string,
    private readonly tx: StubTransaction
  ) {}

  set(values: Record<string, unknown>) {
    this.values = values;
    return this;
  }

  async where() {
    this.tx.record(this.tableName, this.values);
  }
}

class StubTransaction {
  public updates: Array<{ table: string; values: Record<string, unknown> }> =
    [];

  update(table: { tableName?: string }) {
    let tableName = table?.tableName ?? 'unknown';

    if (table === (schema.tournaments as unknown)) {
      tableName = 'tournaments';
    } else if (table === (schema.matches as unknown)) {
      tableName = 'matches';
    } else if (table === (schema.games as unknown)) {
      tableName = 'games';
    } else if (table === (schema.gameScores as unknown)) {
      tableName = 'game_scores';
    }

    return new UpdateBuilder(tableName, this);
  }

  record(table: string, values: Record<string, unknown>) {
    this.updates.push({ table, values });
  }
}

class StubDatabase {
  private readonly row: TournamentRow;
  public transactions: StubTransaction[] = [];

  constructor(row: TournamentRow) {
    this.row = row;
  }

  query = {
    tournaments: {
      findFirst: async () => this.row,
    },
  } as const;

  async transaction<T>(callback: (tx: StubTransaction) => Promise<T>) {
    const tx = new StubTransaction();
    this.transactions.push(tx);
    return callback(tx);
  }
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

describe('TournamentAutomationCheckService', () => {
  it('processes tournament hierarchy and persists verification results', async () => {
    const row: TournamentRow = {
      id: 1,
      abbreviation: 'TT',
      ruleset: Ruleset.Osu,
      lobbySize: 2,
      verificationStatus: VerificationStatus.None,
      rejectionReason: TournamentRejectionReason.None,
      matches: [
        {
          id: 11,
          name: 'TT: Match',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T02:00:00Z',
          verificationStatus: VerificationStatus.None,
          rejectionReason: MatchRejectionReason.None,
          warningFlags: MatchWarningFlags.None,
          games: Array.from({ length: 4 }, (_, index) => ({
            id: 21 + index,
            osuId: 555 + index,
            matchId: 11,
            ruleset: Ruleset.Osu,
            scoringType: ScoringType.ScoreV2,
            teamType: TeamType.TeamVs,
            mods: Mods.None,
            lazerMods: null,
            startTime: `2024-01-01T00:${10 + index}:00Z`,
            endTime: `2024-01-01T00:${20 + index}:00Z`,
            verificationStatus: VerificationStatus.None,
            rejectionReason: GameRejectionReason.None,
            warningFlags: GameWarningFlags.None,
            beatmap: { id: 31 + index, osuId: 777 + index },
            gameScores: [
              {
                id: 41 + index * 4,
                score: 100000,
                mods: Mods.None,
                lazerMods: null,
                team: Team.Red,
                ruleset: Ruleset.Osu,
                verificationStatus: VerificationStatus.None,
                rejectionReason: ScoreRejectionReason.None,
                playerId: 1,
                gameId: 21 + index,
              },
              {
                id: 42 + index * 4,
                score: 95000,
                mods: Mods.None,
                lazerMods: null,
                team: Team.Red,
                ruleset: Ruleset.Osu,
                verificationStatus: VerificationStatus.None,
                rejectionReason: ScoreRejectionReason.None,
                playerId: 2,
                gameId: 21 + index,
              },
              {
                id: 43 + index * 4,
                score: 90000,
                mods: Mods.None,
                lazerMods: null,
                team: Team.Blue,
                ruleset: Ruleset.Osu,
                verificationStatus: VerificationStatus.None,
                rejectionReason: ScoreRejectionReason.None,
                playerId: 3,
                gameId: 21 + index,
              },
              {
                id: 44 + index * 4,
                score: 87000,
                mods: Mods.None,
                lazerMods: null,
                team: Team.Blue,
                ruleset: Ruleset.Osu,
                verificationStatus: VerificationStatus.None,
                rejectionReason: ScoreRejectionReason.None,
                playerId: 4,
                gameId: 21 + index,
              },
            ],
            gameRosters: [],
          })),
          matchRosters: [],
        },
      ],
      joinPooledBeatmaps: [],
    };

    const db = new StubDatabase(row);

    const service = new TournamentAutomationCheckService({
      db: db as unknown as DatabaseClient,
      logger: noopLogger,
      tournamentChecks: new TournamentAutomationChecks(),
      matchChecks: new MatchAutomationChecks(),
      gameChecks: new GameAutomationChecks(),
      scoreChecks: new ScoreAutomationChecks(),
    });

    const result = await service.processAutomationChecks(1, false);

    expect(result).toBe(true);
    expect(db.transactions).toHaveLength(1);

    const updates = db.transactions[0]?.updates ?? [];
    const tournamentUpdate = updates.find(
      (entry) => entry.table === 'tournaments'
    );
    expect(tournamentUpdate?.values.verificationStatus).toBe(
      VerificationStatus.PreVerified
    );

    const matchUpdate = updates.find((entry) => entry.table === 'matches');
    const matchWarnings = matchUpdate?.values.warningFlags as
      number | undefined;
    expect(matchWarnings).not.toBeUndefined();
    expect(matchWarnings! & MatchWarningFlags.LowGameCount).not.toBe(0);

    const gameUpdate = updates.find((entry) => entry.table === 'games');
    expect(gameUpdate?.values.verificationStatus).toBe(
      VerificationStatus.PreVerified
    );

    const scoreUpdates = updates.filter(
      (entry) => entry.table === 'game_scores'
    );
    expect(scoreUpdates).toHaveLength(16);
    expect(
      scoreUpdates.every(
        (entry) =>
          entry.values.verificationStatus === VerificationStatus.PreVerified
      )
    ).toBe(true);
  });
});
