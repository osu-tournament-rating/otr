-- The settings page used to keep each API key whole in api_keys.metadata, as
-- {"secret": "<key>"}, so it could show the key again. Anyone who could read
-- the table, such as otr_grafana_read_only or a dev-tier copy, could use
-- every key. Keys are now shown once, when made, and only their hash and
-- first characters stay in the database, so this removes the stored copies.
--
-- Only metadata that parses as a JSON object is touched; the CASE keeps the
-- cast from running on anything else. A key whose metadata held nothing but
-- the secret is left with {}. Running it again changes nothing.
UPDATE "api_keys"
SET "metadata" = ("metadata"::jsonb - 'secret')::text
WHERE CASE
  WHEN pg_input_is_valid("metadata", 'jsonb')
    THEN jsonb_typeof("metadata"::jsonb) = 'object'
      AND "metadata"::jsonb ? 'secret'
  ELSE false
END;
