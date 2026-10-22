ALTER TABLE "filter_reports" DROP CONSTRAINT "fk_filter_reports_users_user_id";
--> statement-breakpoint
ALTER TABLE "filter_reports" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_reports" ADD CONSTRAINT "fk_filter_reports_users_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;