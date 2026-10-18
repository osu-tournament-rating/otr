import { afterEach, describe, expect, it } from 'bun:test';
import { JobQueue } from '@otr/core/jobs';

import { setJobSummarySource } from '../job-metrics';
// Registered with the rest at worker startup.
import '../queue-metrics';
import { handleMetricsRequest } from '../server';

const scrape = () =>
  handleMetricsRequest(new Request('http://worker/metrics'), () => true);

describe('job metrics', () => {
  afterEach(() => setJobSummarySource(null));

  it('reports jobs per queue and state, with zero for a queue that has none', async () => {
    setJobSummarySource({
      queues: [JobQueue.TournamentStats, JobQueue.OsuFetch],
      read: async () => [
        {
          queue: JobQueue.TournamentStats,
          ready: 3,
          delayed: 1,
          running: 1,
          failed: 2,
          oldestReadySeconds: 42,
        },
      ],
    });

    const text = await (await scrape()).text();

    expect(text).toContain(
      'data_worker_jobs{queue="processing.stats.tournaments",state="ready",app="data-worker"} 3'
    );
    expect(text).toContain(
      'data_worker_jobs{queue="processing.stats.tournaments",state="failed",app="data-worker"} 2'
    );
    expect(text).toContain(
      'data_worker_jobs{queue="data.osu",state="ready",app="data-worker"} 0'
    );
    expect(text).toContain(
      'data_worker_jobs_oldest_ready_seconds{queue="processing.stats.tournaments",app="data-worker"} 42'
    );
  });

  it('still serves every other metric when the job counts cannot be read', async () => {
    setJobSummarySource({
      queues: [JobQueue.TournamentStats],
      read: async () => {
        throw new Error('database unavailable');
      },
    });

    const response = await scrape();

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'data_worker_queue_messages_processed_total'
    );
  });
});
