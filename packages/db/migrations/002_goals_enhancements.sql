-- Migration 002: add goal tracking fields missing from initial schema
-- Required by services/scheduler/src/jobs/runGoalCycle.ts

-- principal_deposited: initial balance when goal was activated
-- (used to calculate yield = currentBalance - principal)
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS principal_deposited NUMERIC(78,18) NOT NULL DEFAULT 0;

-- monthly_deposit: recurring deposit commitment (USD, 18 dec)
-- (used for pace tracking and top-up suggestions; 0 = lump sum only)
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS monthly_deposit NUMERIC(78,18) NOT NULL DEFAULT 0;

-- progress_pct: cached progress percentage from last cycle snapshot
-- (avoids re-reading goal_snapshots on every cycle start)
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS progress_pct NUMERIC(5,2);

-- last_rebalanced_at: timestamp of last successful on-chain rebalance
-- (mirrors SentinelExecutor.positions[user].lastRebalancedAt; kept in sync by scheduler)
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS last_rebalanced_at TIMESTAMPTZ;

-- Update progress_pct from latest snapshot for existing rows
UPDATE goals g
SET    progress_pct = s.progress_pct
FROM   (
  SELECT DISTINCT ON (goal_id)
    goal_id, progress_pct
  FROM  goal_snapshots
  ORDER BY goal_id, snapshot_at DESC
) s
WHERE  g.id = s.goal_id;

-- epoch_start: timestamp when the current spend epoch began.
-- Used by runGoalCycle.ts to determine when to call resetSpendEpoch().
-- Without this column, goal.epoch_start reads as undefined → the epoch
-- check falls back to created_at, causing the agent to reset too early
-- or too late depending on when the goal was created.
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS epoch_start TIMESTAMPTZ;

-- Initialise epoch_start for existing rows to their activated_at or created_at
UPDATE goals
SET epoch_start = COALESCE(activated_at, created_at)
WHERE epoch_start IS NULL;
