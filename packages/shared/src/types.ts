// ─────────────────────────────────────────────────────────────────────────────
// @piggy/shared — Core Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillResult<T> {
  success:          boolean;
  data:             T | null;
  error:            string | null;
  txHash:           string | null;
  agentscanEventId: string | null;
  executedAt:       Date;
}

/**
 * Notification types written to DB and pushed via Telegram.
 */
export type NotificationType =
  | "progress_update"
  | "goal_completed"
  | "behind_pace"
  | "top_up_suggestion"
  | "rebalance_executed"
  | "il_exit_executed"
  | "liquidation_alert"
  | "circuit_breaker_triggered"
  | "circuit_breaker"
  | "goal_created"
  | "goal_paused"
  | "goal_resumed"
  // NEW ↓
  | "allowance_revoked"
  | "balance_insufficient"
  | "goal_action_required"
  | "goal_expired"
  | "x402_charged"
  | "goal_completed_options";

/**
 * Goal lifecycle statuses stored in DB.
 * draft → active → [action_required | paused | completed | cancelled | expired]
 */
export type GoalStatus =
  | "draft"
  | "active"
  | "action_required"   // NEW — user needs to take action (e.g. re-approve allowance)
  | "paused"
  | "completed"
  | "cancelled"
  | "expired";          // NEW — deadline passed, goal not completed

/**
 * Agent status per cycle — stored in agent_events table.
 */
export type AgentStatus = "idle" | "running" | "blocked" | "success" | "failed" | "skipped" | "paused";

/**
 * Reason codes for action_required state.
 */
export type ActionRequiredReason =
  | "allowance_revoked"
  | "allowance_expired"
  | "balance_insufficient"
  | "allowance_too_low";

export type PaceStatus = "on_track" | "behind_pace" | "ahead_of_pace";

export type DecisionAction =
  | "execute_initial_alloc"
  | "execute_rebalance"
  | "skip_min_amount"
  | "skip_frequency"
  | "skip_gas_cost"
  | "skip_paused"
  | "skip_no_change"
  | "skip_high_risk"
  | "skip_protocol_degraded"
  | "skip_guardrail"
  | "skip_unprofitable"
  | "skip_nano"
  | "skip_small";

export interface AgentDecision {
  action:            DecisionAction;
  tier:              string;
  reason:            string;
  estimatedNewApy:   number;
  shouldNotify:      boolean;
  targetAlloc?:      { stableBps: number; lpBps: number; wethBps: number };
  newAllocBps?:      { stableBps: number; lpBps: number; wethBps: number };
}
