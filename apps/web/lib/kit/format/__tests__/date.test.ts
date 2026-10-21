import { describe, expect, it } from 'bun:test';

import {
  formatDate,
  formatDateRange,
  formatDuration,
  formatRelativeTime,
  formatRunTime,
  formatTimeRange,
  formatTimestamp,
  parseDuration,
  toDate,
  toDateTimeAttribute,
} from '../date';

const EM_DASH = '—';

describe('toDate', () => {
  it('reads dates, epoch milliseconds and ISO strings', () => {
    const date = new Date('2024-07-20T15:42:00Z');
    expect(toDate(date)).toBe(date);
    expect(toDate(date.getTime())?.toISOString()).toBe(date.toISOString());
    expect(toDate('2024-07-20T15:42:00Z')?.toISOString()).toBe(
      date.toISOString()
    );
    expect(toDate('2024-07-20T15:42:00.000+00:00')?.toISOString()).toBe(
      date.toISOString()
    );
  });

  it('reads Postgres timestamp text', () => {
    expect(toDate('2024-07-20 15:42:00+00')?.toISOString()).toBe(
      '2024-07-20T15:42:00.000Z'
    );
    expect(toDate('2024-07-20 17:42:00.123+02')?.toISOString()).toBe(
      '2024-07-20T15:42:00.123Z'
    );
  });

  it('reads Postgres microseconds', () => {
    expect(toDate('2024-07-20T15:42:00.123456+00:00')?.toISOString()).toBe(
      '2024-07-20T15:42:00.123Z'
    );
    expect(toDate('2024-07-20 15:42:00.123456+00')?.toISOString()).toBe(
      '2024-07-20T15:42:00.123Z'
    );
  });

  it('reads a bare date as UTC midnight', () => {
    expect(toDate('2024-07-20')?.toISOString()).toBe(
      '2024-07-20T00:00:00.000Z'
    );
  });

  it('reads a date and time with no zone as UTC, not local time', () => {
    expect(toDate('2024-07-20T15:42:00')?.toISOString()).toBe(
      '2024-07-20T15:42:00.000Z'
    );
    expect(toDate('2024-07-20 15:42:00.5')?.toISOString()).toBe(
      '2024-07-20T15:42:00.500Z'
    );
    expect(toDate('2024-07-20T15:42')?.toISOString()).toBe(
      '2024-07-20T15:42:00.000Z'
    );
  });

  it('returns null for nothing or nonsense', () => {
    for (const input of [null, undefined, '', 'soon', Number.NaN]) {
      expect(toDate(input)).toBeNull();
    }
    expect(toDate(new Date('nope'))).toBeNull();
  });
});

describe('formatDate', () => {
  it('writes the month short, the day and the year', () => {
    expect(formatDate('2024-07-20T15:42:00Z')).toBe('Jul 20, 2024');
    expect(formatDate('2024-01-01T00:00:00Z')).toBe('Jan 1, 2024');
    expect(formatDate('2023-12-31T23:59:59Z')).toBe('Dec 31, 2023');
  });

  it('uses the UTC day, whatever the offset in the input', () => {
    // 23:30 at UTC-5 is already the next day in UTC.
    expect(formatDate('2024-07-20T23:30:00-05:00')).toBe('Jul 21, 2024');
    expect(formatDate('2024-07-21T01:00:00+05:00')).toBe('Jul 20, 2024');
  });

  it('prints an em dash, or the given text, when there is no date', () => {
    expect(formatDate(null)).toBe(EM_DASH);
    expect(formatDate('garbage')).toBe(EM_DASH);
    expect(formatDate(undefined, { empty: 'Unknown' })).toBe('Unknown');
  });
});

