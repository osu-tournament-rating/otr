import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { call, ORPCError } from '@orpc/server';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';

import { getMatch, getMatchMerge } from '../../matchesProcedures';
import { manageTournamentMatchesAdminHandler } from '../../tournaments/matchAdminProcedures';
import { submitTournamentHandler } from '../../tournaments/tournamentSubmissionProcedure';
import { mergeMatchAdminHandler } from '../matchAdminHandlers';

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const NAME_PREFIX = 'match-merge-';
const PLAYER_OSU_ID = 999_118_901;
const MATCH_OSU_ID_BASE = 999_118_100;
const GAME_OSU_ID_BASE = 999_118_200;
const BACKFILL_MIGRATION = join(
  import.meta.dir,
  '../../../../../../drizzle/0039_backfill_match_merges.sql'
);

describe.skipIf(!url)('match merges', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  let session = { dbUser: { id: 0, scopes: ['admin'] } };
  let tournamentId = 0;
  const matchIds: number[] = [];

  const removeSeed = async () => {
    // Cascades to matches, games and merges
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    const players = db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(eq(schema.players.osuId, PLAYER_OSU_ID));
    await db
      .delete(schema.users)
      .where(inArray(schema.users.playerId, players));
    await db
      .delete(schema.players)
      .where(eq(schema.players.osuId, PLAYER_OSU_ID));
  };

  const seedMatch = async (index: number) => {
    const [match] = await db
      .insert(schema.matches)
      .values({
        osuId: MATCH_OSU_ID_BASE + index,
        name: `${NAME_PREFIX}match-${index}`,
        tournamentId,
      })
      .returning({ id: schema.matches.id });

    await db.insert(schema.games).values({
      osuId: GAME_OSU_ID_BASE + index,
      ruleset: Ruleset.Osu,
      scoringType: 3,
      teamType: 0,
      mods: 0,
      matchId: match!.id,
    });

    return match!.id;
  };

  beforeEach(async () => {
    await removeSeed();

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: PLAYER_OSU_ID, username: 'merge-admin' })
      .returning({ id: schema.players.id });
    const [user] = await db
      .insert(schema.users)
      .values({ playerId: player!.id, scopes: ['admin'] })
      .returning({ id: schema.users.id });
    session = { dbUser: { id: user!.id, scopes: ['admin'] } };

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}tournament`,
        abbreviation: 'MM',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999118',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 4,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;

    matchIds.length = 0;
    for (const index of [0, 1, 2]) {
      matchIds.push(await seedMatch(index));
    }
  });

  afterEach(() => {});

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  const merge = (id: number, childMatchIds: number[]) =>
    mergeMatchAdminHandler({
      input: { id, childMatchIds },
      context: { db, session },
    });

  it('lists merged matches on the match that took their games, including earlier merges into a child', async () => {
    const [parent, child, grandchild] = matchIds as [number, number, number];

    await merge(child, [grandchild]);
    await merge(parent, [child]);

    const detail = await call(
      getMatch,
      { id: parent, keyType: 'otr' },
      { context: { db, headers: new Headers() } }
    );

    expect(detail.games).toHaveLength(3);
    expect(
      detail.mergedMatches.map((merged) => ({
        mergedMatchId: merged.mergedMatchId,
        osuId: merged.osuId,
        name: merged.name,
      }))
    ).toEqual([
      {
        mergedMatchId: child,
        osuId: MATCH_OSU_ID_BASE + 1,
        name: `${NAME_PREFIX}match-1`,
      },
      {
        mergedMatchId: grandchild,
        osuId: MATCH_OSU_ID_BASE + 2,
        name: `${NAME_PREFIX}match-2`,
      },
    ]);
  });

  it('leads a merged match ID to the match that took its games', async () => {
    const [parent, child, grandchild] = matchIds as [number, number, number];

    await merge(child, [grandchild]);
    await merge(parent, [child]);

    const lookup = await call(
      getMatchMerge,
      { id: grandchild },
      { context: { db, headers: new Headers() } }
    );

    expect(lookup.match).toEqual({
      id: parent,
      name: `${NAME_PREFIX}match-0`,
    });
    expect(lookup.osuId).toBe(MATCH_OSU_ID_BASE + 2);
  });

  it('finds no merge for a match that was never merged', async () => {
    const lookup = call(
      getMatchMerge,
      { id: matchIds[0]! },
      { context: { db, headers: new Headers() } }
    );

    await expect(lookup).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('skips a merged match when an admin adds it to a tournament again', async () => {
    const [parent, child] = matchIds as [number, number];
    await merge(parent, [child]);

    const result = await manageTournamentMatchesAdminHandler({
      input: {
        tournamentId,
        addMatchOsuIds: [{ osuId: MATCH_OSU_ID_BASE + 1, isLazer: false }],
        removeMatchIds: [],
      },
      context: { db, session },
    });

    expect(result.addedCount).toBe(0);
    expect(result.warnings).toEqual([
      `Match ${MATCH_OSU_ID_BASE + 1} was merged into match ${parent}`,
    ]);
    const { rows: queued } = await db.execute(sql`
      SELECT id FROM jobs
      WHERE queue = 'data.osu'
        AND (payload->>'osuMatchId')::bigint = ${MATCH_OSU_ID_BASE + 1}`);
    expect(queued).toEqual([]);

    const rows = await db
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(eq(schema.matches.osuId, MATCH_OSU_ID_BASE + 1));
    expect(rows).toEqual([]);
  });

  it('refuses a tournament submission that includes a merged match', async () => {
    const [parent, child] = matchIds as [number, number];
    await merge(parent, [child]);

    const submission = submitTournamentHandler({
      input: {
        name: `${NAME_PREFIX}resubmitted`,
        abbreviation: 'MMR',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999119',
        ruleset: Ruleset.Osu,
        rankRangeLowerBound: 1,
        lobbySize: 4,
        rejectionReason: 0,
        isLazer: false,
        ids: [MATCH_OSU_ID_BASE + 1],
        beatmapIds: [],
      },
      context: { db, session },
      errors: {
        ACCOUNT_RESOLUTION_FAILED: () => new ORPCError('FORBIDDEN'),
        NAME_ABBREVIATION_CONFLICT: () => new ORPCError('CONFLICT'),
        MATCH_ASSIGNMENT_CONFLICT: ({ message } = {}) =>
          new ORPCError('CONFLICT', { message }),
        TOURNAMENT_CREATION_FAILED: () =>
          new ORPCError('INTERNAL_SERVER_ERROR'),
        DUPLICATE_TOURNAMENT_DETAILS: () => new ORPCError('CONFLICT'),
        SUBMISSION_FAILED: () => new ORPCError('INTERNAL_SERVER_ERROR'),
      },
    });

    await expect(submission).rejects.toMatchObject({
      code: 'CONFLICT',
      message: `The following matches were merged into other matches: ${MATCH_OSU_ID_BASE + 1}.`,
    });

    const rows = await db
      .select({ id: schema.tournaments.id })
      .from(schema.tournaments)
      .where(eq(schema.tournaments.name, `${NAME_PREFIX}resubmitted`));
    expect(rows).toEqual([]);
  });

  it('backfills merges made before they were recorded, through later merges of the parent, but not matches added again', async () => {
    const [parent, child, grandchild] = matchIds as [number, number, number];
    const readded = await seedMatch(3);

    // A merge as it ran before merges were recorded: the audit triggers log
    // the moved games and the deleted match in one transaction.
    const mergeUnrecorded = (id: number, childId: number) =>
      db.transaction(async (tx) => {
        await tx
          .update(schema.games)
          .set({ matchId: id })
          .where(eq(schema.games.matchId, childId));
        await tx.delete(schema.matches).where(eq(schema.matches.id, childId));
      });

    await mergeUnrecorded(child, grandchild);
    await mergeUnrecorded(parent, child);
    await mergeUnrecorded(parent, readded);
    await db.insert(schema.matches).values({
      osuId: MATCH_OSU_ID_BASE + 3,
      tournamentId,
    });

    await pool.query(await readFile(BACKFILL_MIGRATION, 'utf8'));

    const merges = await db
      .select({
        matchId: schema.matchMerges.matchId,
        mergedMatchId: schema.matchMerges.mergedMatchId,
        osuId: schema.matchMerges.osuId,
        name: schema.matchMerges.name,
      })
      .from(schema.matchMerges)
      .where(
        inArray(schema.matchMerges.mergedMatchId, [child, grandchild, readded])
      )
      .orderBy(schema.matchMerges.mergedMatchId);

    expect(merges).toEqual([
      {
        matchId: parent,
        mergedMatchId: child,
        osuId: MATCH_OSU_ID_BASE + 1,
        name: `${NAME_PREFIX}match-1`,
      },
      {
        matchId: parent,
        mergedMatchId: grandchild,
        osuId: MATCH_OSU_ID_BASE + 2,
        name: `${NAME_PREFIX}match-2`,
      },
    ]);
  });
});
