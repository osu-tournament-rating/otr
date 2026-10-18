import { describe, expect, it } from 'bun:test';
import {
  Ruleset,
  TournamentQuerySortType,
  TournamentRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';

import {
  TOURNAMENT_LIST_PARAMS,
  legacyTournamentListHref,
  rulesetsForAddress,
  toTournamentListRequest,
  tournamentListHref,
} from '@/app/tournaments/list-params';
import {
  clearListFilters,
  countActiveFilters,
  getDefaultListState,
  parseListState,
} from '@/lib/kit/lists/params';

const parse = (query: string) =>
  parseListState(TOURNAMENT_LIST_PARAMS, new URLSearchParams(query));

describe('tournament list params', () => {
  it('leaves a fresh list with a bare address', () => {
    expect(
      tournamentListHref(getDefaultListState(TOURNAMENT_LIST_PARAMS))
    ).toBe('/tournaments');
  });

  // A bare address shows the visitor's browsing ruleset, so every ruleset
  // needs a value of its own.
  it('tells no ruleset apart from every ruleset', () => {
    expect(parse('').ruleset).toBeUndefined();
    expect(parse('ruleset=all').ruleset).toEqual([]);
    expect(tournamentListHref({ ...parse(''), ruleset: [] })).toBe(
      '/tournaments?ruleset=all'
    );
    expect(tournamentListHref(parse('ruleset=all&q=DAS'))).toBe(
      '/tournaments?q=DAS&ruleset=all'
    );
  });

  it('leaves the visitor’s own rulesets out of the address', () => {
    expect(
      rulesetsForAddress([Ruleset.Taiko], [Ruleset.Taiko])
    ).toBeUndefined();
    expect(rulesetsForAddress([], [])).toBeUndefined();
    // Every ruleset over a visitor's default writes ruleset=all.
    expect(rulesetsForAddress([], [Ruleset.Taiko])).toEqual([]);
    expect(rulesetsForAddress([Ruleset.Osu], [])).toEqual([Ruleset.Osu]);
    expect(
      rulesetsForAddress([Ruleset.Osu, Ruleset.Taiko], [Ruleset.Taiko])
    ).toEqual([Ruleset.Osu, Ruleset.Taiko]);
  });

  it('keeps every ruleset through Clear all', () => {
    const state = parse('ruleset=all&status=4');
    expect(
      tournamentListHref(clearListFilters(TOURNAMENT_LIST_PARAMS, state))
    ).toBe('/tournaments?ruleset=all');
  });

  it('keeps the keys old links used for rank, dates, lobby size and rulesets', () => {
    const state = parse(
      'minRankRange=1000&maxRankRange=250000&dateMin=2024-07-20&dateMax=2024-08-03&lobbySize=2&lobbySize=4&ruleset=0&ruleset=4'
    );

    expect(state.rank).toEqual({ min: 1000, max: 250000 });
    expect(state.date).toEqual({ from: '2024-07-20', to: '2024-08-03' });
    expect(state.lobbySize).toEqual([2, 4]);
    expect(state.ruleset).toEqual([Ruleset.Osu, Ruleset.Mania4k]);
    expect(tournamentListHref(state)).toBe(
      '/tournaments?ruleset=0&ruleset=4&lobbySize=2&lobbySize=4&minRankRange=1000&maxRankRange=250000&dateMin=2024-07-20&dateMax=2024-08-03'
    );
  });

  it('reads and writes rejection reasons as one bitmask', () => {
    const state = parse('rejectionReason=9');
    expect(state.reason).toEqual([
      TournamentRejectionReason.NoVerifiedMatches,
      TournamentRejectionReason.AbnormalFormat,
    ]);
    expect(tournamentListHref(state)).toBe('/tournaments?rejectionReason=9');
    expect(parse('rejectionReason=abc').reason).toEqual([]);
  });

  it('counts the panel filters and clears only them', () => {
    const state = parse(
      'q=world+cup&sort=lobbySize&ruleset=1&status=4&verified=true&submittedBy=12'
    );
    expect(countActiveFilters(TOURNAMENT_LIST_PARAMS, state)).toBe(3);

    const cleared = clearListFilters(TOURNAMENT_LIST_PARAMS, state);
    expect(tournamentListHref(cleared)).toBe(
      '/tournaments?q=world+cup&sort=lobbySize&ruleset=1'
    );
  });

  it('maps the state to the procedure input', () => {
    const request = toTournamentListRequest(
      parse(
        'q=DAS&page=3&sort=startTime&dir=asc&ruleset=1&status=0&status=4&rejectionReason=6&minRankRange=500&dateMin=2024-07-20&dateMax=2024-08-03&verified=true'
      ),
      [Ruleset.Osu]
    );

    expect(request).toEqual({
      page: 3,
      pageSize: 30,
      searchQuery: 'DAS',
      rulesets: [Ruleset.Taiko],
      verificationStatus: [
        VerificationStatus.Verified,
        VerificationStatus.None,
      ],
      lobbySize: undefined,
      rejectionReason: 6,
      minRankRange: 500,
      maxRankRange: undefined,
      dateMin: '2024-07-20T00:00:00.000Z',
      dateMax: '2024-08-03T23:59:59.999Z',
      verified: true,
      submittedBy: undefined,
      verifiedBy: undefined,
      sort: TournamentQuerySortType.StartTime,
      descending: false,
    });
  });

  it('sends the default rulesets only when the address names none', () => {
    const fresh = getDefaultListState(TOURNAMENT_LIST_PARAMS);
    expect(toTournamentListRequest(fresh, [Ruleset.Catch]).rulesets).toEqual([
      Ruleset.Catch,
    ]);
    expect(
      toTournamentListRequest({ ...fresh, ruleset: [] }, [Ruleset.Catch])
        .rulesets
    ).toBeUndefined();
    expect(
      toTournamentListRequest({ ...fresh, ruleset: [Ruleset.Osu] }, [
        Ruleset.Catch,
      ]).rulesets
    ).toEqual([Ruleset.Osu]);
  });

  it('sends the default sort and nothing else for a fresh list', () => {
    expect(
      toTournamentListRequest(getDefaultListState(TOURNAMENT_LIST_PARAMS), [])
    ).toMatchObject({
      page: 1,
      searchQuery: undefined,
      rulesets: undefined,
      verificationStatus: undefined,
      sort: TournamentQuerySortType.EndTime,
      descending: true,
    });
  });
});

describe('legacyTournamentListHref', () => {
  it('leaves current addresses alone', () => {
    expect(legacyTournamentListHref('q=DAS&sort=submitted&dir=asc')).toBeNull();
    expect(legacyTournamentListHref('')).toBeNull();
  });

  it('moves the old toolbar keys onto the current ones', () => {
    expect(
      legacyTournamentListHref(
        `searchQuery=Dio&verificationStatus=0&verificationStatus=4&sort=${TournamentQuerySortType.LobbySize}&descending=false&ruleset=0`
      )
    ).toBe(
      '/tournaments?q=Dio&sort=lobbySize&dir=asc&ruleset=0&status=4&status=0'
    );
  });

  it('reads `rulesets` as ruleset chips', () => {
    expect(legacyTournamentListHref('rulesets=1&rulesets=2')).toBe(
      '/tournaments?ruleset=1&ruleset=2'
    );
  });
});
