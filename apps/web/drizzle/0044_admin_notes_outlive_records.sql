ALTER TABLE "game_admin_notes" DROP CONSTRAINT "fk_game_admin_notes_games_reference_id";
--> statement-breakpoint
ALTER TABLE "game_score_admin_notes" DROP CONSTRAINT "fk_game_score_admin_notes_game_scores_reference_id";
--> statement-breakpoint
ALTER TABLE "match_admin_notes" DROP CONSTRAINT "fk_match_admin_notes_matches_reference_id";
--> statement-breakpoint
ALTER TABLE "tournament_admin_notes" DROP CONSTRAINT "fk_tournament_admin_notes_tournaments_reference_id";
