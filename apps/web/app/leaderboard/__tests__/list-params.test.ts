import { describe, expect, it } from 'bun:test';
import { Ruleset } from '@otr/core/osu';

import {
  clearListFilters,
  countActiveFilters,
  getDefaultListState,
  listStateHref,
  parseListState,
} from '@/lib/kit/lists/params';
import { LeaderboardRequestSchema } from '@/lib/orpc/schema/leaderboard';

import {
  countLeaderboardFilters,
  LEADERBOARD_LIST_PARAMS,
  LEADERBOARD_RANGES,
  leaderboardHref,
  toLeaderboardRequest,
} from '../list-params';

const parse = (query: string) =>
  parseListState(LEADERBOARD_LIST_PARAMS, new URLSearchParams(query));

describe('LEADERBOARD_LIST_PARAMS', () => {
  it('reads a bare address as the global leaderboard on no named ruleset', () => {
    expect(parse('')).toEqual(getDefaultListState(LEADERBOARD_LIST_PARAMS));
    expect(parse('').ruleset).toBeUndefined();
    expect(
      listStateHref('/leaderboard', LEADERBOARD_LIST_PARAMS, parse(''))
    ).toBe('/leaderboard');
  });

  // An address without a ruleset shows each visitor their own, so a link
  // that means osu! has to say so.
  it('writes every named ruleset, osu! included', () => {
    expect(parse('ruleset=0').ruleset).toBe(Ruleset.Osu);
    expect(
      listStateHref('/leaderboard', LEADERBOARD_LIST_PARAMS, parse('ruleset=0'))
    ).toBe('/leaderboard?ruleset=0');
    expect(
      leaderboardHref(parse(''), { country: 'PL', ruleset: Ruleset.Osu })
    ).toBe('/leaderboard?ruleset=0&country=PL');
  });

  it('reads the keys old links use', () => {
    const state = parse(
      'ruleset=1&friend=true&country=US&tiers=gold&tiers=eliteGrandmaster' +
        '&minRating=1500&maxRating=2500&minOsuRank=100&maxOsuRank=5000' +
        '&minMatches=10&maxMatches=500&minWinRate=40.5&maxWinRate=90&page=3'
    );

    expect(state).toMatchObject({
      ruleset: Ruleset.Taiko,
      friend: true,
      country: 'US',
      tiers: ['gold', 'eliteGrandmaster'],
      rating: { min: 1500, max: 2500 },
      osuRank: { min: 100, max: 5000 },
      matches: { min: 10, max: 500 },
      winRate: { min: 40.5, max: 90 },
      page: 3,
    });
  });

  it('reads the header search and the sort', () => {
    const state = parse('q=%20mrekk%20&sort=matches&dir=asc');
    expect(state.q).toBe('mrekk');
    expect(state.sort).toEqual({ key: 'matches', direction: 'asc' });
    // A one-character term is not a search.
    expect(parse('q=a').q).toBe('');
  });

  it('ignores values outside each domain', () => {
    const state = parse(
      'ruleset=3&sort=name&tiers=wood&minRating=50&maxMatches=1000&minWinRate=0&country=X'
    );
    expect(state.ruleset).toBeUndefined();
    expect(state.sort).toEqual({ key: 'rating', direction: 'desc' });
    expect(state.tiers).toEqual([]);
    expect(state.rating).toEqual({});
    expect(state.matches).toEqual({});
    expect(state.winRate).toEqual({});
    expect(state.country).toBe('');
  });

  it('takes whole numbers for rating, rank and matches, and decimals for win rate', () => {
    const state = parse(
      'minRating=1500.5&maxRating=2000&maxOsuRank=100.5&minMatches=10.5&minWinRate=40.5'
    );
    expect(state.rating).toEqual({ max: 2000 });
    expect(state.osuRank).toEqual({});
    expect(state.matches).toEqual({});
    expect(state.winRate).toEqual({ min: 40.5 });

    // The filter fields round typed numbers by the same flags.
    expect(LEADERBOARD_RANGES.rating.integer).toBe(true);
    expect(LEADERBOARD_RANGES.osuRank.integer).toBe(true);
    expect(LEADERBOARD_RANGES.matches.integer).toBe(true);
    expect(LEADERBOARD_RANGES.winRate.integer).toBe(false);
  });

  it('counts the filter panel only, and Clear all keeps search, sort and scope', () => {
    const state = parse(
      'q=mrekk&sort=winRate&ruleset=1&friend=true&country=US&tiers=gold&minRating=1500&page=2'
    );
    expect(countActiveFilters(LEADERBOARD_LIST_PARAMS, state)).toBe(3);

    const cleared = clearListFilters(LEADERBOARD_LIST_PARAMS, state);
    expect(
      listStateHref('/leaderboard', LEADERBOARD_LIST_PARAMS, cleared)
    ).toBe('/leaderboard?q=mrekk&sort=winRate&ruleset=1&friend=true');
  });
});

