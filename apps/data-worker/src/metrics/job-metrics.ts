import { Counter, Gauge } from 'prom-client';
import type { JobQueueSummary } from '@otr/core/jobs';

import { metricsRegistry } from './registry';

const JOB_STATES = ['ready', 'delayed', 'running', 'failed'] as const;

let summarySource: {
  queues: readonly string[];
  read: () => Promise<JobQueueSummary[]>;
} | null = null;

/** Where the job gauges read their numbers from at each scrape. */
export const setJobSummarySource = (source: typeof summarySource) => {
  summarySource = source;
  cachedSummary = null;
};

let cachedSummary: Promise<JobQueueSummary[] | null> | null = null;

/**
 * Both gauges read the same query, so one scrape runs it once. A failed query
 * leaves the gauges at their last values instead of failing every metric.
 */
const readSummary = () => {
  if (!summarySource) {
    return Promise.resolve(null);
  }
  if (!cachedSummary) {
    cachedSummary = summarySource
      .read()
      .catch((error) => {
        console.error('Failed to read job counts for metrics', error);
        return null;
      })
      .finally(() => {
        setTimeout(() => {
          cachedSummary = null;
        }, 1_000);
      });
  }
  return cachedSummary;
};

export const jobsByState = new Gauge({
  name: 'data_worker_jobs',
  help: 'Jobs in the jobs table by queue and state',
  labelNames: ['queue', 'state'] as const,
  registers: [metricsRegistry],
  async collect() {
    const summary = await readSummary();
    if (!summarySource || !summary) return;
    for (const queue of summarySource.queues) {
      const row = summary.find((entry) => entry.queue === queue);
      for (const state of JOB_STATES) {
        this.labels({ queue, state }).set(row?.[state] ?? 0);
      }
    }
  },
});

export const jobsOldestReadySeconds = new Gauge({
  name: 'data_worker_jobs_oldest_ready_seconds',
  help: 'How long the oldest ready job has waited',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
  async collect() {
    const summary = await readSummary();
    if (!summarySource || !summary) return;
    for (const queue of summarySource.queues) {
      const row = summary.find((entry) => entry.queue === queue);
      this.labels({ queue }).set(row?.oldestReadySeconds ?? 0);
    }
  },
});

export const jobsLoopActive = new Gauge({
  name: 'data_worker_jobs_loop_active',
  help: '1 while a queue claims jobs; 0 while it is stopped or paused',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const jobsReclaimed = new Counter({
  name: 'data_worker_jobs_reclaimed_total',
  help: 'Job leases taken back from a worker that stopped renewing them',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const rabbitMqBridged = new Counter({
  name: 'data_worker_rabbitmq_bridged_total',
  help: 'RabbitMQ messages moved into the jobs table',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});
