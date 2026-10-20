import { describe, expect, it } from 'bun:test';

import type { JobDailyTotals } from '@/lib/orpc/schema/jobs';

import {
  listDays,
  listEndpoints,
  sortEndpointTotals,
  toJobDayRows,
  toRequestDayRows,
} from '../daily';

const outcome = {
  enqueued: 0,
  succeeded: 0,
  retried: 0,
  failed: 0,
  discarded: 0,
  cancelled: 0,
  reclaimed: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
};

const totals = (overrides: Partial<JobDailyTotals>): JobDailyTotals => ({
  from: '2026-02-27',
  to: '2026-03-02',
  jobsByDay: [],
  jobsByQueue: [],
  requestsByDay: [],
  requestsByEndpoint: [],
  ...overrides,
});

describe('listDays', () => {
  it('lists every UTC day of the range, both ends included', () => {
    expect(listDays('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});

describe('toJobDayRows', () => {
  it('fills the days nothing ran with zeros and no run time', () => {
    const rows = toJobDayRows(
      totals({
        jobsByDay: [
          {
            ...outcome,
            day: '2026-02-28',
            succeeded: 3,
            failed: 1,
            totalDurationMs: 2000,
          },
        ],
      })
    );

    expect(rows.map((row) => [row.day, row.succeeded, row.failed])).toEqual([
      ['2026-02-27', 0, 0],
      ['2026-02-28', 3, 1],
      ['2026-03-01', 0, 0],
      ['2026-03-02', 0, 0],
    ]);
    // 2,000 ms over three successes and one failure.
    expect(rows[1]!.averageRunTimeMs).toBe(500);
    expect(rows[0]!.averageRunTimeMs).toBeNull();
  });
});

describe('request rows', () => {
  const requests = totals({
    requestsByDay: [
      {
        day: '2026-02-27',
        service: 'osutrack',
        endpoint: 'statsHistory',
        count: 4,
      },
      { day: '2026-02-27', service: 'osu', endpoint: 'getUser', count: 9 },
      { day: '2026-03-01', service: 'osu', endpoint: 'getMatch', count: 2 },
      { day: '2026-03-01', service: 'osu', endpoint: 'getScores', count: 1 },
    ],
  });

  it('orders endpoints as the labels do, unknown ones last', () => {
    expect(listEndpoints(requests).map((endpoint) => endpoint.key)).toEqual([
      'osu:getMatch',
      'osu:getUser',
      'osutrack:statsHistory',
      'osu:getScores',
    ]);
  });

  it("puts each endpoint's requests on its day, zero on the others", () => {
    const rows = toRequestDayRows(requests, listEndpoints(requests));

    expect(rows.map((row) => row['osu:getUser'])).toEqual([9, 0, 0, 0]);
    expect(rows.map((row) => row['osu:getMatch'])).toEqual([0, 0, 2, 0]);
  });
});

describe('sortEndpointTotals', () => {
  it('lists endpoints as the chart does, each with its successes first', () => {
    const row = (endpoint: string, status: string) => ({
      service: 'osu',
      endpoint,
      status,
    });

    expect(
      sortEndpointTotals([
        row('getBeatmap', 'error'),
        row('getBeatmap', 'success'),
        row('getMatch', 'not_found'),
        row('getMatch', 'success'),
      ]).map((total) => `${total.endpoint} ${total.status}`)
    ).toEqual([
      'getMatch success',
      'getMatch not_found',
      'getBeatmap success',
      'getBeatmap error',
    ]);
  });
});
