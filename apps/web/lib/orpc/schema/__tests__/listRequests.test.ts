import { describe, expect, test } from 'bun:test';

import { Ruleset } from '@otr/core/osu';

import { BeatmapListRequestSchema } from '../beatmapList';
import { LeaderboardRequestSchema } from '../leaderboard';
import { ReportListInputSchema } from '../report';
import {
  TournamentAdminUpdateInputSchema,
  TournamentListRequestSchema,
} from '../tournament';

describe.each([
  ['tournament list', TournamentListRequestSchema],
  ['beatmap list', BeatmapListRequestSchema],
] as const)('%s request', (_, schema) => {
  test('accepts several rulesets beside the single one', () => {
    const request = schema.parse({
      ruleset: Ruleset.Osu,
      rulesets: [Ruleset.Taiko, Ruleset.Mania4k],
    });

    expect(request.ruleset).toBe(Ruleset.Osu);
    expect(request.rulesets).toEqual([Ruleset.Taiko, Ruleset.Mania4k]);
  });

  test('leaves both ruleset params optional', () => {
    const request = schema.parse({});

    expect(request.ruleset).toBeUndefined();
    expect(request.rulesets).toBeUndefined();
  });

  test('rejects a ruleset that does not exist', () => {
    expect(schema.safeParse({ rulesets: [Ruleset.Osu, 9] }).success).toBe(
      false
    );
  });
});

describe('LeaderboardRequestSchema', () => {
  test('accepts a player search and a sort', () => {
    const request = LeaderboardRequestSchema.parse({
      searchQuery: '  stage ',
      sort: 'winRate',
      descending: false,
    });

    expect(request.searchQuery).toBe('stage');
    expect(request.sort).toBe('winRate');
    expect(request.descending).toBe(false);
  });

  test('needs at least two characters to search, like the other lists', () => {
    expect(
      LeaderboardRequestSchema.safeParse({ searchQuery: 'a' }).success
    ).toBe(false);
    expect(
      LeaderboardRequestSchema.safeParse({ searchQuery: 'ab' }).success
    ).toBe(true);
  });

  test('only sorts by the columns the leaderboard shows', () => {
    for (const sort of ['rating', 'tournaments', 'matches', 'winRate']) {
      expect(LeaderboardRequestSchema.safeParse({ sort }).success).toBe(true);
    }
    expect(
      LeaderboardRequestSchema.safeParse({ sort: 'country' }).success
    ).toBe(false);
  });

  test('keeps every new param optional', () => {
    const request = LeaderboardRequestSchema.parse({});

    expect(request.searchQuery).toBeUndefined();
    expect(request.sort).toBeUndefined();
    expect(request.descending).toBeUndefined();
  });
});

describe('ReportListInputSchema', () => {
  test('defaults to the first page with no sort', () => {
    const input = ReportListInputSchema.parse({});

    expect(input.page).toBe(1);
    expect(input.pageSize).toBe(20);
    expect(input.sort).toBeUndefined();
    expect(input.descending).toBeUndefined();
  });
});

describe('TournamentAdminUpdateInputSchema messages', () => {
  const update = {
    id: 1,
    name: 'Test Tournament',
    abbreviation: 'TT',
    forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
    rankRangeLowerBound: 1,
    ruleset: Ruleset.Osu,
    lobbySize: 2,
    verificationStatus: 4,
    rejectionReason: 0,
    startTime: null,
    endTime: null,
    children: 'none',
  };

  const messagesFor = (patch: Record<string, unknown>, path: string) =>
    TournamentAdminUpdateInputSchema.safeParse({ ...update, ...patch })
      .error?.issues.filter((issue) => issue.path.join('.') === path)
      .map((issue) => issue.message) ?? [];

  test('names the forum post URL', () => {
    expect(
      messagesFor({ forumUrl: 'https://example.com/topic/1' }, 'forumUrl')
    ).toEqual([
      'Forum post URL must be from "https://osu.ppy.sh/community/forums/topics/" or "https://osu.ppy.sh/wiki/en/Tournaments/"',
    ]);
  });

  test('asks for a whole-number rank restriction of at least 1', () => {
    expect(
      messagesFor({ rankRangeLowerBound: 2.5 }, 'rankRangeLowerBound')
    ).toEqual(['Rank restriction must be a whole number']);
    expect(
      messagesFor({ rankRangeLowerBound: 0 }, 'rankRangeLowerBound')
    ).toEqual(['Rank restriction must be at least 1']);
  });
});
