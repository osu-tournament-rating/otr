ALTER TABLE "user_settings" ADD COLUMN "profile_ruleset" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "browsing_ruleset" integer;--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "default_ruleset";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "default_ruleset";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "default_ruleset_is_controlled";