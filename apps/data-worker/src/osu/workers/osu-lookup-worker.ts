import { and, eq, sql } from 'drizzle-orm';
import { API } from 'osu-api-v2-js';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import {
  JobQueue,
  JobStatus,
  OSU_LOOKUP_REQUESTS_PER_MINUTE,
  resumeOsuLookups,
} from '@otr/core/jobs';

import type { DatabaseClient } from '../../db';
import {
  DeferJobError,
  DiscardJobError,
  RetryableJobError,
} from '../../jobs/errors';
import { pauseForMaintenanceWindow } from '../../jobs/maintenance';
import type {
  ClaimedJob,
  JobTransaction,
  QueueRegistration,
} from '../../jobs/types';
import type { Logger } from '../../logging/logger';
import { SlidingWindowRateLimiter } from '../../rate-limiter';
import { trackOsuRetryAfter } from '../retry-after';
import {
  OsuTokenRefusedError,
  PLAYER_FETCH_REQUESTS,
  PlayerFetchService,
} from '../services/player-fetch-service';
import { OsuSignInNeededError, type UserOsuTokens } from '../user-tokens';
import { asJobError } from './osu-api-fetch-worker';

const MINUTE_MS = 60_000;

/**
 * How long lookups waiting for their user to sign in again wait before they
 * look again. Signing in wakes them at once, so this only matters when the
 * user doesn't come back: the player's fetch lease runs out after as long,
 * o!TR's own refresh then fetches the player, and the next look finds
 * nothing left to do.
 */
export const SIGN_IN_WAIT_MS = 7 * 24 * 60 * MINUTE_MS;

export const WAITING_FOR_SPEED =
  "Waiting for the requester's osu! lookup speed";
export const WAITING_FOR_SIGN_IN =
  'Waiting for the requester to sign in with osu! again';

interface OsuLookupWorkerOptions {
  db: DatabaseClient;
  tokens: Pick<UserOsuTokens, 'accessToken'>;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
  /** osu!'s base URL. */
  server?: string;
  now?: () => number;
}

/**
 * Runs data.osu.lookup jobs: fetches a player o!TR has never seen with the
 * osu! account of the user who asked, through the same player fetch as
 * o!TR's own, at up to {@link OSU_LOOKUP_REQUESTS_PER_MINUTE} requests a
 * minute per user. That speed is the user's alone, apart from o!TR's own
 * osu! rate limiter and from other users'.
 *
 * A job never sleeps on a user's speed: it moves that user's waiting lookups
 * to when their speed allows the next one, so other users' lookups run in
 * between. When the user's credentials can't be used, their lookups wait for
 * them to sign in with osu! again, without using attempts.
 */
export class OsuLookupWorker {
  private readonly options: OsuLookupWorkerOptions;
  private readonly maintenancePause: (now: Date) => Date | null;
  private readonly now: () => number;
  private readonly speeds = new Map<number, SlidingWindowRateLimiter>();

  constructor(options: OsuLookupWorkerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.maintenancePause = pauseForMaintenanceWindow(
      options.maintenanceWindowEnabled
    );
  }

  registration(): QueueRegistration<JobQueue.OsuLookup> {
    return {
      queue: JobQueue.OsuLookup,
      handler: (job) => this.handle(job),
      pausedUntil: (now) => this.maintenancePause(now),
      onGiveUp: (job, tx) => this.releasePlayer(job.payload.osuPlayerId, tx),
    };
  }

  async handle(job: ClaimedJob<JobQueue.OsuLookup>) {
    const { osuPlayerId } = job.payload;
    const userId = job.requestedByUserId;
    const logger = this.options.logger.child({ osuPlayerId, userId });

    // Another fetch got there first, such as a tournament's
    if (!(await this.awaitsLookup(osuPlayerId))) {
      logger.info('Player was already fetched; nothing to look up');
      return;
    }

    if (userId === null || !(await this.userExists(userId))) {
      await this.releasePlayer(osuPlayerId, this.options.db);
      throw new DiscardJobError('The requester no longer has an account');
    }

    const speed = this.speedOf(userId);
    const waitMs = speed.msUntilAvailable(PLAYER_FETCH_REQUESTS);
    if (waitMs > 0) {
      await this.deferLookups(userId, waitMs);
      throw new DeferJobError(WAITING_FOR_SPEED, waitMs);
    }

    await trackOsuRetryAfter(async () => {
      try {
        await this.lookUp(userId, osuPlayerId, speed);
      } catch (error) {
        if (error instanceof OsuSignInNeededError) {
          logger.warn('Lookups wait for the requester to sign in again', {
            reason: error.reason,
          });
          await this.waitForSignIn(userId);
          throw new DeferJobError(WAITING_FOR_SIGN_IN, SIGN_IN_WAIT_MS);
        }

        const jobError = asJobError(error);
        if (jobError instanceof RetryableJobError && jobError.delayMs) {
          // osu! asked this user's token to wait; their other lookups would
          // only be told the same.
          await this.deferLookups(userId, jobError.delayMs);
        }
        throw jobError;
      }
    });

    // The user's token works again, such as after a sign-in whose wake-up
    // this job missed, so their other lookups need not wait any longer.
    if (
      await resumeOsuLookups(this.options.db, userId, { onlyIfNoted: true })
    ) {
      logger.info('Lookups resumed after the requester signed in again');
    }
  }

