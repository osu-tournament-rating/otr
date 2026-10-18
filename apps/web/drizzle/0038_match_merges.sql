CREATE TABLE "match_merges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "match_merges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"match_id" integer NOT NULL,
	"merged_match_id" integer NOT NULL,
	"osu_id" bigint NOT NULL,
	"is_lazer" boolean NOT NULL,
	"name" varchar(512) DEFAULT '' NOT NULL,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_merges" ADD CONSTRAINT "fk_match_merges_matches_match_id" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_match_merges_match_id" ON "match_merges" USING btree ("match_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_match_merges_merged_match_id" ON "match_merges" USING btree ("merged_match_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_match_merges_osu_id_is_lazer" ON "match_merges" USING btree ("osu_id" int8_ops,"is_lazer" bool_ops);