-- Repairs the scores that issue #1185 left with no status. Automated checks
-- cleared every score an admin had not decided, then skipped the scores of a
-- game an admin had verified, so those scores were saved with no status.
-- Accepting the tournament's pre-statuses left them that way, and the rating
-- run leaves out a verified game with no verified scores.
--
-- Each such score gets the status it would have had. Its rejection reason is
-- what the score checks in
-- apps/data-worker/src/automation-checks/score-automation-checks.ts decide:
-- 1 for a score of 1000 or less, 2 for an invalid stable or lazer mod, and 4
-- for a ruleset other than the tournament's. In a verified tournament it then
-- gets the status accepting pre-statuses gives it: verified with no reason,
-- rejected otherwise. In a tournament still under review it gets the
-- pre-status the checks give it. A rejected tournament's scores follow its
-- rejection, so they are left alone.
--
-- The repair runs with no audit user, so the audit triggers record each score
-- as a System change. It sets updated, so the next rating run refreshes the
-- stats of each verified tournament it touches. It changes only scores that
-- still have no status, so running it again changes nothing.

LOCK TABLE tournaments, matches, games IN SHARE MODE;
--> statement-breakpoint
LOCK TABLE game_scores IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

CREATE TEMP TABLE _otr_1185_scores ON COMMIT DROP AS
SELECT
  s.id,
  t.verification_status = 4 AS accepted,
  (CASE WHEN s.score <= 1000 THEN 1 ELSE 0 END)
    | (CASE
        -- SuddenDeath, Relax, Autoplay, Relax2 (Autopilot) and Perfect
        WHEN s.mods & (32 | 128 | 2048 | 8192 | 16384) <> 0 THEN 2
        WHEN jsonb_typeof(s.lazer_mods) = 'array' AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(s.lazer_mods) AS lazer_mod
          WHERE lazer_mod ->> 'acronym' IN ('AT', 'CN', 'RX', 'AP', 'SD', 'PF')
        ) THEN 2
        ELSE 0
      END)
    | (CASE WHEN s.ruleset <> t.ruleset THEN 4 ELSE 0 END) AS rejection_reason
FROM game_scores AS s
JOIN games AS g ON g.id = s.game_id
JOIN matches AS m ON m.id = g.match_id
JOIN tournaments AS t ON t.id = m.tournament_id
WHERE s.verification_status = 0
  AND g.verification_status = 4
  AND t.verification_status <> 3;
--> statement-breakpoint

DO $$
DECLARE
  candidate_count integer;
  updated_count integer;
  audit_max_id integer;
  audit_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO candidate_count FROM _otr_1185_scores;
  SELECT COALESCE(MAX(id), 0) INTO audit_max_id FROM game_score_audits;

  -- A migration is a System action. Clear any audit user the runner left set.
  PERFORM set_config('otr.audit_user_id', '', true);

  UPDATE game_scores AS s
  SET verification_status = CASE
        WHEN repair.accepted AND repair.rejection_reason = 0 THEN 4
        WHEN repair.accepted THEN 3
        WHEN repair.rejection_reason = 0 THEN 2
        ELSE 1
      END,
      rejection_reason = repair.rejection_reason,
      updated = CURRENT_TIMESTAMP
  FROM _otr_1185_scores AS repair
  WHERE s.id = repair.id
    AND s.verification_status = 0;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> candidate_count THEN
    RAISE EXCEPTION
      'Issue #1185 score repair expected to update % scores, updated %',
      candidate_count,
      updated_count;
  END IF;

  SELECT COUNT(*)::integer
  INTO audit_count
  FROM game_score_audits AS audit
  JOIN _otr_1185_scores AS repair ON repair.id = audit.reference_id
  WHERE audit.id > audit_max_id
    AND audit.action_type = 1
    AND audit.action_user_id IS NULL;

  IF audit_count <> candidate_count THEN
    RAISE EXCEPTION
      'Issue #1185 score repair expected % System audit rows, found %',
      candidate_count,
      audit_count;
  END IF;

  RAISE NOTICE
    'Issue #1185 score repair: % verified and % rejected in verified tournaments, % pre-verified and % pre-rejected in tournaments under review',
    (SELECT COUNT(*) FROM _otr_1185_scores WHERE accepted AND rejection_reason = 0),
    (SELECT COUNT(*) FROM _otr_1185_scores WHERE accepted AND rejection_reason <> 0),
    (SELECT COUNT(*) FROM _otr_1185_scores WHERE NOT accepted AND rejection_reason = 0),
    (SELECT COUNT(*) FROM _otr_1185_scores WHERE NOT accepted AND rejection_reason <> 0);
END;
$$;
