-- Rebuilds the stats of every verified tournament that has them, once, so the
-- match results and win/loss records already stored stop counting tied games
-- and drawn matches as wins. The weekly rating run queues a rebuild only when a
-- tournament's data or rating changes change, so without this most stored
-- results would keep the old rules.
--
-- A deploy runs migrations while the previous worker is still running, and
-- replaces it only after both web containers pass their health checks. The jobs
-- wait 30 minutes, so the previous worker cannot run them with the old rules.
-- They run at low priority, behind stats the rating run or an admin queues.
INSERT INTO jobs (queue, payload, priority, run_after, tournament_id)
SELECT
  'processing.stats.tournaments',
  jsonb_build_object('tournamentId', t.id),
  0,
  now() + interval '30 minutes',
  t.id
FROM tournaments t
WHERE t.verification_status = 4
  AND EXISTS (
    SELECT 1
    FROM player_tournament_stats pts
    WHERE pts.tournament_id = t.id
  );
