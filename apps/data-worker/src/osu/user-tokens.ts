import { and, desc, eq } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';

import type { DatabaseClient } from '../db';

/** The provider id Better Auth saves osu! sign-ins under. */
const OSU_PROVIDER_ID = 'osu';

/** A token that expires sooner than this is refreshed before use. */
const REFRESH_MARGIN_MS = 60_000;

const REFRESH_TIMEOUT_MS = 15_000;

/** Why o!TR can't act for a user on osu! until they sign in with osu! again. */
export type SignInNeededReason =
  'no saved token' | 'refresh refused' | 'token refused';

/**
 * The user's saved osu! credentials can't be used: there are none, osu!
 * refused to refresh them, or osu! refused a fresh token, as it does once
 * the user revokes o!TR's access or when the token lacks a scope. Signing in
 * with osu! again saves new ones.
 */
export class OsuSignInNeededError extends Error {
  constructor(readonly reason: SignInNeededReason) {
    super(`The user must sign in with osu! again: ${reason}`);
    this.name = 'OsuSignInNeededError';
  }
}

/** The site's osu! OAuth client, which issued users' tokens and alone can refresh them. */
export interface OsuSignInClient {
  clientId: string;
  clientSecret: string;
}

export interface UserOsuTokensOptions {
  db: Pick<DatabaseClient, 'transaction'>;
  client: OsuSignInClient;
  /** osu!'s base URL. */
  server?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

export interface UserAccessToken {
  accessToken: string;
  /** Refreshed during this call, so osu! refusing it is final. */
  fresh: boolean;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
}

/**
 * Reads the osu! tokens a user saved by signing in with osu!, which Better
 * Auth keeps in auth_accounts, and refreshes them when they expire. The
 * tokens never leave this class except as the bearer token of a request to
 * osu!: they go in no job payload, log line, span or error message.
 */
export class UserOsuTokens {
  private readonly db: UserOsuTokensOptions['db'];
  private readonly client: OsuSignInClient;
  private readonly server: string;
  private readonly fetch: NonNullable<UserOsuTokensOptions['fetch']>;
  private readonly now: () => number;

  constructor(options: UserOsuTokensOptions) {
    this.db = options.db;
    this.client = options.client;
    this.server = options.server ?? 'https://osu.ppy.sh';
    // Read at call time, so the worker's wrappers of fetch apply
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  /**
   * An access token for `userId`'s osu! account. One that expires within a
   * minute, or any when `forceRefresh` is set, is refreshed first and saved.
   * The account row stays locked while it refreshes, so a sign-in waits
   * instead of being overwritten with older tokens.
   */
  async accessToken(
    userId: number,
    { forceRefresh = false }: { forceRefresh?: boolean } = {}
  ): Promise<UserAccessToken> {
    return this.db.transaction(async (tx) => {
      const [account] = await tx
        .select({
          id: schema.auth_accounts.id,
          accessToken: schema.auth_accounts.accessToken,
          refreshToken: schema.auth_accounts.refreshToken,
          accessTokenExpiresAt: schema.auth_accounts.accessTokenExpiresAt,
        })
        .from(schema.users)
        .innerJoin(
          schema.auth_users,
          eq(schema.auth_users.playerId, schema.users.playerId)
        )
        .innerJoin(
          schema.auth_accounts,
          and(
            eq(schema.auth_accounts.userId, schema.auth_users.id),
            eq(schema.auth_accounts.providerId, OSU_PROVIDER_ID)
          )
        )
        .where(eq(schema.users.id, userId))
        .orderBy(desc(schema.auth_accounts.updatedAt))
        .limit(1)
        .for('update', { of: schema.auth_accounts });

      if (!account) {
        throw new OsuSignInNeededError('no saved token');
      }

      const expiresAt = account.accessTokenExpiresAt?.getTime() ?? 0;
      const current = account.accessToken;

      if (
        !forceRefresh &&
        current &&
        expiresAt - this.now() > REFRESH_MARGIN_MS
      ) {
        return { accessToken: current, fresh: false };
      }

      if (!account.refreshToken) {
        throw new OsuSignInNeededError('no saved token');
      }

      const refreshed = await this.refresh(account.refreshToken);

      await tx
        .update(schema.auth_accounts)
        .set({
          accessToken: refreshed.accessToken,
          // osu! may keep the refresh token it was given
          refreshToken: refreshed.refreshToken ?? account.refreshToken,
          accessTokenExpiresAt: refreshed.expiresAt,
          updatedAt: new Date(this.now()),
        })
        .where(eq(schema.auth_accounts.id, account.id));

      return { accessToken: refreshed.accessToken, fresh: true };
    });
  }

  private async refresh(refreshToken: string) {
    const response = await this.fetch(`${this.server}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.client.clientId,
        client_secret: this.client.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    const body = (await response.json().catch(() => ({}))) as TokenResponse;

    if (response.status === 400 || response.status === 401) {
      // osu! refusing o!TR's own client is a configuration fault, which the
      // user can't fix by signing in.
      if (body.error === 'invalid_client') {
        throw new Error(
          'osu! refused the site client credentials while refreshing a token'
        );
      }
      throw new OsuSignInNeededError('refresh refused');
    }

    if (!response.ok) {
      throw new Error(`osu! failed to refresh a token (${response.status})`);
    }

    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new Error('osu! refreshed a token without returning one');
    }

    const expiresIn = Number(body.expires_in);

    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : null,
      // osu! tokens last a day; without a lifetime, refresh at next use
      expiresAt: new Date(
        this.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 0)
      ),
    };
  }
}