describe('formatDateRange', () => {
  it('collapses one day to a single date', () => {
    expect(
      formatDateRange('2024-07-20T10:00:00Z', '2024-07-20T22:00:00Z')
    ).toBe('Jul 20, 2024');
  });

  it('shares the month and year within one month', () => {
    expect(formatDateRange('2024-07-20', '2024-07-27')).toBe(
      'Jul 20 – 27, 2024'
    );
  });

  it('shares the year within one year', () => {
    expect(formatDateRange('2024-07-20', '2024-08-03')).toBe(
      'Jul 20 – Aug 3, 2024'
    );
  });

  it('writes both years across years', () => {
    expect(formatDateRange('2023-12-28', '2024-01-04')).toBe(
      'Dec 28, 2023 – Jan 4, 2024'
    );
  });

  it('does not treat the same month in different years as one month', () => {
    expect(formatDateRange('2023-07-20', '2024-07-27')).toBe(
      'Jul 20, 2023 – Jul 27, 2024'
    );
  });

  it('says which end is open when one is missing', () => {
    expect(formatDateRange('2024-07-20', null)).toBe('From Jul 20, 2024');
    expect(formatDateRange(undefined, '2024-08-03')).toBe('Until Aug 3, 2024');
    expect(formatDateRange('2024-07-20', 'not a date')).toBe(
      'From Jul 20, 2024'
    );
  });

  it('prints the empty text when both ends are missing', () => {
    expect(formatDateRange(null, null)).toBe(EM_DASH);
    expect(formatDateRange(null, undefined, { empty: 'Dates unknown' })).toBe(
      'Dates unknown'
    );
  });

  it('uses plain spaces, never the thin ones some engines put around the dash', () => {
    const range = formatDateRange('2024-07-20', '2024-08-03');
    const thinSpaces = String.fromCharCode(0x2009, 0x202f);
    expect([...range].some((char) => thinSpaces.includes(char))).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('writes the date and a 24-hour UTC time', () => {
    expect(formatTimestamp('2024-07-20T15:42:07Z')).toBe(
      'Jul 20, 2024, 15:42 UTC'
    );
    expect(formatTimestamp('2024-07-20T03:05:00Z')).toBe(
      'Jul 20, 2024, 03:05 UTC'
    );
    expect(formatTimestamp('2024-07-20T00:00:00Z')).toBe(
      'Jul 20, 2024, 00:00 UTC'
    );
  });

  it('converts offsets to UTC', () => {
    expect(formatTimestamp('2024-07-20 17:42:00+02')).toBe(
      'Jul 20, 2024, 15:42 UTC'
    );
  });

  it('adds seconds on request', () => {
    expect(formatTimestamp('2024-07-20T15:42:07Z', { seconds: true })).toBe(
      'Jul 20, 2024, 15:42:07 UTC'
    );
  });

  it('prints the empty text when there is no time', () => {
    expect(formatTimestamp(null)).toBe(EM_DASH);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2024-07-20T15:42:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it('says just now within a minute', () => {
    expect(formatRelativeTime(now, now)).toBe('just now');
    expect(formatRelativeTime(ago(59_999), now)).toBe('just now');
  });

  it('counts whole minutes, hours and days', () => {
    expect(formatRelativeTime(ago(minute), now)).toBe('1m ago');
    expect(formatRelativeTime(ago(59 * minute), now)).toBe('59m ago');
    expect(formatRelativeTime(ago(hour), now)).toBe('1h ago');
    expect(formatRelativeTime(ago(3 * hour + 59 * minute), now)).toBe('3h ago');
    expect(formatRelativeTime(ago(day), now)).toBe('1d ago');
    expect(formatRelativeTime(ago(29 * day), now)).toBe('29d ago');
  });

  it('switches to the date at 30 days', () => {
    expect(formatRelativeTime(ago(30 * day), now)).toBe('Jun 20, 2024');
    expect(formatRelativeTime('2023-01-05T00:00:00Z', now)).toBe('Jan 5, 2023');
  });

  it('reads future times forward', () => {
    expect(formatRelativeTime(ago(-5 * minute), now)).toBe('in 5m');
    expect(formatRelativeTime(ago(-3 * hour), now)).toBe('in 3h');
  });

  it('prints the empty text when either time is missing', () => {
    expect(formatRelativeTime(null, now)).toBe(EM_DASH);
    expect(formatRelativeTime(now, 'nope')).toBe(EM_DASH);
  });
});

describe('time zone independence', () => {
  it('prints the same text in every zone', () => {
    // Bun keeps the last zone it was given even after TZ is deleted, so
    // restore the resolved zone itself or later test files run in the wrong one.
    const original =
      process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const instant = '2024-07-20T23:30:00Z';

    try {
      const outputs = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'].map(
        (zone) => {
          process.env.TZ = zone;
          return [
            formatDate(instant),
            formatDateRange(instant, '2024-08-03T00:30:00Z'),
            formatTimestamp(instant),
            formatRelativeTime('2024-07-19T23:30:00Z', instant),
            formatTimestamp('2024-07-20 23:30:00'),
          ].join(' | ');
        }
      );

      expect(new Set(outputs).size).toBe(1);
      expect(outputs[0]).toBe(
        'Jul 20, 2024 | Jul 20 – Aug 3, 2024 | Jul 20, 2024, 23:30 UTC | 1d ago | Jul 20, 2024, 23:30 UTC'
      );
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('toDateTimeAttribute', () => {
  it('gives an ISO string, or only the date', () => {
    expect(toDateTimeAttribute('2024-07-20 15:42:00+00')).toBe(
      '2024-07-20T15:42:00.000Z'
    );
    expect(
      toDateTimeAttribute('2024-07-20T15:42:00Z', { dateOnly: true })
    ).toBe('2024-07-20');
    expect(toDateTimeAttribute(null)).toBeUndefined();
  });
});

describe('formatTimeRange', () => {
  const start = '2024-07-20T15:42:07Z';
  const end = '2024-07-20T15:45:30Z';

  it('writes two moments on one UTC day as clock times', () => {
    expect(formatTimeRange(start, end)).toBe('15:42 – 15:45 UTC');
    expect(formatTimeRange(start, end, { seconds: true })).toBe(
      '15:42:07 – 15:45:30 UTC'
    );
  });

  it('adds the day when asked', () => {
    expect(formatTimeRange(start, end, { showDate: true })).toBe(
      'Jul 20, 2024, 15:42 – 15:45 UTC'
    );
  });

  it('reads both ends in UTC, whatever zone they arrive in', () => {
    expect(
      formatTimeRange('2024-07-20T10:42:07-05:00', '2024-07-20 15:45:30+00')
    ).toBe('15:42 – 15:45 UTC');
  });

  it('writes full timestamps when the ends fall on different days', () => {
    expect(
      formatTimeRange('2024-07-20T23:58:01Z', '2024-07-21T00:02:10Z', {
        seconds: true,
      })
    ).toBe('Jul 20, 2024, 23:58:01 UTC – Jul 21, 2024, 00:02:10 UTC');
  });

  it('marks an open end', () => {
    expect(formatTimeRange(start, null)).toBe('From Jul 20, 2024, 15:42 UTC');
    expect(formatTimeRange(undefined, end)).toBe(
      'Until Jul 20, 2024, 15:45 UTC'
    );
  });

  it('prints the empty text when both ends are missing or unreadable', () => {
    expect(formatTimeRange(null, 'not a date')).toBe(EM_DASH);
    expect(formatTimeRange(null, null, { empty: 'Unknown' })).toBe('Unknown');
  });
});

describe('formatDuration', () => {
  it('writes minutes and seconds under an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(124)).toBe('2:04');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('adds hours from an hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3724)).toBe('1:02:04');
  });

  it('drops fractions of a second', () => {
    expect(formatDuration(124.9)).toBe('2:04');
    expect(formatDuration(3724.5)).toBe('1:02:04');
  });

  it('prints the empty text for missing, negative or unreadable input', () => {
    expect(formatDuration(null)).toBe(EM_DASH);
    expect(formatDuration(undefined)).toBe(EM_DASH);
    expect(formatDuration(Number.NaN)).toBe(EM_DASH);
    expect(formatDuration(-5)).toBe(EM_DASH);
    expect(formatDuration(null, { empty: 'Unknown' })).toBe('Unknown');
  });
});

describe('formatRunTime', () => {
  it('writes milliseconds under a second', () => {
    expect(formatRunTime(0)).toBe('0 ms');
    expect(formatRunTime(849.6)).toBe('850 ms');
    expect(formatRunTime(999.4)).toBe('999 ms');
  });

  it('writes seconds to one decimal under a minute', () => {
    expect(formatRunTime(999.5)).toBe('1 s');
    expect(formatRunTime(12_450)).toBe('12.5 s');
    expect(formatRunTime(59_940)).toBe('59.9 s');
  });

  it('writes a length from a minute', () => {
    expect(formatRunTime(59_950)).toBe('1:00');
    expect(formatRunTime(124_000)).toBe('2:04');
    expect(formatRunTime(3_724_000)).toBe('1:02:04');
  });

  it('prints the empty text for missing, negative or unreadable input', () => {
    expect(formatRunTime(null)).toBe(EM_DASH);
    expect(formatRunTime(Number.NaN)).toBe(EM_DASH);
    expect(formatRunTime(-1)).toBe(EM_DASH);
    expect(formatRunTime(undefined, { empty: 'Unknown' })).toBe('Unknown');
  });
});

describe('parseDuration', () => {
  it('reads m:ss, h:mm:ss and bare seconds', () => {
    expect(parseDuration('3:42')).toBe(222);
    expect(parseDuration('0:07')).toBe(7);
    expect(parseDuration('1:23:45')).toBe(5025);
    expect(parseDuration('222')).toBe(222);
    expect(parseDuration('  3:42 ')).toBe(222);
  });

  it('rejects anything that is not a duration', () => {
    for (const input of [
      '',
      'abc',
      '-1',
      '3:60',
      '3:',
      ':42',
      '1.5',
      '3:4:5:6',
    ]) {
      expect(parseDuration(input)).toBeNull();
    }
  });

  it('round-trips through formatDuration', () => {
    for (const seconds of [0, 7, 222, 720, 3600, 5025]) {
      expect(parseDuration(formatDuration(seconds))).toBe(seconds);
    }
  });
});
