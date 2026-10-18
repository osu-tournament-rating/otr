import { describe, expect, it } from 'bun:test';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  buildBeatmapSearchExpressions,
  buildPrefixQuery,
  buildTrigramPrecision,
  parseSearchTerm,
} from '../search';

const dialect = new PgDialect();

describe('buildPrefixQuery', () => {
  it('returns null without tokens', () => {
    expect(buildPrefixQuery([])).toBeNull();
  });

  it('prefix matches a lone token', () => {
    expect(buildPrefixQuery(['w'])).toBe("'w':*");
  });

  it('requires a whole lexeme for a finished short token', () => {
    expect(buildPrefixQuery(['w', 'www'])).toBe("'w' & 'www':*");
  });

  it('still prefix matches finished tokens long enough to be selective', () => {
    expect(buildPrefixQuery(['owc', '2024', 'qf'])).toBe(
      "'owc':* & '2024':* & 'qf':*"
    );
  });

  it('escapes quotes', () => {
    expect(buildPrefixQuery(["o'ne", "tw'o"])).toBe("'o''ne':* & 'tw''o':*");
  });
});

describe('parseSearchTerm', () => {
  it('rejects terms with nothing matchable', () => {
    expect(parseSearchTerm('   ')).toBeNull();
    expect(parseSearchTerm('///')).toBeNull();
  });

  it('splits on punctuation', () => {
    const parsed = parseSearchTerm('w/www');
    expect(parsed?.normalizedTerm).toBe('w www');
    expect(parsed?.tokens).toEqual(['w', 'www']);
  });

  it('keeps short tokens out of fuzzy matching but requires them as words', () => {
    const parsed = parseSearchTerm('w/www');
    expect(parsed?.fuzzyTerm).toBe('www');
    expect(parsed?.fuzzyTokens).toEqual(['www']);
    expect(parsed?.primaryFuzzyToken).toBeNull();
    expect(parsed?.shortTokens).toEqual(['w']);
  });

  it('leaves a lone short term to the prefix query alone', () => {
    const parsed = parseSearchTerm('w');
    expect(parsed?.fuzzyTerm).toBeNull();
    expect(parsed?.fuzzyTokens).toEqual([]);
    expect(parsed?.shortTokens).toEqual([]);
  });

  it('fuzzy matches the whole term and its first word', () => {
    const parsed = parseSearchTerm('hoshimya toto');
    expect(parsed?.fuzzyTerm).toBe('hoshimya toto');
    expect(parsed?.fuzzyTokens).toEqual(['hoshimya', 'toto']);
    expect(parsed?.primaryFuzzyToken).toBe('hoshimya');
    expect(parsed?.shortTokens).toEqual([]);
  });

  it('keeps every fuzzy token for the precision pass to require', () => {
    const parsed = parseSearchTerm('otr e2e no matching beatmap 7fd826c1');
    expect(parsed?.fuzzyTokens).toEqual([
      'otr',
      'e2e',
      'matching',
      'beatmap',
      '7fd826c1',
    ]);
    expect(parsed?.shortTokens).toEqual(['no']);
  });
});

describe('buildTrigramPrecision', () => {
  const render = (term: string, columns: SQL[]) => {
    const parsed = parseSearchTerm(term);
    expect(parsed).not.toBeNull();
    return dialect.sqlToQuery(buildTrigramPrecision(columns, parsed!));
  };

  const columns = [sql`title`, sql`artist`];

  it('requires every fuzzy token somewhere, not just the first', () => {
    const { params } = render('bad buny te deseo', columns);

    // The whole term, then each token on its own, then the short token.
    expect(params).toEqual([
      'bad buny deseo',
      0.6,
      'bad buny deseo',
      0.6,
      'bad',
      0.6,
      'bad',
      0.6,
      'buny',
      0.6,
      'buny',
      0.6,
      'deseo',
      0.6,
      'deseo',
      0.6,
      '\\mte\\M',
      '\\mte\\M',
    ]);
  });

  it('reads every column, so a token may live in any of them', () => {
    const { sql: text } = render('hoshimya toto', columns);

    expect(text.match(/coalesce\(title, ''\)/g)?.length).toBe(3);
    expect(text.match(/coalesce\(artist, ''\)/g)?.length).toBe(3);
  });

  it('does not restate a single-token term as its own token list', () => {
    const { params } = render('hoshimya', columns);

    expect(params).toEqual(['hoshimya', 0.6, 'hoshimya', 0.6]);
  });

  it('matches nothing when no token can carry a trigram', () => {
    const { sql: text } = render('w', columns);

    expect(text).toBe('false');
  });
});

describe('buildBeatmapSearchExpressions', () => {
  it('ranks the overridden artist and title alongside the set metadata', () => {
    const expressions = buildBeatmapSearchExpressions('hoshimiya');
    const { sql: text } = dialect.sqlToQuery(expressions!.rank);

    expect(text).toContain(
      'coalesce("beatmaps"."artist_override", "beatmapsets"."artist", \'\')'
    );
    expect(text).toContain(
      'coalesce("beatmaps"."title_override", "beatmapsets"."title", \'\')'
    );
  });
});
