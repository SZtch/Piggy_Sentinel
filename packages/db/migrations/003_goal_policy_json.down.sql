-- Migration 003 ROLLBACK: Remove policy_json from goals table
--
-- WARNING: This destroys all stored user policies and cannot be undone.
-- Only run this if you are rolling back migration 003 in a non-production environment.

BEGIN;

DROP INDEX IF EXISTS idx_goals_policy_json;

ALTER TABLE goals
  DROP COLUMN IF EXISTS policy_json;

COMMIT;