describe('leaderboardHref', () => {
  it('goes back to the first page when anything but the page changes', () => {
    const state = parse('ruleset=4&page=5');
    expect(leaderboardHref(state, { country: 'PL' })).toBe(
      '/leaderboard?ruleset=4&country=PL'
    );
    expect(
      leaderboardHref(state, {
        sort: { key: 'tournaments', direction: 'desc' },
      })
    ).toBe('/leaderboard?sort=tournaments&ruleset=4');
    expect(leaderboardHref(state, { page: 6 })).toBe(
      '/leaderboard?ruleset=4&page=6'
    );
  });
});

describe('toLeaderboardRequest', () => {
  it('sends nothing but the page and the default ruleset for a bare address', () => {
    const request = toLeaderboardRequest(parse(''), Ruleset.Catch);
    expect(
      Object.fromEntries(
        Object.entries(request).filter(([, value]) => value !== undefined)
      )
    ).toEqual({ page: 1, ruleset: Ruleset.Catch });
  });

  it('prefers the address’s ruleset to the default', () => {
    expect(
      toLeaderboardRequest(parse('ruleset=0'), Ruleset.Catch).ruleset
    ).toBe(Ruleset.Osu);
  });

  it('maps search, sort and filters onto the procedure input', () => {
    const request = toLeaderboardRequest(
      parse(
        'q=mrekk&sort=winRate&dir=asc&ruleset=5&country=KR&tiers=master' +
          '&minRating=1000&maxOsuRank=10000&minMatches=20&minWinRate=50&maxWinRate=75'
      ),
      Ruleset.Osu
    );

    expect(request).toMatchObject({
      searchQuery: 'mrekk',
      sort: 'winRate',
      descending: false,
      ruleset: Ruleset.Mania7k,
      country: 'KR',
      tiers: ['master'],
      minRating: 1000,
      maxOsuRank: 10000,
      minMatches: 20,
      minWinRate: 0.5,
      maxWinRate: 0.75,
    });
    expect(LeaderboardRequestSchema.safeParse(request).success).toBe(true);
  });

  it('asks for inactive players only while the address includes them', () => {
    const state = parse('inactive=true');
    expect(toLeaderboardRequest(state, Ruleset.Osu).includeInactive).toBe(true);
    expect(leaderboardHref(state, { page: 2 })).toBe(
      '/leaderboard?inactive=true&page=2'
    );

    // A filter: Clear all hides inactive players again.
    expect(countActiveFilters(LEADERBOARD_LIST_PARAMS, state)).toBe(1);
    const cleared = clearListFilters(LEADERBOARD_LIST_PARAMS, state);
    expect(
      toLeaderboardRequest(cleared, Ruleset.Osu).includeInactive
    ).toBeUndefined();
  });

  // The friends tab lists inactive friends whatever the switch says, so a
  // switch left on from All must not offer "Clear filters" there.
  it('counts the inactive switch as a filter on All only', () => {
    expect(countLeaderboardFilters(parse('inactive=true'))).toBe(1);
    expect(countLeaderboardFilters(parse('friend=true&inactive=true'))).toBe(0);
    expect(
      countLeaderboardFilters(parse('friend=true&inactive=true&country=KR'))
    ).toBe(1);
  });

  it('leaves the default sort to the server, and sends any other direction', () => {
    expect(toLeaderboardRequest(parse(''), Ruleset.Osu).sort).toBeUndefined();
    expect(toLeaderboardRequest(parse('dir=asc'), Ruleset.Osu)).toMatchObject({
      sort: 'rating',
      descending: false,
    });
  });
});
