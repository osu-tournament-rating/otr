import { Client } from 'pg';

import type { Logger } from '../logging/logger';

/** The channel the jobs table's trigger notifies with a queue name. */
export const JOBS_CHANNEL = 'otr_jobs';

const MAX_RECONNECT_DELAY_MS = 30_000;

interface JobListenerOptions {
  connectionString: string;
  logger: Logger;
  onReady: (queue: string) => void;
}

/**
 * Holds one connection that LISTENs for ready jobs, so a queue's loop claims
 * as soon as a job commits. Loops also poll, so a lost connection only adds
 * latency until it reconnects.
 */
export class JobListener {
  private readonly options: JobListenerOptions;
  private client: Client | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: JobListenerOptions) {
    this.options = options;
  }

  async start() {
    await this.connect(1);
  }

  async stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => {});
  }

  private async connect(attempt: number) {
    if (this.stopped) {
      return;
    }

    const client = new Client({
      connectionString: this.options.connectionString,
      keepAlive: true,
    });

    const lost = (error?: unknown) => {
      if (this.client !== client) {
        return;
      }
      this.client = null;
      client.end().catch(() => {});
      this.options.logger.warn('Lost the job notification connection', {
        error,
      });
      this.scheduleReconnect(1);
    };

    client.on('error', lost);
    client.on('end', () => lost());
    client.on('notification', (message) => {
      if (message.channel === JOBS_CHANNEL && message.payload) {
        this.options.onReady(message.payload);
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${JOBS_CHANNEL}`);
      this.client = client;
    } catch (error) {
      await client.end().catch(() => {});
      this.options.logger.warn('Failed to listen for job notifications', {
        attempt,
        error,
      });
      this.scheduleReconnect(attempt + 1);
    }
  }

  private scheduleReconnect(attempt: number) {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(attempt);
    }, delay);
  }
}
