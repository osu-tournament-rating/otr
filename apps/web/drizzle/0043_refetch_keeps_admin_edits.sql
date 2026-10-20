-- A refetch keeps what admins corrected. Each match, game and score lists the
-- osu! fields an admin changed in edited_fields, and keep_admin_edits keeps
-- those values through writes that carry no admin (otr.audit_user_id unset):
-- data worker fetches, automated checks and the processor. fetch_exclusions
-- lists the games and scores admins deleted or merged away, which fetches
-- skip. Both are filled from the audit log first.
--
-- The audit log is read before any table is altered: ADD COLUMN locks
-- matches, games and game_scores until the migration commits, so everything
-- after it must be quick.

-- One row per (table, row, column) whose latest change was an admin's edit of
-- one row. Audit keys come in three formats: camelCase with NewValue or
-- newValue (otr-api, before October 2025), and snake_case with newValue (the
-- triggers since). Legacy rows can list fields that did not change, so only
-- keys whose value changed count. An event that changed the same column on
-- more than one row was a cascade, such as a tournament's new ruleset, not a
-- correction.
CREATE TEMP TABLE admin_edit_backfill (
  table_name text NOT NULL,
  row_id integer NOT NULL,
  column_name text NOT NULL
);--> statement-breakpoint
CREATE TEMP TABLE admin_edit_audit_keys (
  table_name text NOT NULL,
  column_name text NOT NULL,
  audit_key text NOT NULL
);--> statement-breakpoint
INSERT INTO admin_edit_audit_keys (table_name, column_name, audit_key)
VALUES
  ('matches', 'name', 'name'),
  ('matches', 'start_time', 'start_time'),
  ('matches', 'start_time', 'startTime'),
  ('matches', 'end_time', 'end_time'),
  ('matches', 'end_time', 'endTime'),
  ('games', 'ruleset', 'ruleset'),
  ('games', 'scoring_type', 'scoring_type'),
  ('games', 'scoring_type', 'scoringType'),
  ('games', 'team_type', 'team_type'),
  ('games', 'team_type', 'teamType'),
  ('games', 'mods', 'mods'),
  ('games', 'lazer_mods', 'lazer_mods'),
  ('games', 'start_time', 'start_time'),
  ('games', 'start_time', 'startTime'),
  ('games', 'end_time', 'end_time'),
  ('games', 'end_time', 'endTime'),
  ('game_scores', 'accuracy', 'accuracy'),
  ('game_scores', 'max_combo', 'max_combo'),
  ('game_scores', 'max_combo', 'maxCombo'),
  ('game_scores', 'stat_perfect', 'stat_perfect'),
  ('game_scores', 'stat_perfect', 'count_geki'),
  ('game_scores', 'stat_perfect', 'countGeki'),
  ('game_scores', 'stat_great', 'stat_great'),
  ('game_scores', 'stat_great', 'count300'),
  ('game_scores', 'stat_good', 'stat_good'),
  ('game_scores', 'stat_good', 'count_katu'),
  ('game_scores', 'stat_good', 'countKatu'),
  ('game_scores', 'stat_ok', 'stat_ok'),
  ('game_scores', 'stat_ok', 'count100'),
  ('game_scores', 'stat_meh', 'stat_meh'),
  ('game_scores', 'stat_meh', 'count50'),
  ('game_scores', 'stat_miss', 'stat_miss'),
  ('game_scores', 'stat_miss', 'count_miss'),
  ('game_scores', 'stat_miss', 'countMiss'),
  ('game_scores', 'grade', 'grade'),
  ('game_scores', 'mods', 'mods'),
  ('game_scores', 'lazer_mods', 'lazer_mods'),
  ('game_scores', 'team', 'team'),
  ('game_scores', 'ruleset', 'ruleset');--> statement-breakpoint