  /**
   * Fetches the player with the user's token. A token osu! refuses before
   * it was due to expire may have been revoked or replaced, so it is
   * refreshed once; osu! refusing a fresh token is final.
   */
  private async lookUp(
    userId: number,
    osuPlayerId: number,
    speed: SlidingWindowRateLimiter
  ) {
    const { tokens } = this.options;
    let token = await tokens.accessToken(userId);

    for (;;) {
      try {
        await this.playerService(token.accessToken, speed).fetchAndPersist(
          osuPlayerId
        );
        return;
      } catch (error) {
        if (!(error instanceof OsuTokenRefusedError)) {
          throw error;
        }
        if (token.fresh) {
          throw new OsuSignInNeededError('token refused');
        }
        token = await tokens.accessToken(userId, { forceRefresh: true });
      }
    }
  }

  private playerService(accessToken: string, speed: SlidingWindowRateLimiter) {
    const api = new API({
      access_token: accessToken,
      token_type: 'Bearer',
      server: this.options.server ?? 'https://osu.ppy.sh',
      // o!TR refreshes the user's token itself, so it can save the new one
      set_token_on_creation: false,
      set_token_on_401: false,
      set_token_on_expires: false,
      // A 429 reaches the job, which waits as long as osu! asks
      retry_maximum_amount: 0,
      retry_on_status_codes: [],
    });

    return new PlayerFetchService({
      db: this.options.db,
      api,
      rateLimiter: speed,
      logger: this.options.logger,
      throwOnRefusedToken: true,
    });
  }

  /** Whether the player is still Fetching, under the lease the filter took for this lookup. */
  private async awaitsLookup(osuPlayerId: number) {
    const [player] = await this.options.db
      .select({ status: schema.players.dataFetchStatus })
      .from(schema.players)
      .where(eq(schema.players.osuId, osuPlayerId));

    return player?.status === DataFetchStatus.Fetching;
  }

  private async userExists(userId: number) {
    const [user] = await this.options.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    return user !== undefined;
  }

  /** The user's own speed, apart from every other user's and from o!TR's. */
  private speedOf(userId: number) {
    for (const [id, speed] of this.speeds) {
      if (id !== userId && speed.isIdle()) {
        this.speeds.delete(id);
      }
    }

    let speed = this.speeds.get(userId);
    if (!speed) {
      speed = new SlidingWindowRateLimiter({
        requests: OSU_LOOKUP_REQUESTS_PER_MINUTE,
        windowMs: MINUTE_MS,
        now: this.now,
      });
      this.speeds.set(userId, speed);
    }
    return speed;
  }

  /**
   * Moves the user's lookups that would come due within `delayMs` to its
   * end, so the queue claims other users' lookups instead of each of these
   * in turn.
   */
  private async deferLookups(userId: number, delayMs: number) {
    await this.options.db.execute(sql`
      UPDATE jobs SET
        run_after = now() + ${Math.ceil(delayMs)}::integer * interval '1 millisecond',
        updated = now()
      WHERE queue = ${JobQueue.OsuLookup}
        AND status = ${JobStatus.Pending}
        AND requested_by_user_id = ${userId}
        AND run_after < now() + ${Math.ceil(delayMs)}::integer * interval '1 millisecond'`);
  }

  /**
   * Notes that the user must sign in with osu! again, which the filter page
   * tells them, and holds their lookups until they do. Signing in clears the
   * note and wakes the lookups.
   */
  private async waitForSignIn(userId: number) {
    await this.options.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({
          osuSignInNeededAt: sql`COALESCE(${schema.users.osuSignInNeededAt}, now())`,
        })
        .where(eq(schema.users.id, userId));

      await tx.execute(sql`
        UPDATE jobs SET
          run_after = GREATEST(run_after, now() + ${SIGN_IN_WAIT_MS}::bigint * interval '1 millisecond'),
          last_error = ${WAITING_FOR_SIGN_IN},
          updated = now()
        WHERE queue = ${JobQueue.OsuLookup}
          AND status = ${JobStatus.Pending}
          AND requested_by_user_id = ${userId}`);
    });
  }

  /**
   * Ends the lease the filter took for this lookup, as an osu! fetch that
   * gives up does, so o!TR's own refresh fetches the player later instead
   * of the stranded fetch sweep at once.
   */
  private async releasePlayer(
    osuPlayerId: number,
    db: Pick<DatabaseClient, 'update'> | JobTransaction
  ) {
    await db
      .update(schema.players)
      .set({
        dataFetchStatus: DataFetchStatus.Error,
        updated: new Date(this.now()).toISOString(),
      })
      .where(
        and(
          eq(schema.players.osuId, osuPlayerId),
          eq(schema.players.dataFetchStatus, DataFetchStatus.Fetching)
        )
      );
  }
}
