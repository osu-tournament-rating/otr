declare namespace NodeJS {
  interface ProcessEnv {
    /** Deprecated */
    NEXT_PUBLIC_API_BASE_URL: string;
    /** Deprecated */
    NEXT_PUBLIC_APP_BASE_URL: string;
    /** Origin for server-side rpc calls, when the public URL is unreachable */
    INTERNAL_APP_BASE_URL?: string;
    DATABASE_URL: string;
    API_KEY?: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    WEB_OSU_CLIENT_ID: string;
    WEB_OSU_CLIENT_SECRET: string;
    /** osu! origin for e2e runs; honored only when E2E_TEST_AUTH=true */
    E2E_OSU_URL?: string;
    RABBITMQ_AMQP_URL: string;
    /** /rpc rate limits: enforced in production and off elsewhere by default */
    RPC_RATE_LIMIT?: 'enforce' | 'observe' | 'off';
    /** Set: drain on SIGTERM (lib/shutdown.ts) instead of Next.js closing at once */
    NEXT_MANUAL_SIG_HANDLE?: string;
    /** How long a draining server keeps serving before it exits */
    SHUTDOWN_DRAIN_SECONDS?: string;
  }
}
