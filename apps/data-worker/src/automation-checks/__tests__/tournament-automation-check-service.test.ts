import { describe, expect, it } from 'bun:test';
import { Param, type SQL } from 'drizzle-orm';
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

  async where(condition: SQL) {
    const id = condition.queryChunks.find((chunk) => chunk instanceof Param)
      ?.value as number | undefined;
    this.tx.record(this.tableName, this.values, id);
  }
}

class StubTransaction {
  public updates: Array<{
    table: string;
    id?: number;
    values: Record<string, unknown>;
  }> = [];

  constructor(private readonly row: TournamentRow) {}

  query = {
    tournaments: {
      findFirst: async () => this.row,
    },
  } as const;

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

  record(table: string, values: Record<string, unknown>, id?: number) {
    this.updates.push({ table, id, values });
  }
}

class StubDatabase {
  private readonly row: TournamentRow;
  public transactions: StubTransaction[] = [];

  constructor(row: TournamentRow) {
    this.row = row;
  }

  async transaction<T>(callback: (tx: StubTransaction) => Promise<T>) {
    const tx = new StubTransaction(this.row);
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

type MatchRow = TournamentRow['matches'][number];
type GameRow = MatchRow['games'][number];
type ScoreRow = GameRow['gameScores'][number];

const scoreRow = (
  fields: Pick<ScoreRow, 'id' | 'gameId' | 'playerId' | 'team'> &
    Partial<ScoreRow>
): ScoreRow => ({
  score: 100000,
  mods: Mods.None,
  lazerMods: null,
  ruleset: Ruleset.Osu,
  verificationStatus: VerificationStatus.None,
  rejectionReason: ScoreRejectionReason.None,
  ...fields,
});

/** Two players a side, as a lobby size of 2 expects, with ids gameId * 10 + player. */
const lineup = (
  gameId: number,
  verificationStatus = VerificationStatus.None,
  rejectionReason = ScoreRejectionReason.None
) =>
  [1, 2, 3, 4].map((playerId) =>
    scoreRow({
      id: gameId * 10 + playerId,
      gameId,
      playerId,
      team: playerId <= 2 ? Team.Red : Team.Blue,
      verificationStatus,
      rejectionReason,
    })
  );

const gameRow = (
  fields: Pick<GameRow, 'id' | 'matchId'> & Partial<GameRow>
): GameRow => ({
  osuId: 5000 + fields.id,
  ruleset: Ruleset.Osu,
  scoringType: ScoringType.ScoreV2,
  teamType: TeamType.TeamVs,
  mods: Mods.None,
  lazerMods: null,
  startTime: '2024-01-01T00:10:00Z',
  endTime: '2024-01-01T00:20:00Z',
  verificationStatus: VerificationStatus.None,
  rejectionReason: GameRejectionReason.None,
  warningFlags: GameWarningFlags.None,
  beatmap: { id: 7000 + fields.id, osuId: 8000 + fields.id },
  gameScores: lineup(fields.id),
  gameRosters: [],
  ...fields,
});

const matchRow = (
  fields: Pick<MatchRow, 'id' | 'games'> & Partial<MatchRow>
): MatchRow => ({
  name: `TT: Match ${fields.id}`,
  startTime: '2024-01-01T00:00:00Z',
  endTime: '2024-01-01T02:00:00Z',
  verificationStatus: VerificationStatus.None,
  rejectionReason: MatchRejectionReason.None,
  warningFlags: MatchWarningFlags.None,
  matchRosters: [],
  ...fields,
});

/**
 * A tournament an admin has reviewed. Each admin decision differs from what
 * the checks would decide, so re-running a check over one changes it.
 */
const reviewedTournament = (): TournamentRow => ({
  id: 1,
  abbreviation: 'TT',
  ruleset: Ruleset.Osu,
  lobbySize: 2,
  verificationStatus: VerificationStatus.None,
  rejectionReason: TournamentRejectionReason.None,
  joinPooledBeatmaps: [],
  matches: [
    // A clean match the admin rejected, with the rejection cascaded down
    matchRow({
      id: 1,
      verificationStatus: VerificationStatus.Rejected,
      games: [101, 102, 103, 104].map((id) =>
        gameRow({
          id,
          matchId: 1,
          verificationStatus: VerificationStatus.Rejected,
          rejectionReason: GameRejectionReason.RejectedMatch,
          gameScores: lineup(
            id,
            VerificationStatus.Rejected,
            ScoreRejectionReason.RejectedGame
          ),
        })
      ),
    }),
    // A match the admin verified despite a failing game and score
    matchRow({
      id: 2,
      verificationStatus: VerificationStatus.Verified,
      games: [201, 202, 203, 204].map((id) =>
        gameRow({
          id,
          matchId: 2,
          verificationStatus: VerificationStatus.Verified,
          teamType: id === 204 ? TeamType.HeadToHead : TeamType.TeamVs,
          gameScores: lineup(id, VerificationStatus.Verified).map((score) =>
            score.id === 2011 ? { ...score, score: 500 } : score
          ),
        })
      ),
    }),
    // A match still under review, holding admin decisions on games and scores
    matchRow({
      id: 3,
      verificationStatus: VerificationStatus.PreVerified,
      games: [
        gameRow({
          id: 301,
          matchId: 3,
          verificationStatus: VerificationStatus.Rejected,
          gameScores: lineup(
            301,
            VerificationStatus.Rejected,
            ScoreRejectionReason.RejectedGame
          ),
        }),
        gameRow({
          id: 302,
          matchId: 3,
          verificationStatus: VerificationStatus.Verified,
          teamType: TeamType.HeadToHead,
          gameScores: lineup(302, VerificationStatus.Verified),
        }),
        gameRow({
          id: 303,
          matchId: 3,
          verificationStatus: VerificationStatus.PreVerified,
          gameScores: [
            ...lineup(303, VerificationStatus.PreVerified).map((score) =>
              score.id === 3032
                ? {
                    ...score,
                    score: 500,
                    verificationStatus: VerificationStatus.Verified,
                  }
                : score
            ),
            scoreRow({
              id: 3035,
              gameId: 303,
              playerId: 5,
              team: Team.Red,
              verificationStatus: VerificationStatus.Rejected,
            }),
          ],
        }),
        gameRow({ id: 304, matchId: 3 }),
        gameRow({ id: 305, matchId: 3 }),
      ],
    }),
  ],
});

const runChecks = async (
  row: TournamentRow,
  overrideVerifiedState: boolean
) => {
  const db = new StubDatabase(row);
  const service = new TournamentAutomationCheckService({
    db: db as unknown as DatabaseClient,
    logger: noopLogger,
    tournamentChecks: new TournamentAutomationChecks(),
    matchChecks: new MatchAutomationChecks(),
    gameChecks: new GameAutomationChecks(),
    scoreChecks: new ScoreAutomationChecks(),
  });

  // Each row as read, by `${table}:${id}`, then with the checks' writes
  type Status = { verificationStatus: unknown; rejectionReason: unknown };
  const saved = new Map<string, Status>();
  const read = (key: string, { verificationStatus, rejectionReason }: Status) =>
    saved.set(key, { verificationStatus, rejectionReason });

  read(`tournaments:${row.id}`, row);
  for (const match of row.matches) {
    read(`matches:${match.id}`, match);
    for (const game of match.games) {
      read(`games:${game.id}`, game);
      for (const score of game.gameScores) {
        read(`game_scores:${score.id}`, score);
      }
    }
  }

  await service.processAutomationChecks(row.id, overrideVerifiedState);

  for (const { table, id, values } of db.transactions[0]?.updates ?? []) {
    const key = `${table}:${id}`;
    saved.set(key, { ...saved.get(key)!, ...values });
  }

  return Object.fromEntries(
    [...saved].map(([key, { verificationStatus, rejectionReason }]) => [
      key,
      [verificationStatus, rejectionReason],
    ])
  );
};

describe('TournamentAutomationCheckService and admin decisions', () => {
  const { Rejected, Verified, PreVerified, PreRejected } = VerificationStatus;

  it('keeps admin-rejected and admin-verified rows when the checks run again', async () => {
    const persisted = await runChecks(reviewedTournament(), false);

    const lineupOf = (gameId: number, status: VerificationStatus, reason = 0) =>
      Object.fromEntries(
        [1, 2, 3, 4].map((player) => [
          `game_scores:${gameId * 10 + player}`,
          [status, reason],
        ])
      );

    expect(persisted).toMatchObject({
      'matches:1': [Rejected, MatchRejectionReason.None],
      'matches:2': [Verified, MatchRejectionReason.None],
      ...Object.fromEntries(
        [101, 102, 103, 104].map((id) => [
          `games:${id}`,
          [Rejected, GameRejectionReason.RejectedMatch],
        ])
      ),
      ...Object.fromEntries(
        [201, 202, 203, 204].map((id) => [
          `games:${id}`,
          [Verified, GameRejectionReason.None],
        ])
      ),
      'games:301': [Rejected, GameRejectionReason.None],
      'games:302': [Verified, GameRejectionReason.None],
      ...lineupOf(101, Rejected, ScoreRejectionReason.RejectedGame),
      ...lineupOf(201, Verified),
      ...lineupOf(204, Verified),
      ...lineupOf(301, Rejected, ScoreRejectionReason.RejectedGame),
      ...lineupOf(302, Verified),
      'game_scores:3032': [Verified, ScoreRejectionReason.None],
      'game_scores:3035': [Rejected, ScoreRejectionReason.None],
    });
  });

  it('checks the rows around the admin decisions', async () => {
    const persisted = await runChecks(reviewedTournament(), false);

    expect(persisted).toMatchObject({
      'matches:3': [PreVerified, MatchRejectionReason.None],
      'games:303': [PreVerified, GameRejectionReason.None],
      'games:304': [PreVerified, GameRejectionReason.None],
      'game_scores:3031': [PreVerified, ScoreRejectionReason.None],
      'game_scores:3041': [PreVerified, ScoreRejectionReason.None],
    });
  });

  it('checks the undecided scores of a game an admin verified', async () => {
    // Verified with "Leave children unchanged", so its scores kept their
    // pre-statuses, apart from one an admin verified and one they rejected
    const row = reviewedTournament();
    row.matches[2]!.games.push(
      gameRow({
        id: 306,
        matchId: 3,
        verificationStatus: Verified,
        gameScores: lineup(306, PreVerified).map((score) => {
          if (score.id === 3062) {
            return { ...score, score: 500 };
          }
          if (score.id === 3063) {
            return { ...score, score: 500, verificationStatus: Verified };
          }
          if (score.id === 3064) {
            return { ...score, verificationStatus: Rejected };
          }
          return score;
        }),
      })
    );

    const persisted = await runChecks(row, false);

    expect(persisted).toMatchObject({
      'games:306': [Verified, GameRejectionReason.None],
      'game_scores:3061': [PreVerified, ScoreRejectionReason.None],
      'game_scores:3062': [PreRejected, ScoreRejectionReason.ScoreBelowMinimum],
      'game_scores:3063': [Verified, ScoreRejectionReason.None],
      'game_scores:3064': [Rejected, ScoreRejectionReason.None],
    });
  });

  it('checks a match added to a verified tournament', async () => {
    const row: TournamentRow = {
      ...reviewedTournament(),
      verificationStatus: Verified,
    };
    row.matches.push(
      matchRow({
        id: 4,
        games: [401, 402, 403, 404].map((id) => gameRow({ id, matchId: 4 })),
      })
    );

    const persisted = await runChecks(row, false);

    expect(persisted).toMatchObject({
      'tournaments:1': [Verified, TournamentRejectionReason.None],
      'matches:1': [Rejected, MatchRejectionReason.None],
      'matches:2': [Verified, MatchRejectionReason.None],
      'matches:4': [PreVerified, MatchRejectionReason.None],
      'games:401': [PreVerified, GameRejectionReason.None],
      'game_scores:4011': [PreVerified, ScoreRejectionReason.None],
    });
  });

  it('converts a head-to-head match added to a verified 1v1 tournament, and only that match', async () => {
    const headToHeadMatch = (matchId: number, status: VerificationStatus) =>
      matchRow({
        id: matchId,
        verificationStatus: status,
        games: [1, 2, 3, 4].map((game) => {
          const gameId = matchId * 100 + game;
          return gameRow({
            id: gameId,
            matchId,
            teamType: TeamType.HeadToHead,
            verificationStatus: status,
            gameScores: [1, 2].map((playerId) =>
              scoreRow({
                id: gameId * 10 + playerId,
                gameId,
                playerId,
                team: Team.NoTeam,
                verificationStatus: status,
              })
            ),
          });
        }),
      });

    // Match 1 was verified with its games still head-to-head; match 2 was
    // added after the tournament was verified
    const row: TournamentRow = {
      ...reviewedTournament(),
      lobbySize: 1,
      verificationStatus: Verified,
      matches: [
        headToHeadMatch(1, Verified),
        headToHeadMatch(2, VerificationStatus.None),
      ],
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

    await service.processAutomationChecks(row.id, false);

    const updates = db.transactions[0]?.updates ?? [];
    const written = (key: string) =>
      updates.find((entry) => `${entry.table}:${entry.id}` === key)?.values;

    expect(written('matches:2')).toMatchObject({
      verificationStatus: PreVerified,
    });
    for (const gameId of [201, 202, 203, 204]) {
      expect(written(`games:${gameId}`)).toMatchObject({
        teamType: TeamType.TeamVs,
        verificationStatus: PreVerified,
      });
    }
    expect(written('game_scores:2011')).toMatchObject({ team: Team.Red });
    expect(written('game_scores:2012')).toMatchObject({ team: Team.Blue });

    const verifiedMatchRows = [
      'matches:1',
      ...[101, 102, 103, 104].flatMap((gameId) => [
        `games:${gameId}`,
        `game_scores:${gameId * 10 + 1}`,
        `game_scores:${gameId * 10 + 2}`,
      ]),
    ];
    expect(verifiedMatchRows.filter(written)).toEqual([]);
  });

  it('checks admin decisions again when asked to override them', async () => {
    const persisted = await runChecks(reviewedTournament(), true);

    expect(persisted).toMatchObject({
      'matches:1': [PreVerified, MatchRejectionReason.None],
      'games:101': [PreVerified, GameRejectionReason.None],
      'game_scores:1011': [PreVerified, ScoreRejectionReason.None],
      'games:204': [PreRejected, GameRejectionReason.InvalidTeamType],
      'game_scores:2011': [PreRejected, ScoreRejectionReason.ScoreBelowMinimum],
    });
  });
});
