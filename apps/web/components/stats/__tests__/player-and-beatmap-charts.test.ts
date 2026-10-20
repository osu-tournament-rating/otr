import { describe, expect, it } from 'bun:test';

import {
  TREND_MIN_TOURNAMENTS,
  formatHourRange,
  getActivePlayerBars,
  getPoolDifficultyRows,
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

describe('getPoolDifficultyRows', () => {
  const point = (tournaments: number, median: number) => ({
    maps: tournaments * 10,
    tournaments,
    median,
    p90: median + 1,
  });

  it('leaves a gap where a kind of tournament has too few that year', () => {
    const rows = getPoolDifficultyRows(
      [
        {
          year: 2024,
          tournaments: ENOUGH,
          open: point(5, 6),
          restricted: point(4, 5),
        },
        {
          year: 2025,
          tournaments: ENOUGH,
          open: point(6, 6.5),
          restricted: null,
        },
      ],
      5
    );

    expect(rows).toEqual([
      {
        year: 2024,
        label: '2024',
        openMedian: 6,
        openP90: 7,
        restrictedMedian: null,
        restrictedP90: null,
        openMaps: 50,
        restrictedMaps: 0,
      },
      {
        year: 2025,
        label: '2025',
        openMedian: 6.5,
        openP90: 7.5,
        restrictedMedian: null,
        restrictedP90: null,
        openMaps: 60,
        restrictedMaps: 0,
      },
    ]);
  });

  it('is empty when no year has a point', () => {
    expect(
      getPoolDifficultyRows(
        [
          {
            year: 2025,
            tournaments: ENOUGH,
            open: point(2, 6),
            restricted: null,
          },
        ],
        5
      )
    ).toEqual([]);
  });
});

describe('formatHourRange', () => {
  it('writes an hour of the UTC day, wrapping at midnight', () => {
    expect(formatHourRange(9)).toBe('09:00–10:00 UTC');
    expect(formatHourRange(23)).toBe('23:00–00:00 UTC');
  });
});
