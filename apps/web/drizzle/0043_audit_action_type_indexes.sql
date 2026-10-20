-- The audit log's default view reads these tables now. Each build reads the
-- whole table and holds writes to it until done, about three seconds for
-- game_score_audits on a local copy of production.
CREATE INDEX "ix_game_audits_action_type_created" ON "game_audits" USING btree ("action_type" int4_ops,"created" timestamptz_ops,"action_user_id" int4_ops) WHERE action_type <> 1;--> statement-breakpoint
CREATE INDEX "ix_game_score_audits_action_type_created" ON "game_score_audits" USING btree ("action_type" int4_ops,"created" timestamptz_ops,"action_user_id" int4_ops) WHERE action_type <> 1;