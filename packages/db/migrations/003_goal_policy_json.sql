-- Migration 003: Add policy_json to goals table
--
-- Stores user-defined execution constraints for userPolicyGuard.
-- All fields are optional — NULL / empty object = fully autonomous (no restrictions).
--
-- Schema of the JSON object (TypeScript UserPolicy interface):
--   {
--     maxRiskLevel?:              "low" | "medium" | "high"
--     allowedProtocols?:          string[]
--     maxAllocationPerProtocol?:  Record<string, number>   -- protocol → max pct (0-100)
--     maxSingleTxValueUSD?:       number
--     requireProfitability?:      boolean
--   }
--
-- Example:
--   { "maxRiskLevel": "medium", "allowedProtocols": ["aave", "mento"] }
--
-- Rollback: see 003_goal_policy_json.down.sql

BEGIN;

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS policy_json JSONB NOT NULL DEFAULT '{}';

-- Partial index: only index goals that have non-trivial policies.
-- Goals with the default empty policy skip this index entirely.
CREATE INDEX IF NOT EXISTS idx_goals_policy_json
  ON goals USING gin (policy_json)
  WHERE policy_json <> '{}';

-- Document the column with a comment for future maintainers.
COMMENT ON COLUMN goals.policy_json IS
  'User-defined execution policy constraints (UserPolicy). '
  'Empty object = no restrictions (fully autonomous). '
  'See packages/agent/src/skills/intelligence/userPolicyGuard.ts for schema.';

COMMIT;
