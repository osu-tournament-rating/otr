CREATE TABLE "platform_stats" (
	"name" varchar(64) NOT NULL,
	"ruleset" integer,
	"payload" jsonb NOT NULL,
	"version" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_platform_stats_name_ruleset" UNIQUE NULLS NOT DISTINCT("name","ruleset")
);
