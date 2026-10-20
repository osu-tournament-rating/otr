CREATE TABLE "filter_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "filter_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" integer DEFAULT 0 NOT NULL,
	"user_id" integer,
	"ruleset" integer NOT NULL,
	"min_rating" integer,
	"max_rating" integer,
	"osu_player_ids" bigint[] NOT NULL,
	"unknown_player_count" integer NOT NULL,
	"justification" text NOT NULL,
	"filter_report_id" integer,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" integer DEFAULT 0 NOT NULL,
	"submitted_by_user_id" integer,
	"name" varchar(512) NOT NULL,
	"abbreviation" varchar(32) NOT NULL,
	"forum_url" varchar(255) NOT NULL,
	"rank_range_lower_bound" integer NOT NULL,
	"ruleset" integer NOT NULL,
	"lobby_size" integer NOT NULL,
	"is_lazer" boolean DEFAULT false NOT NULL,
	"match_ids" bigint[] NOT NULL,
	"beatmap_ids" bigint[] DEFAULT '{}' NOT NULL,
	"tournament_id" integer,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_allowance_full_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filter_requests" ADD CONSTRAINT "fk_filter_requests_users_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_requests" ADD CONSTRAINT "fk_filter_requests_users_reviewed_by_user_id" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_requests" ADD CONSTRAINT "fk_filter_requests_filter_reports_filter_report_id" FOREIGN KEY ("filter_report_id") REFERENCES "public"."filter_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_submissions" ADD CONSTRAINT "fk_tournament_submissions_users_submitted_by_user_id" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_submissions" ADD CONSTRAINT "fk_tournament_submissions_users_reviewed_by_user_id" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_submissions" ADD CONSTRAINT "fk_tournament_submissions_tournaments_tournament_id" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_filter_requests_status" ON "filter_requests" USING btree ("status" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_filter_requests_user_id_created" ON "filter_requests" USING btree ("user_id" int4_ops,"created" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_tournament_submissions_status" ON "tournament_submissions" USING btree ("status" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_tournament_submissions_submitted_by_user_id" ON "tournament_submissions" USING btree ("submitted_by_user_id" int4_ops);