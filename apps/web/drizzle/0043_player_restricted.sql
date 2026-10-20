ALTER TABLE "players" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A player whose last osu! fetch returned not found (3) is restricted or
-- deleted. osu! never reports another user's restriction, so that status is
-- the only signal; from now on the data worker records it here as well.
UPDATE "players" SET "restricted" = true WHERE "data_fetch_status" = 3;
