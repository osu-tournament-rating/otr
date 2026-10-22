-- Admin notes outlive the records they describe, so their reference ids no
-- longer carry foreign keys. The audit log's default view reads the game and
-- score audit tables now. Each index build reads the whole table and holds
-- writes to it until done, about three seconds for game_score_audits on a
-- local copy of production.
ALTER TABLE "game_admin_notes" DROP CONSTRAINT "fk_game_admin_notes_games_reference_id";
--> statement-breakpoint
ALTER TABLE "game_score_admin_notes" DROP CONSTRAINT "fk_game_score_admin_notes_game_scores_reference_id";
--> statement-breakpoint
ALTER TABLE "match_admin_notes" DROP CONSTRAINT "fk_match_admin_notes_matches_reference_id";
--> statement-breakpoint
ALTER TABLE "tournament_admin_notes" DROP CONSTRAINT "fk_tournament_admin_notes_tournaments_reference_id";
--> statement-breakpoint
CREATE INDEX "ix_game_audits_action_type_created" ON "game_audits" USING btree ("action_type" int4_ops,"created" timestamptz_ops,"action_user_id" int4_ops) WHERE action_type <> 1;--> statement-breakpoint
CREATE INDEX "ix_game_score_audits_action_type_created" ON "game_score_audits" USING btree ("action_type" int4_ops,"created" timestamptz_ops,"action_user_id" int4_ops) WHERE action_type <> 1;