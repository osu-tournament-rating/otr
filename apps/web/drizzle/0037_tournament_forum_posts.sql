CREATE TABLE "tournament_forum_posts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_forum_posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"topic_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"title" text NOT NULL,
	"bbcode" text NOT NULL,
	"edited_at" timestamp with time zone,
	"fetched" timestamp with time zone NOT NULL,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "forum_post_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ix_tournament_forum_posts_topic_id" ON "tournament_forum_posts" USING btree ("topic_id" int4_ops);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "fk_tournaments_tournament_forum_posts_forum_post_id" FOREIGN KEY ("forum_post_id") REFERENCES "public"."tournament_forum_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_tournaments_forum_post_id" ON "tournaments" USING btree ("forum_post_id" int4_ops);--> statement-breakpoint
-- The data worker derives forum_post_id from forum_url, which is already
-- audited, so leave it out of audit changes. Same signature and body as 0032;
-- only the default excluded_columns change.
CREATE OR REPLACE FUNCTION public.compute_audit_changes(
  old_row jsonb,
  new_row jsonb,
  excluded_columns text[] DEFAULT ARRAY[
    'id',
    'updated',
    'search_vector',
    'match_rank_vector',
    'forum_post_id'
  ]::text[]
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT
      old_row - excluded_columns AS old_data,
      new_row - excluded_columns AS new_data
  )
  SELECT COALESCE(
    jsonb_object_agg(
      field_name,
      jsonb_build_object(
        'newValue', COALESCE(new_data -> field_name, 'null'::jsonb),
        'originalValue', COALESCE(old_data -> field_name, 'null'::jsonb)
      )
      ORDER BY field_name
    ),
    '{}'::jsonb
  )
  FROM normalized
  CROSS JOIN LATERAL jsonb_object_keys(
    COALESCE(old_data, '{}'::jsonb) || COALESCE(new_data, '{}'::jsonb)
  ) AS fields(field_name)
  WHERE COALESCE(old_data -> field_name, 'null'::jsonb)
    IS DISTINCT FROM COALESCE(new_data -> field_name, 'null'::jsonb);
$$;