CREATE FUNCTION pg_temp.audit_value_changed(change jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(change -> 'newValue', change -> 'NewValue')
    IS DISTINCT FROM COALESCE(change -> 'originalValue', change -> 'OriginalValue');
$$;--> statement-breakpoint
WITH audit_keys AS (
  SELECT column_name, audit_key FROM admin_edit_audit_keys WHERE table_name = 'matches'
),
admin_changes AS (
  SELECT
    audit.reference_id_lock AS row_id,
    audit_keys.column_name,
    COALESCE(audit.event_id::text, audit.action_user_id || '@' || audit.created) AS event_key
  FROM match_audits audit
  JOIN audit_keys ON audit.changes ? audit_keys.audit_key
  WHERE audit.action_type = 1
    AND audit.action_user_id IS NOT NULL
    AND pg_temp.audit_value_changed(audit.changes -> audit_keys.audit_key)
),
single_row_events AS (
  SELECT event_key, column_name
  FROM admin_changes
  GROUP BY event_key, column_name
  HAVING count(DISTINCT row_id) = 1
),
latest AS (
  SELECT candidate.row_id, candidate.column_name, last_change.action_user_id, last_change.event_key
  FROM (SELECT DISTINCT row_id, column_name FROM admin_changes) candidate
  CROSS JOIN LATERAL (
    SELECT
      audit.action_user_id,
      COALESCE(audit.event_id::text, audit.action_user_id || '@' || audit.created) AS event_key
    FROM match_audits audit
    JOIN audit_keys
      ON audit_keys.column_name = candidate.column_name
      AND audit.changes ? audit_keys.audit_key
    WHERE audit.reference_id_lock = candidate.row_id
      AND audit.action_type = 1
      AND pg_temp.audit_value_changed(audit.changes -> audit_keys.audit_key)
    ORDER BY audit.created DESC, audit.id DESC
    LIMIT 1
  ) last_change
)
INSERT INTO admin_edit_backfill (table_name, row_id, column_name)
SELECT 'matches', latest.row_id, latest.column_name
FROM latest
JOIN single_row_events USING (event_key, column_name)
WHERE latest.action_user_id IS NOT NULL;--> statement-breakpoint
WITH audit_keys AS (
  SELECT column_name, audit_key FROM admin_edit_audit_keys WHERE table_name = 'games'
),
admin_changes AS (
  SELECT
    audit.reference_id_lock AS row_id,
    audit_keys.column_name,
    COALESCE(audit.event_id::text, audit.action_user_id || '@' || audit.created) AS event_key
  FROM game_audits audit
  JOIN audit_keys ON audit.changes ? audit_keys.audit_key
  WHERE audit.action_type = 1
    AND audit.action_user_id IS NOT NULL
    AND pg_temp.audit_value_changed(audit.changes -> audit_keys.audit_key)
),
single_row_events AS (
  SELECT event_key, column_name
  FROM admin_changes
  GROUP BY event_key, column_name
  HAVING count(DISTINCT row_id) = 1
),
latest AS (
  SELECT candidate.row_id, candidate.column_name, last_change.action_user_id, last_change.event_key
  FROM (SELECT DISTINCT row_id, column_name FROM admin_changes) candidate
  CROSS JOIN LATERAL (
    SELECT
      audit.action_user_id,
      COALESCE(audit.event_id::text, audit.action_user_id || '@' || audit.created) AS event_key
    FROM game_audits audit
    JOIN audit_keys
      ON audit_keys.column_name = candidate.column_name
      AND audit.changes ? audit_keys.audit_key
    WHERE audit.reference_id_lock = candidate.row_id
      AND audit.action_type = 1
      AND pg_temp.audit_value_changed(audit.changes -> audit_keys.audit_key)
    ORDER BY audit.created DESC, audit.id DESC
    LIMIT 1
  ) last_change
)
INSERT INTO admin_edit_backfill (table_name, row_id, column_name)
SELECT 'games', latest.row_id, latest.column_name
FROM latest
JOIN single_row_events USING (event_key, column_name)
WHERE latest.action_user_id IS NOT NULL;--> statement-breakpoint
WITH audit_keys AS (
  SELECT column_name, audit_key FROM admin_edit_audit_keys WHERE table_name = 'game_scores'
),
admin_changes AS (
  SELECT
    audit.reference_id_lock AS row_id,
    audit_keys.column_name,
    COALESCE(audit.event_id::text, audit.action_user_id || '@' || audit.created) AS event_key
  FROM game_score_audits audit
  JOIN audit_keys ON audit.changes ? audit_keys.audit_key
  WHERE audit.action_type = 1
    AND audit.action_user_id IS NOT NULL
    AND pg_temp.audit_value_changed(audit.changes -> audit_keys.audit_key)
),
single_row_events AS (
  SELECT event_key, column_name
  FROM admin_changes
  GROUP BY event_key, column_name
  HAVING count(DISTINCT row_id) = 1
),
latest AS (
  SELECT candidate.row_id, candidate.column_name, last_change.action_user_id, last_change.event_key
  FROM (SELECT DISTINCT row_id, column_name FROM admin_changes) candidate
  CROSS JOIN LATERAL (
    SELECT
      audit.action_user_id,
      COALESCE(audit.event_id::text, audit.action_user_id || '@' || audit.created) AS event_key
    FROM game_score_audits audit
    JOIN audit_keys
      ON audit_keys.column_name = candidate.column_name
      AND audit.changes ? audit_keys.audit_key
    WHERE audit.reference_id_lock = candidate.row_id
      AND audit.action_type = 1
      AND pg_temp.audit_value_changed(audit.changes -> audit_keys.audit_key)
    ORDER BY audit.created DESC, audit.id DESC
    LIMIT 1
  ) last_change
)
INSERT INTO admin_edit_backfill (table_name, row_id, column_name)
SELECT 'game_scores', latest.row_id, latest.column_name
FROM latest
JOIN single_row_events USING (event_key, column_name)
WHERE latest.action_user_id IS NOT NULL;--> statement-breakpoint

-- Games and scores admins deleted since the audit triggers record the deleted
-- row (October 2025; otr-api's delete audits kept no values). A deleted
-- match's games were deleted with it, and a merged match's games now sit in
-- the match it was merged into. A game merge moved the child's scores and
-- deleted the child in one transaction, so they share a created timestamp.
-- deleted_at is when a game was deleted or merged away.
CREATE TEMP TABLE fetch_exclusion_backfill (
  match_id integer NOT NULL,
  osu_game_id bigint NOT NULL,
  player_id integer,
  merged_into_game_id integer,
  deleted_at timestamp with time zone
);--> statement-breakpoint
WITH deleted_games AS (
  SELECT
    audit.reference_id_lock AS game_id,
    COALESCE(merge.match_id, (audit.changes -> 'match_id' ->> 'originalValue')::integer) AS match_id,
    (audit.changes -> 'osu_id' ->> 'originalValue')::bigint AS osu_game_id,
    audit.created
  FROM game_audits audit
  LEFT JOIN match_merges merge
    ON merge.merged_match_id = (audit.changes -> 'match_id' ->> 'originalValue')::integer
  WHERE audit.action_type = 2
    AND audit.action_user_id IS NOT NULL
    AND audit.changes -> 'osu_id' ->> 'originalValue' IS NOT NULL
)
INSERT INTO fetch_exclusion_backfill (match_id, osu_game_id, merged_into_game_id, deleted_at)
SELECT DISTINCT ON (deleted_games.match_id, deleted_games.osu_game_id)
  deleted_games.match_id,
  deleted_games.osu_game_id,
  parent.id,
  deleted_games.created
FROM deleted_games
JOIN matches ON matches.id = deleted_games.match_id
LEFT JOIN LATERAL (
  SELECT (score_audit.changes -> 'game_id' ->> 'newValue')::integer AS game_id
  FROM game_score_audits score_audit
  WHERE score_audit.created = deleted_games.created
    AND score_audit.action_type = 1
    AND score_audit.changes -> 'game_id' ->> 'originalValue' = deleted_games.game_id::text
  LIMIT 1
) moved ON true
LEFT JOIN games parent ON parent.id = moved.game_id
ORDER BY deleted_games.match_id, deleted_games.osu_game_id, deleted_games.created DESC;--> statement-breakpoint
-- A deleted score is excluded under its game's osu! game. When a later merge
-- or delete removed that game, the game's delete audit gives its osu! game. A
-- score deleted from a game that other games had been merged into may have
-- come from any of them, so it is excluded under each of theirs too, as the
-- delete trigger below does.
WITH deleted_scores AS (
  SELECT
    (audit.changes -> 'game_id' ->> 'originalValue')::integer AS game_id,
    (audit.changes -> 'player_id' ->> 'originalValue')::integer AS player_id,
    audit.created
  FROM game_score_audits audit
  WHERE audit.action_type = 2
    AND audit.action_user_id IS NOT NULL
),
score_games AS (
  SELECT
    deleted_scores.game_id,
    deleted_scores.player_id,
    deleted_scores.created,
    COALESCE(games.match_id, deleted_game.match_id) AS match_id,
    COALESCE(games.osu_id, deleted_game.osu_game_id) AS osu_game_id
  FROM deleted_scores
  LEFT JOIN games ON games.id = deleted_scores.game_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(merge.match_id, (game_audit.changes -> 'match_id' ->> 'originalValue')::integer) AS match_id,
      (game_audit.changes -> 'osu_id' ->> 'originalValue')::bigint AS osu_game_id
    FROM game_audits game_audit
    LEFT JOIN match_merges merge
      ON merge.merged_match_id = (game_audit.changes -> 'match_id' ->> 'originalValue')::integer
    WHERE games.id IS NULL
      AND game_audit.reference_id_lock = deleted_scores.game_id
      AND game_audit.action_type = 2
      AND game_audit.changes -> 'osu_id' ->> 'originalValue' IS NOT NULL
    ORDER BY game_audit.created DESC, game_audit.id DESC
    LIMIT 1
  ) deleted_game ON true
),
excluded AS (
  SELECT match_id, osu_game_id, player_id
  FROM score_games
  UNION
  SELECT score_games.match_id, merged.osu_game_id, score_games.player_id
  FROM score_games
  JOIN fetch_exclusion_backfill merged
    ON merged.merged_into_game_id = score_games.game_id
    AND merged.player_id IS NULL
    AND merged.deleted_at < score_games.created
)
INSERT INTO fetch_exclusion_backfill (match_id, osu_game_id, player_id)
SELECT excluded.match_id, excluded.osu_game_id, excluded.player_id
FROM excluded
JOIN matches ON matches.id = excluded.match_id
JOIN players ON players.id = excluded.player_id
WHERE excluded.osu_game_id IS NOT NULL;--> statement-breakpoint

CREATE TABLE "fetch_exclusions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fetch_exclusions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"match_id" integer NOT NULL,
	"osu_game_id" bigint NOT NULL,
	"player_id" integer,
	"merged_into_game_id" integer,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "uq_fetch_exclusions_match_id_osu_game_id_player_id" UNIQUE NULLS NOT DISTINCT("match_id","osu_game_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "game_scores" ADD COLUMN "edited_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "edited_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "edited_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "fetch_exclusions" ADD CONSTRAINT "fk_fetch_exclusions_matches_match_id" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_exclusions" ADD CONSTRAINT "fk_fetch_exclusions_players_player_id" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_exclusions" ADD CONSTRAINT "fk_fetch_exclusions_games_merged_into_game_id" FOREIGN KEY ("merged_into_game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_fetch_exclusions_merged_into_game_id" ON "fetch_exclusions" USING btree ("merged_into_game_id" int4_ops);--> statement-breakpoint

-- Filling the backfill in is not an admin edit, so it stays out of the audit
-- log, as 0028's backfill did.
ALTER TABLE "matches" DISABLE TRIGGER "trg_matches_audit";--> statement-breakpoint
ALTER TABLE "games" DISABLE TRIGGER "trg_games_audit";--> statement-breakpoint
ALTER TABLE "game_scores" DISABLE TRIGGER "trg_game_scores_audit";--> statement-breakpoint
-- A group locks as a whole: mods with lazer mods.
UPDATE "matches"
SET "edited_fields" = edited.columns
FROM (
  SELECT row_id, array_agg(DISTINCT column_name ORDER BY column_name) AS columns
  FROM admin_edit_backfill
  WHERE table_name = 'matches'
  GROUP BY row_id
) edited
WHERE "matches"."id" = edited.row_id;--> statement-breakpoint
UPDATE "games"
SET "edited_fields" = edited.columns
FROM (
  SELECT row_id, array_agg(DISTINCT grouped.column_name ORDER BY grouped.column_name) AS columns
  FROM admin_edit_backfill
  CROSS JOIN LATERAL unnest(
    CASE WHEN admin_edit_backfill.column_name IN ('mods', 'lazer_mods')
      THEN ARRAY['lazer_mods', 'mods']
      ELSE ARRAY[admin_edit_backfill.column_name]
    END
  ) AS grouped(column_name)
  WHERE table_name = 'games'
  GROUP BY row_id
) edited
WHERE "games"."id" = edited.row_id;--> statement-breakpoint
UPDATE "game_scores"
SET "edited_fields" = edited.columns
FROM (
  SELECT row_id, array_agg(DISTINCT grouped.column_name ORDER BY grouped.column_name) AS columns
  FROM admin_edit_backfill
  CROSS JOIN LATERAL unnest(
    CASE WHEN admin_edit_backfill.column_name IN ('mods', 'lazer_mods')
      THEN ARRAY['lazer_mods', 'mods']
      ELSE ARRAY[admin_edit_backfill.column_name]
    END
  ) AS grouped(column_name)
  WHERE table_name = 'game_scores'
  GROUP BY row_id
) edited
WHERE "game_scores"."id" = edited.row_id;--> statement-breakpoint
ALTER TABLE "matches" ENABLE TRIGGER "trg_matches_audit";--> statement-breakpoint
ALTER TABLE "games" ENABLE TRIGGER "trg_games_audit";--> statement-breakpoint
ALTER TABLE "game_scores" ENABLE TRIGGER "trg_game_scores_audit";--> statement-breakpoint
INSERT INTO "fetch_exclusions" ("match_id", "osu_game_id", "player_id", "merged_into_game_id")
SELECT match_id, osu_game_id, player_id, merged_into_game_id
FROM fetch_exclusion_backfill
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE admin_edit_backfill;--> statement-breakpoint
DROP TABLE admin_edit_audit_keys;--> statement-breakpoint
DROP TABLE fetch_exclusion_backfill;--> statement-breakpoint
DROP FUNCTION pg_temp.audit_value_changed(jsonb);--> statement-breakpoint

-- The trigger's arguments are the table's field groups, one per argument with
-- columns separated by spaces; packages/otr-core/src/db/admin-edits.ts lists
-- the same groups. An admin's write (otr.audit_user_id set) that changes a
-- group's column adds the whole group to edited_fields, unless the write set
-- otr.edit_locks to off for a cascade. Any other write keeps edited_fields as
-- it was and keeps the old value of every column in it.
CREATE OR REPLACE FUNCTION public.keep_admin_edits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  kept jsonb := '{}'::jsonb;
  field_group text[];
  field text;
  group_index integer;
BEGIN
  IF public.resolve_audit_user_id() IS NULL THEN
    NEW.edited_fields := OLD.edited_fields;

    IF cardinality(OLD.edited_fields) = 0 THEN
      RETURN NEW;
    END IF;

    old_row := to_jsonb(OLD);
    FOREACH field IN ARRAY OLD.edited_fields LOOP
      IF old_row ? field THEN
        kept := kept || jsonb_build_object(field, old_row -> field);
      END IF;
    END LOOP;

    RETURN jsonb_populate_record(NEW, kept);
  END IF;

  IF COALESCE(current_setting('otr.edit_locks', true), '') = 'off' THEN
    RETURN NEW;
  END IF;

  old_row := to_jsonb(OLD);
  new_row := to_jsonb(NEW);

  FOR group_index IN 0 .. TG_NARGS - 1 LOOP
    field_group := string_to_array(TG_ARGV[group_index], ' ');

    IF EXISTS (
      SELECT 1
      FROM unnest(field_group) AS group_field
      WHERE (old_row -> group_field) IS DISTINCT FROM (new_row -> group_field)
    ) THEN
      NEW.edited_fields := ARRAY(
        SELECT DISTINCT edited_field
        FROM unnest(NEW.edited_fields || field_group) AS edited_field
        ORDER BY edited_field
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER matches_keep_admin_edits
BEFORE UPDATE ON matches
FOR EACH ROW
EXECUTE FUNCTION public.keep_admin_edits('name', 'start_time', 'end_time');--> statement-breakpoint
CREATE TRIGGER games_keep_admin_edits
BEFORE UPDATE ON games
FOR EACH ROW
EXECUTE FUNCTION public.keep_admin_edits(
  'ruleset',
  'scoring_type',
  'team_type',
  'mods lazer_mods',
  'start_time',
  'end_time'
);--> statement-breakpoint
CREATE TRIGGER game_scores_keep_admin_edits
BEFORE UPDATE ON game_scores
FOR EACH ROW
EXECUTE FUNCTION public.keep_admin_edits(
  'accuracy',
  'max_combo',
  'stat_perfect',
  'stat_great',
  'stat_good',
  'stat_ok',
  'stat_meh',
  'stat_miss',
  'grade',
  'mods lazer_mods',
  'team',
  'ruleset'
);--> statement-breakpoint

-- An admin's delete of a game, or of one player's score, adds it to
-- fetch_exclusions. A delete that cascades from its match (or game) adds
-- nothing: the parent is already gone, and a refetch never brings it back.
-- A score in a game that other games were merged into may have come from any
-- of their osu! games, so its player is excluded from each of them.
CREATE OR REPLACE FUNCTION public.exclude_deleted_game_from_fetches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.resolve_audit_user_id() IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO fetch_exclusions (match_id, osu_game_id)
  SELECT matches.id, OLD.osu_id
  FROM matches
  WHERE matches.id = OLD.match_id
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER games_exclude_deleted_from_fetches
AFTER DELETE ON games
FOR EACH ROW
EXECUTE FUNCTION public.exclude_deleted_game_from_fetches();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.exclude_deleted_score_from_fetches()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.resolve_audit_user_id() IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO fetch_exclusions (match_id, osu_game_id, player_id)
  SELECT games.match_id, games.osu_id, players.id
  FROM games
  JOIN players ON players.id = OLD.player_id
  WHERE games.id = OLD.game_id
  UNION
  SELECT games.match_id, merged.osu_game_id, players.id
  FROM games
  JOIN players ON players.id = OLD.player_id
  JOIN fetch_exclusions merged
    ON merged.merged_into_game_id = games.id
    AND merged.match_id = games.match_id
    AND merged.player_id IS NULL
  WHERE games.id = OLD.game_id
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER game_scores_exclude_deleted_from_fetches
AFTER DELETE ON game_scores
FOR EACH ROW
EXECUTE FUNCTION public.exclude_deleted_score_from_fetches();
