-- Grafana's production dashboards read through this role. Roles belong to the
-- cluster, so it may already exist; it starts unable to log in, and
-- scripts/run-migrations.ts gives it a password where one is configured.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'otr_grafana_read_only') THEN
    CREATE ROLE otr_grafana_read_only NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO otr_grafana_read_only;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO otr_grafana_read_only;
--> statement-breakpoint
-- Tables created later, by the role that runs migrations, are readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO otr_grafana_read_only;
--> statement-breakpoint
-- Credential tables are readable except their secret columns, the same ones
-- the dev archive redacts (dev_secret_columns in apps/scripts). A column added
-- to one of these tables later stays hidden until a migration grants it.
DO $$
DECLARE
  secret record;
  readable text;
BEGIN
  FOR secret IN
    SELECT * FROM (VALUES
      ('api_keys', ARRAY['key']),
      ('auth_accounts', ARRAY['access_token', 'refresh_token', 'id_token', 'password']),
      ('auth_sessions', ARRAY['token']),
      ('auth_verifications', ARRAY['value']),
      ('o_auth_clients', ARRAY['secret'])
    ) AS t(table_name, columns)
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM otr_grafana_read_only', secret.table_name);

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO readable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = secret.table_name
       AND column_name <> ALL (secret.columns);

    IF readable IS NULL THEN
      RAISE EXCEPTION 'public.% has no columns to grant', secret.table_name;
    END IF;

    EXECUTE format('GRANT SELECT (%s) ON public.%I TO otr_grafana_read_only', readable, secret.table_name);
  END LOOP;
END $$;
