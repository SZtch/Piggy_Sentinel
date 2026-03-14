export type Address = `0x${string}`;
export type TxHash  = `0x${string}`;

// ── Goal ──────────────────────────────────────────────────────────────────

export type GoalCurrency    = "USDm" | "EURm";
export type RiskPreference  = "conservative";
export type GoalStatus      = "draft" | "active" | "paused" | "completed" | "cancelled";
export type PaceStatus      = "on_track" | "behind" | "ahead";

export interface Goal {
  id:               string;
  ownerWallet:      Address;
  agentWallet:      Address | null;
  targetAmount:     bigint;
  targetCurrency:   GoalCurrency;
  deadlineDate:     Date;
  riskPreference:   RiskPreference;
  status:           GoalStatus;
  strategyJson:     SavingsStrategy | null;
  createdAt:        Date;
  activatedAt:      Date | null;
  completedAt:      Date | null;
}

export interface SavingsStrategy {
  allocationAmount:    bigint;
  expectedApyMin:      number;
  expectedApyMax:      number;
  fxHedgeThresholdPct: number;
  monitorCadenceHours: number;
  confidenceScore:     number;
  generatedAt:         Date;
  source:              "openclaw" | "hardcoded";
}

// ── Agent wallet ──────────────────────────────────────────────────────────

export interface AgentWallet {
  contractAddress:   Address;
  ownerWallet:       Address;
  deployedAt:        Date;
  executorAddress:   Address;
  spendLimit:        bigint;
  softPaused:        boolean;
  hardPausedOnchain: boolean;
  lastSyncedAt:      Date;
}

// ── Skills ────────────────────────────────────────────────────────────────

export type SkillName =
  | "computeSavingsStrategy"
  | "checkGoalProgress"
  | "checkFxDrift"
  | "allocateSavings"
  | "hedgeFxExposure"
  | "withdrawOnCompletion"
  | "sendStatusUpdate"
  | "emitAgentEvent"
  | "handlePauseResume";

export interface SkillResult<T = unknown> {
  success:          boolean;
  data:             T | null;
  error:            string | null;
  txHash:           TxHash | null;
  agentscanEventId: string | null;
  executedAt:       Date;
}

// ── Events ────────────────────────────────────────────────────────────────

export type AgentEventType =
  | "AAVE_SUPPLY"
  | "AAVE_WITHDRAW"
  | "MENTO_SWAP"
  | "GOAL_ACTIVATED"
  | "GOAL_COMPLETED"
  | "AGENT_PAUSED"
  | "AGENT_RESUMED"
  | "EXECUTOR_REVOKED"
  | "FX_RATE_FETCHED";

// ── Notifications ─────────────────────────────────────────────────────────

export type NotificationType =
  | "allocation_confirmed"
  | "hedge_executed"
  | "progress_update"
  | "milestone"
  | "behind_pace"
  | "goal_completed"
  | "agent_paused";
