import { describe, expect, test } from 'bun:test';

import {
  MATCH_LINKS_NEED_STABLE_MESSAGE,
  MIXED_MATCH_LINKS_MESSAGE,
  ROOM_LINKS_NEED_LAZER_MESSAGE,
} from '../tournamentMessages';
import {
  MAX_SUBMISSION_IDS,
  TournamentSubmissionInputSchema,
  tournamentSubmissionFormSchema,
} from '../tournamentSubmission';

const sequentialIds = (count: number) =>
  Array.from({ length: count }, (_, index) => index + 1);

const submission = (ids: number[], beatmapIds: number[]) => ({
  name: 'Test Tournament',
  abbreviation: 'TT',
  forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
  ruleset: 0,
  rankRangeLowerBound: 1,
  lobbySize: 2,
  ids,
  beatmapIds,
});

const issuePaths = (result: {
  error?: { issues: { path: PropertyKey[] }[] };
}) => result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe.each([
  ['input schema', TournamentSubmissionInputSchema],
  ['form schema', tournamentSubmissionFormSchema],
] as const)('%s id limits', (_, schema) => {
  test('accepts the maximum number of match and beatmap ids', () => {
    const result = schema.safeParse(
      submission(
        sequentialIds(MAX_SUBMISSION_IDS),
        sequentialIds(MAX_SUBMISSION_IDS)
      )
    );

    expect(issuePaths(result)).toEqual([]);
  });

  test('rejects one match id over the maximum', () => {
    const result = schema.safeParse(
      submission(sequentialIds(MAX_SUBMISSION_IDS + 1), [])
    );

    expect(issuePaths(result)).toContain('ids');
  });

  test('rejects one beatmap id over the maximum', () => {
    const result = schema.safeParse(
      submission([1], sequentialIds(MAX_SUBMISSION_IDS + 1))
    );

    expect(issuePaths(result)).toContain('beatmapIds');
  });
});

const issueMessages = (
  result: { error?: { issues: { path: PropertyKey[]; message: string }[] } },
  path: string
) =>
  result.error?.issues
    .filter((issue) => issue.path.join('.') === path)
    .map((issue) => issue.message) ?? [];

describe.each([
  ['input schema', TournamentSubmissionInputSchema],
  ['form schema', tournamentSubmissionFormSchema],
] as const)('%s messages', (_, schema) => {
  test('states the match and beatmap limits with separators', () => {
    const result = schema.safeParse(
      submission(
        sequentialIds(MAX_SUBMISSION_IDS + 1),
        sequentialIds(MAX_SUBMISSION_IDS + 1)
      )
    );

    expect(issueMessages(result, 'ids')).toContain(
      'Matches cannot exceed 1,000'
    );
    expect(issueMessages(result, 'beatmapIds')).toContain(
      'Beatmaps cannot exceed 1,000'
    );
  });

  test('names the forum post URL, with one message per failure', () => {
    const empty = schema.safeParse({ ...submission([1], []), forumUrl: '  ' });
    const elsewhere = schema.safeParse({
      ...submission([1], []),
      forumUrl: 'https://example.com/topic/1',
    });

    // The form shows the last message it sets for a field, so an empty field
    // must not also report the source rule.
    expect(issueMessages(empty, 'forumUrl')).toEqual([
      'Forum post URL is required',
    ]);
    expect(issueMessages(elsewhere, 'forumUrl')).toEqual([
      "Forum post URL must be from osu.ppy.sh forums or the osu! wiki's tournaments section",
    ]);
  });

  test('asks for a whole-number rank restriction of at least 1', () => {
    const fraction = schema.safeParse({
      ...submission([1], []),
      rankRangeLowerBound: 1000.5,
    });
    const zero = schema.safeParse({
      ...submission([1], []),
      rankRangeLowerBound: 0,
    });
    const notANumber = schema.safeParse({
      ...submission([1], []),
      rankRangeLowerBound: Number.NaN,
    });

    expect(issueMessages(fraction, 'rankRangeLowerBound')).toEqual([
      'Rank restriction must be a whole number',
    ]);
    expect(issueMessages(zero, 'rankRangeLowerBound')).toEqual([
      'Rank restriction must be at least 1',
    ]);
    expect(issueMessages(notANumber, 'rankRangeLowerBound')).toEqual([
      'Rank restriction must be a whole number',
    ]);
  });

  test('says which required choice is missing', () => {
    const result = schema.safeParse({
      ...submission([1], []),
      ruleset: undefined,
      rankRangeLowerBound: undefined,
      lobbySize: undefined,
    });

    expect(issueMessages(result, 'ruleset')).toEqual(['Ruleset is required']);
    expect(issueMessages(result, 'rankRangeLowerBound')).toEqual([
      'Rank restriction is required',
    ]);
    expect(issueMessages(result, 'lobbySize')).toEqual([
      'Lobby size is required',
    ]);
  });

  test('keeps the lobby size bounds', () => {
    const result = schema.safeParse({ ...submission([1], []), lobbySize: 9 });

    expect(issueMessages(result, 'lobbySize')).toEqual([
      'Lobby size cannot exceed 8',
    ]);
  });
});

// Each match is fetched as "Played on osu!lazer" says, whatever its link is.
describe('form schema match links', () => {
  const ROOM = 'https://osu.ppy.sh/multiplayer/rooms/1537300';
  const MATCH = 'https://osu.ppy.sh/community/matches/12345';

  test.each([
    ['a room link unticked', [ROOM], false, ROOM_LINKS_NEED_LAZER_MESSAGE],
    ['a match link ticked', [MATCH], true, MATCH_LINKS_NEED_STABLE_MESSAGE],
    ['both kinds of link', [ROOM, MATCH], true, MIXED_MATCH_LINKS_MESSAGE],
  ] as const)('refuses %s', (_, links, isLazer, message) => {
    const result = tournamentSubmissionFormSchema.safeParse({
      ...submission([], []),
      ids: links,
      isLazer,
    });

    expect(issueMessages(result, 'ids')).toEqual([message]);
  });

  test.each([
    ['room links ticked', [ROOM, '2048512'], true, [1537300, 2048512]],
    ['match links unticked', [MATCH, '67890'], false, [12345, 67890]],
  ] as const)('accepts %s, keeping only the IDs', (_, links, isLazer, ids) => {
    const result = tournamentSubmissionFormSchema.safeParse({
      ...submission([], []),
      ids: links,
      isLazer,
    });

    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.data).toMatchObject({ ids, isLazer });
    expect(result.data).not.toHaveProperty('matchLinkMismatch');
  });
});
