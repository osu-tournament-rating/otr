-- Records the merges made before match_merges existed, rebuilt from the audit
-- log. A merge moved the child's games and deleted the child in one
-- transaction, so the child's delete audit and its games' match_id updates
-- share a created timestamp.
WITH RECURSIVE merged AS (
  SELECT DISTINCT ON (match_audit.reference_id_lock)
    match_audit.reference_id_lock AS merged_match_id,
    (game_audit.changes -> 'match_id' ->> 'newValue')::integer AS match_id,
    (match_audit.changes -> 'osu_id' ->> 'originalValue')::bigint AS osu_id,
    COALESCE((match_audit.changes -> 'is_lazer' ->> 'originalValue')::boolean, false) AS is_lazer,
    COALESCE(match_audit.changes -> 'name' ->> 'originalValue', '') AS name,
    match_audit.created
  FROM match_audits match_audit
  JOIN game_audits game_audit
    ON game_audit.created = match_audit.created
    AND game_audit.action_type = 1
    AND (game_audit.changes -> 'match_id' ->> 'originalValue')::integer = match_audit.reference_id_lock
  WHERE match_audit.action_type = 2
    AND match_audit.changes -> 'osu_id' ->> 'originalValue' IS NOT NULL
  ORDER BY match_audit.reference_id_lock, match_audit.created DESC
),
-- A parent merged later passes its merges on, as the merge procedure does.
resolved AS (
  SELECT merged_match_id, match_id, osu_id, is_lazer, name, created, 0 AS depth
  FROM merged
  UNION ALL
  SELECT resolved.merged_match_id, merged.match_id, resolved.osu_id,
    resolved.is_lazer, resolved.name, resolved.created, resolved.depth + 1
  FROM resolved
  JOIN merged ON merged.merged_match_id = resolved.match_id
  WHERE resolved.depth < 100
)
INSERT INTO match_merges (match_id, merged_match_id, osu_id, is_lazer, name, created)
SELECT DISTINCT ON (resolved.merged_match_id)
  resolved.match_id, resolved.merged_match_id, resolved.osu_id,
  resolved.is_lazer, resolved.name, resolved.created
FROM resolved
-- Skips merges whose games went into a match deleted since
JOIN matches ON matches.id = resolved.match_id
-- and matches added again since their merge.
WHERE NOT EXISTS (
  SELECT 1
  FROM matches readded
  WHERE readded.osu_id = resolved.osu_id
    AND readded.is_lazer = resolved.is_lazer
)
ORDER BY resolved.merged_match_id, resolved.depth DESC
ON CONFLICT DO NOTHING;
