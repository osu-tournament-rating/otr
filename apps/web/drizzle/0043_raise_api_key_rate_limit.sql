-- The standard API key rate limit rose from 60 to 1,000 requests a minute.
-- Each key stores its own limit, so every key still below the new standard,
-- including any an admin raised under the old one, gets it.
UPDATE "api_keys"
SET "rate_limit_max" = 1000
WHERE "rate_limit_time_window" = 60000
  AND "rate_limit_max" < 1000;
