ALTER TABLE "users" ADD COLUMN "osu_sign_in_needed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "api_allowance_full_at";