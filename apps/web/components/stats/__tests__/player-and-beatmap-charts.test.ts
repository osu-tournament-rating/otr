import { describe, expect, it } from 'bun:test';

import {
  TREND_MIN_TOURNAMENTS,
  formatHourRange,
  getActivePlayerBars,
} from '@/components/stats/stats-data';

const ENOUGH = TREND_MIN_TOURNAMENTS;
const TOO_FEW = TREND_MIN_TOURNAMENTS - 1;

describe('getActivePlayerBars', () => {
  it('splits each trend year into returning and new players, a year without matches as zero', () => {
    const bars = getActivePlayerBars([
      // Many players, but too few tournaments to start the trend.
      {
        year: 2017,
        tournaments: TOO_FEW,
        players: 90,
        newPlayers: 90,
        newPlayersReturned: 4,
      },
      {
        year: 2018,
        tournaments: ENOUGH,
        players: 50,
        newPlayers: 30,
        newPlayersReturned: 10,
      },
      {
        year: 2020,
        tournaments: 1,
        players: 20,
        newPlayers: 5,
        newPlayersReturned: 0,
      },
    ]);

    expect(bars).toEqual([
      { key: '2018', label: '2018', values: { returning: 20, new: 30 } },
      { key: '2019', label: '2019', values: { returning: 0, new: 0 } },
      { key: '2020', label: '2020', values: { returning: 15, new: 5 } },
    ]);
  });
});

describe('formatHourRange', () => {
  it('writes an hour of the UTC day, wrapping at midnight', () => {
    expect(formatHourRange(9)).toBe('09:00–10:00 UTC');
    expect(formatHourRange(23)).toBe('23:00–00:00 UTC');
  });
});
