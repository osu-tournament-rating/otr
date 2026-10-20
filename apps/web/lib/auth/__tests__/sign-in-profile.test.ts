import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';

import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';
import { db } from '@/lib/db';

import { getSession, useFakeOsuUser } from '../osu-sign-in.test-utils';

// Signing in writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

const DAY_MS = 24 * 60 * 60 * 1000;

const STATISTICS_RULESETS = {
  osu: { pp: 7000.5, global_rank: 1200 },
  taiko: { pp: 300, global_rank: 90_000 },
  fruits: { pp: 0, global_rank: null },
  mania: { pp: 4200, global_rank: 5000 },
};

// osu! lists 4K and 7K only in the statistics of a profile asked for mania.
const MANIA_STATISTICS = {
  pp: 4200,
  global_rank: 5000,
  variants: [
    { mode: 'mania', variant: '4k', pp: 4100, global_rank: 4000 },
    { mode: 'mania', variant: '7k', pp: 900, global_rank: 60_000 },
  ],
};

/**
 * The player row a sign-in finds: waiting on a refetch whose lease started
 * ten days ago, as a player whose fetch job was lost is.
 */
const seedWaitingPlayer = async (osuId: number) => {
  const leaseIso = new Date(Date.now() - 10 * DAY_MS).toISOString();
  const [player] = await db
    .insert(schema.players)
    .values({
      osuId,
      username: 'before-sign-in',
      dataFetchStatus: DataFetchStatus.Fetching,
      osuLastFetch: leaseIso,
    })
    .returning({ id: schema.players.id });

  return { playerId: player!.id, leaseIso };
};

const readPlayer = async (playerId: number) => {
  const player = await db.query.players.findFirst({
    where: eq(schema.players.id, playerId),
  });
  return player!;
};

const readRulesetData = (playerId: number) =>
  db
    .select({
      ruleset: schema.playerOsuRulesetData.ruleset,
      pp: schema.playerOsuRulesetData.pp,
      globalRank: schema.playerOsuRulesetData.globalRank,
    })
    .from(schema.playerOsuRulesetData)
    .where(eq(schema.playerOsuRulesetData.playerId, playerId))
    .orderBy(asc(schema.playerOsuRulesetData.ruleset));

describe.skipIf(!enabled)('sign-in with a full osu! profile', () => {
  const osuUser = useFakeOsuUser((pathname) => ({
    previous_usernames: ['oldname'],
    is_restricted: true,
    statistics_rulesets: STATISTICS_RULESETS,
    ...(pathname === '/api/v2/me/mania'
      ? { statistics: MANIA_STATISTICS }
      : {}),
  }));
  let seeded: Awaited<ReturnType<typeof seedWaitingPlayer>>;

  beforeAll(async () => {
    seeded = await seedWaitingPlayer(osuUser.osuId);
  });

  test('saves the whole profile and counts as a fetch', async () => {
    const signedInAt = Date.now();
    const { location } = await osuUser.signIn();
    expect(location).not.toContain('error=');

    const player = await readPlayer(seeded.playerId);
    expect(player).toMatchObject({
      username: osuUser.username,
      previousUsernames: ['oldname'],
      restricted: true,
      dataFetchStatus: DataFetchStatus.Fetched,
    });
    expect(Date.parse(player.osuLastFetch)).toBeGreaterThanOrEqual(
      signedInAt - 1000
    );

    expect(await readRulesetData(seeded.playerId)).toEqual([
      { ruleset: Ruleset.Osu, pp: 7000.5, globalRank: 1200 },
      { ruleset: Ruleset.Taiko, pp: 300, globalRank: 90_000 },
      { ruleset: Ruleset.Catch, pp: 0, globalRank: null },
      { ruleset: Ruleset.ManiaOther, pp: 4200, globalRank: 5000 },
      { ruleset: Ruleset.Mania4k, pp: 4100, globalRank: 4000 },
      { ruleset: Ruleset.Mania7k, pp: 900, globalRank: 60_000 },
    ]);
  });
});

describe.skipIf(!enabled)('sign-in with a profile without statistics', () => {
  const osuUser = useFakeOsuUser({ previous_usernames: ['oldname'] });
  let seeded: Awaited<ReturnType<typeof seedWaitingPlayer>>;

  beforeAll(async () => {
    seeded = await seedWaitingPlayer(osuUser.osuId);
  });

  // Moving the time alone would keep the wait from ever timing out (#1231).
  test('leaves a player waiting on a refetch waiting, lease unchanged', async () => {
    const { location } = await osuUser.signIn();
    expect(location).not.toContain('error=');

    const player = await readPlayer(seeded.playerId);
    expect(player).toMatchObject({
      username: osuUser.username,
      previousUsernames: ['oldname'],
      dataFetchStatus: DataFetchStatus.Fetching,
    });
    expect(Date.parse(player.osuLastFetch)).toBe(Date.parse(seeded.leaseIso));
    expect(await readRulesetData(seeded.playerId)).toEqual([]);
  });
});

describe.skipIf(!enabled)('sign-in with a profile that fails to save', () => {
  // The database refuses a pp that is not a number.
  const osuUser = useFakeOsuUser({
    previous_usernames: ['oldname'],
    statistics_rulesets: {
      ...STATISTICS_RULESETS,
      taiko: { pp: 'lots', global_rank: 1 },
    },
  });
  let seeded: Awaited<ReturnType<typeof seedWaitingPlayer>>;

  beforeAll(async () => {
    seeded = await seedWaitingPlayer(osuUser.osuId);
  });

  // Looking up the session marks the player active; those rows outlive the
  // player on purpose, so the suite removes them itself.
  afterAll(async () => {
    await db
      .delete(schema.userActivityDaily)
      .where(eq(schema.userActivityDaily.playerId, seeded.playerId));
  });

  test('still signs in, and saves none of the profile', async () => {
    const { cookies, location } = await osuUser.signIn();
    expect(location).not.toContain('error=');
    expect((await getSession(cookies))?.dbPlayer?.id).toBe(seeded.playerId);

    const player = await readPlayer(seeded.playerId);
    expect(player).toMatchObject({
      previousUsernames: [],
      dataFetchStatus: DataFetchStatus.Fetching,
    });
    expect(Date.parse(player.osuLastFetch)).toBe(Date.parse(seeded.leaseIso));
    expect(await readRulesetData(seeded.playerId)).toEqual([]);
  });
});
